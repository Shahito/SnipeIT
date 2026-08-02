/**
 * condition-settings.js
 *
 * The settings overlay opened by the gear button next to a condition's
 * indicator-picker (LHS or RHS-as-indicator). Lets the user edit everything
 * that used to have no UI at all: offset, timeframe, an indicator's extra
 * params (MACD fast/slow/signal, etc.), the RHS multiplier, and the
 * optional "combine with" second ref (combineOp/combineIndicator/...).
 *
 * Depends on (must be loaded before this file):
 *   - indicator-config.js    (INDICATORS, INDICATORS_WITH_PERIOD,
 *                              INDICATORS_WITH_SOURCES, INDICATOR_SOURCES,
 *                              INDICATOR_EXTRA_PARAMS, TIMEFRAMES)
 *   - indicator-picker.js    (<indicator-picker> custom element)
 *   - condition-renderer.js  (conditions, getRule, updatePreview)
 *   - i18n (t())
 *   - ICONS global
 *
 * Design note: this file builds and manages its own overlay element rather
 * than calling the app's openModal()/closeModal() (overlay-a11y.js), since
 * that helper's exact contract isn't available to check against here. It
 * intentionally mirrors the self-contained overlay pattern already used by
 * indicator-picker.js's <indicator-picker> (own scroll-lock/inert/focus
 * handling, single shared instance built lazily) rather than introducing a
 * third modal system. It reuses the existing `.modal-overlay` / `.modal`
 * CSS so it looks identical to the app's other modals, and the body content
 * itself is built entirely out of existing editor classes - `.form-group`,
 * `.form-row`, `.section-title`, `.divider`, `.checkbox-label` - the same
 * ones used for Capital/Position size/SL-TP elsewhere in this page, so
 * nothing in here needed a parallel style system. Only the gear button and
 * a couple of layout tweaks are new (see the small `.cs-*` block in
 * style.css). If overlay-a11y.js's openModal()/closeModal() turns out to
 * have a simple enough contract, swapping this out for it later is a small
 * change confined to open/close - the field-rendering logic is unaffected.
 *
 * Exposes:
 *   window.openConditionSettings(type, gidx, ridx, prefix)
 *   window.hasNonDefaultConditionSettings(cond, prefix)
 */

(function () {
  let _overlayEl = null
  let _cond = null          // condition object currently being edited
  let _prefix = ''          // '' = LHS, 'value' = RHS-as-indicator
  let _lastFocused = null
  let _scrollY = 0
  let _inertTargets = []

  // Key derivation for one "ref" (indicator + period/source/offset/
  // timeframe/settings + optional combine* sub-ref). Mirrors backtest.py's
  // _resolve_expr() exactly - keep both in sync if the schema ever changes.
  function _refKeys(prefix) {
    const p = prefix || ''
    return {
      ind:  p ? `${p}Indicator` : 'indicator',
      per:  p ? `${p}IndicatorPeriod` : 'period',
      src:  p ? `${p}IndicatorSource` : 'source',
      off:  p ? `${p}IndicatorOffset` : 'offset',
      tf:   p ? `${p}IndicatorTimeframe` : 'timeframe',
      set:  p ? `${p}IndicatorSettings` : 'settings',
      cop:  p ? `${p}CombineOp` : 'combineOp',
      cind: p ? `${p}CombineIndicator` : 'combineIndicator',
      cper: p ? `${p}CombinePeriod` : 'combinePeriod',
      csrc: p ? `${p}CombineSource` : 'combineSource',
      coff: p ? `${p}CombineOffset` : 'combineOffset',
      cset: p ? `${p}CombineSettings` : 'combineSettings',
    }
  }

  // True if this ref (or its combine sub-ref) carries anything beyond the
  // old flat schema - purely used to light up the gear button's dot.
  function hasNonDefaultConditionSettings(cond, prefix) {
    const k = _refKeys(prefix)
    if (cond[k.off] || cond[k.tf] || cond[k.set] || cond[k.cop]) return true
    if (prefix === 'value' && cond.valueMultiplier != null && cond.valueMultiplier !== 1) return true
    return false
  }

  // Scroll lock / inert - same technique as indicator-picker.js's overlay.
  function _lockScroll() {
    _scrollY = window.scrollY
    document.body.style.position = 'fixed'
    document.body.style.top = `-${_scrollY}px`
    document.body.style.width = '100%'
  }
  function _unlockScroll() {
    document.body.style.position = ''
    document.body.style.top = ''
    document.body.style.width = ''
    window.scrollTo(0, _scrollY)
  }

  function _setInert(on) {
    if (!_inertTargets.length) {
      _inertTargets = [
        document.getElementById('appHeader'),
        document.querySelector('.app-main'),
      ].filter(Boolean)
    }
    _inertTargets.forEach(el => {
      if (on) el.setAttribute('inert', '')
      else el.removeAttribute('inert')
    })
  }

  function _ensureOverlay() {
    if (_overlayEl) return
    const el = document.createElement('div')
    el.className = 'modal-overlay cs-overlay'
    el.innerHTML = `
      <div class="modal cs-modal">
        <div class="modal-header">
          <span class="modal-title" id="csTitle"></span>
          <button type="button" class="modal-close cs-close-btn" aria-label="${t('picker.close')}">${ICONS.cross}</button>
        </div>
        <div id="csBody"></div>
      </div>
    `
    document.body.appendChild(el)
    _overlayEl = el
    el.addEventListener('click', e => { if (e.target === el) _close() })
    el.querySelector('.cs-close-btn').addEventListener('click', _close)
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && el.classList.contains('open')) _close()
    })
  }

  function openConditionSettings(type, gidx, ridx, prefix) {
    _ensureOverlay()
    _cond = getRule(type, gidx, ridx)
    _prefix = prefix || ''
    const k = _refKeys(_prefix)
    document.getElementById('csTitle').textContent =
      `${t('editor.cond.settings')} - ${_cond[k.ind]}`
    _renderBody()
    _lastFocused = document.activeElement
    _lockScroll()
    _setInert(true)
    requestAnimationFrame(() => _overlayEl.classList.add('open'))
  }

  function _close() {
    if (!_overlayEl) return
    _overlayEl.classList.remove('open')
    _unlockScroll()
    _setInert(false)
    _cond = null
    // Re-render the row so the gear dot / row stays in sync after edits
    // made in the overlay (offset, timeframe, combine...).
    if (window.renderConditions) renderConditions()
    if (window.updatePreview) updatePreview()
    _lastFocused?.focus?.()
    _lastFocused = null
  }

  // Small field builders - all built on the app's existing .form-group /
  // .form-row / .section-title / .checkbox-label CSS (style.css), same as
  // every other field in the editor (Capital, Position size, SL/TP...).
  // Nothing custom-styled here beyond the gear button and a couple of
  // layout tweaks for the indicator-picker inside a form-row.

  function _numberField(id, label, value, opts = {}) {
    const { min, max, step } = opts
    return `
      <div class="form-group">
        <label>${label}</label>
        <input type="number" id="${id}"
          value="${value}"
          ${min !== undefined ? `min="${min}"` : ''}
          ${max !== undefined ? `max="${max}"` : ''}
          ${step !== undefined ? `step="${step}"` : 'step="1"'}>
      </div>
    `
  }

  // Version sweepable de _numberField : accepte "14" ou "14, 15, 16" -> voir
  // sweep-parse.js. Utilisée uniquement pour period/valueMultiplier (champs
  // reconnus comme sweepables par strategyService) - PAS pour offset, les
  // extra-params d'indicateur (MACD fast/slow/signal...) ni combine*, qui
  // restent volontairement scalaires (_numberField ci-dessus).
  function _sweepNumberField(id, label, value) {
    return `
      <div class="form-group">
        <label>${label}</label>
        <input type="text" id="${id}" value="${formatSweepNumber(value)}" inputmode="decimal" placeholder="14, 15, 16">
      </div>
    `
  }

  const SOURCE_CLOSE_SENTINEL = '__close__'

  function _sourceField(id, label, value) {
    return `
      <div class="form-group">
        <label>${label}</label>
        <select id="${id}">
          <option value="">${t('editor.cond.source_close')}</option>
          ${INDICATOR_SOURCES.map(s => `<option${s === value ? ' selected' : ''}>${s}</option>`).join('')}
        </select>
      </div>
    `
  }

  function _sweepSourceField(id, label, value) {
    const raw = formatSweepChoice(value).map(v => (v === null || v === undefined || v === '') ? 'PRICE' : v)
    const selected = raw.length ? raw : ['PRICE']
    const options = [{ value: 'PRICE', label: t('editor.cond.source_close') }, ...INDICATOR_SOURCES.map(s => ({ value: s, label: s }))]
    return `
      <div class="form-group">
        <label>${label}</label>
        <div class="toggle-group" id="${id}">
          ${options.map(opt => `<button type="button" class="toggle-btn${selected.includes(opt.value) ? ' active' : ''}" data-chip-value="${opt.value}">${opt.label}</button>`).join('')}
        </div>
      </div>
    `
  }

  function _bindSourceChipGroup(containerId, onChange) {
    const el = document.getElementById(containerId)
    if (!el) return
    el.addEventListener('click', e => {
      const btn = e.target.closest('.toggle-btn')
      if (!btn) return
      const isClose = btn.dataset.chipValue === SOURCE_CLOSE_SENTINEL
      const willBeActive = !btn.classList.contains('active')

      if (!willBeActive) {
        // Décocher : au moins une valeur doit rester sélectionnée.
        if (el.querySelectorAll('.toggle-btn.active').length <= 1) return
        btn.classList.remove('active')
      } else if (isClose) {
        // "close" exclut toute autre source sélectionnée.
        el.querySelectorAll('.toggle-btn.active').forEach(b => b.classList.remove('active'))
        btn.classList.add('active')
      } else {
        // Une source explicite exclut "close".
        el.querySelector(`.toggle-btn[data-chip-value="${SOURCE_CLOSE_SENTINEL}"]`)?.classList.remove('active')
        btn.classList.add('active')
      }

      onChange(getChipGroupSelected(containerId))
    })
  }

  // Body rendering 

  function _renderBody() {
    const cond = _cond, prefix = _prefix, k = _refKeys(prefix)
    const indicator  = cond[k.ind]
    const needsPeriod = INDICATORS_WITH_PERIOD.includes(indicator)
    const needsSource = INDICATORS_WITH_SOURCES.includes(indicator)
    const extra       = INDICATOR_EXTRA_PARAMS[indicator] || []
    const isRhs        = prefix === 'value'
    const hasCombine   = !!cond[k.cop]
    // Restriction is UI-only and forward-looking: an indicator already
    // combined (legacy data, or added before this indicator was
    // restricted) keeps showing/editing normally - see INDICATORS_NO_COMBINE
    // in indicator-config.js.
    const combineAllowed = hasCombine || !INDICATORS_NO_COMBINE.includes(indicator)

    const strategyTf   = (typeof getPrimaryTimeframe === 'function' && getPrimaryTimeframe()) || '1h'
    const baseMinutes  = (TIMEFRAMES.find(tf => tf.value === strategyTf) || {}).minutes || 60
    const tfOptions    = TIMEFRAMES.filter(tf => tf.minutes >= baseMinutes)

    document.getElementById('csBody').innerHTML = `
      <div class="section-title">${t('editor.cond.settings_params')}</div>
      ${(needsPeriod || needsSource || extra.length || tfOptions.length) ? `
      <div class="form-row">
        ${needsPeriod ? _sweepNumberField('cs-period', t('editor.cond.period'), cond[k.per] ?? INDICATOR_DEFAULT_PERIOD[indicator] ?? 14) : ''}
        ${needsSource ? _sweepSourceField('cs-source', t('editor.cond.source'), cond[k.src]) : ''}
        ${extra.map(p => _numberField(`cs-extra-${p.key}`, t(p.labelKey), (cond[k.set] && cond[k.set][p.key]) ?? p.default, { min: p.min, max: p.max })).join('')}
        <div class="form-group">
          <label>${t('editor.cond.timeframe')}</label>
            <select id="cs-timeframe">
              ${tfOptions.map(tf => `<option value="${tf.value}"${(cond[k.tf] || strategyTf) === tf.value ? ' selected' : ''}>${tf.value}</option>`).join('')}
            </select>
        </div>
      </div>
      </div>
      ` : `<p class="text-muted text-sm">${t('editor.cond.settings_none')}</p>`}

      <div class="divider mt-md mb-md"></div>

      <div class="section-title">${t('editor.cond.offset')}</div>
      <div class="form-group">
        <input type="number" id="cs-offset" value="${cond[k.off] || 0}" min="0" max="500">
      </div>
      <p class="text-muted text-sm mt-sm">${t('editor.cond.offset_hint')}</p>

      ${isRhs ? `
      <div class="divider mt-md mb-md"></div>
      <div class="section-title">${t('editor.cond.multiplier')}</div>
      ${_sweepNumberField('cs-multiplier', '', cond.valueMultiplier ?? 1)}
      <p class="text-muted text-sm mt-sm">${t('editor.cond.multiplier_hint')}</p>
      ` : ''}

      <div class="divider mt-md mb-md"></div>

      ${combineAllowed ? `
      <label class="checkbox-label">
        <input type="checkbox" id="cs-combine-toggle" ${hasCombine ? 'checked' : ''}>
        ${t('editor.cond.combine_with')}
      </label>
      <div id="csCombineBody" class="mt-sm" style="${hasCombine ? '' : 'display:none'}"></div>
      ` : `
      <p class="text-muted text-sm">${t('editor.cond.combine_unavailable')}</p>
      `}
    `
    if (hasCombine) _renderCombineBody()
    _bindBody()
  }

  function _renderCombineBody() {
    const cond = _cond, k = _refKeys(_prefix)
    const cIndicator  = cond[k.cind] || INDICATORS[0]
    const needsPeriod = INDICATORS_WITH_PERIOD.includes(cIndicator)
    const needsSource = INDICATORS_WITH_SOURCES.includes(cIndicator)
    const extra       = INDICATOR_EXTRA_PARAMS[cIndicator] || []
    const OPS = ['+', '-', '*', '/']

    document.getElementById('csCombineBody').innerHTML = `
      <div class="form-row">
        <div class="form-group">
          <label>${t('editor.cond.operator')}</label>
          <select id="cs-combine-op">
            ${OPS.map(o => `<option value="${o}"${cond[k.cop] === o ? ' selected' : ''}>${o}</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label>${t('editor.cond.combine_indicator')}</label>
          <indicator-picker id="cs-combine-ind" value="${cIndicator}"></indicator-picker>
        </div>
      </div>
      ${(needsPeriod || needsSource || extra.length) ? `
      <div class="form-row">
        ${needsPeriod ? _numberField('cs-combine-period', t('editor.cond.period'), cond[k.cper] ?? INDICATOR_DEFAULT_PERIOD[cIndicator] ?? 14, { min: 1, max: 200 }) : ''}
        ${needsSource ? _sourceField('cs-combine-source', t('editor.cond.source'), cond[k.csrc]) : ''}
        ${extra.map(p => _numberField(`cs-combine-extra-${p.key}`, t(p.labelKey), (cond[k.cset] && cond[k.cset][p.key]) ?? p.default, { min: p.min, max: p.max })).join('')}
      </div>` : ''}
      <div class="form-group">
        <label>${t('editor.cond.offset')}</label>
        <input type="number" id="cs-combine-offset" value="${cond[k.coff] || 0}" min="0" max="500">
      </div>
    `
    _bindCombineBody()
  }

  // Event binding
  function _bindBody() {
    const cond = _cond, prefix = _prefix, k = _refKeys(prefix)

    document.getElementById('cs-period')?.addEventListener('input', e => {
      cond[k.per] = parseSweepNumber(e.target.value, parseInt) ?? (INDICATOR_DEFAULT_PERIOD[cond[k.ind]] || 14)
      updatePreview()
    })
    if (document.getElementById('cs-source')) {
      bindChipGroup('cs-source', (selected) => {
        cond[k.src] = parseSweepChoice(selected)
        updatePreview()
      })
    }
    ;(INDICATOR_EXTRA_PARAMS[cond[k.ind]] || []).forEach(p => {
      document.getElementById(`cs-extra-${p.key}`)?.addEventListener('input', e => {
        cond[k.set] = cond[k.set] || {}
        const v = parseFloat(e.target.value)
        cond[k.set][p.key] = Number.isNaN(v) ? p.default : v
        updatePreview()
      })
    })

    document.getElementById('cs-offset').addEventListener('input', e => {
      const v = parseInt(e.target.value) || 0
      if (v > 0) cond[k.off] = v; else delete cond[k.off]
      updatePreview()
    })

    document.getElementById('cs-timeframe').addEventListener('change', e => {
      const strategyTf = (typeof getPrimaryTimeframe === 'function' && getPrimaryTimeframe()) || '1h'
      // Explicitly picking the strategy's own timeframe is equivalent to
      // "no timeframe specified" (see backtest.py's run_backtest(), which
      // normalizes both to the same code path) - so just omit the key.
      if (e.target.value && e.target.value !== strategyTf) cond[k.tf] = e.target.value
      else delete cond[k.tf]
      updatePreview()
    })

    document.getElementById('cs-multiplier')?.addEventListener('input', e => {
      cond.valueMultiplier = parseSweepNumber(e.target.value) ?? 1
      updatePreview()
    })

    document.getElementById('cs-combine-toggle')?.addEventListener('change', e => {
      if (e.target.checked) {
        cond[k.cop]  = cond[k.cop]  || '-'
        cond[k.cind] = cond[k.cind] || DEFAULT_COMBINE_INDICATOR
      } else {
        delete cond[k.cop];  delete cond[k.cind]; delete cond[k.cper]
        delete cond[k.csrc]; delete cond[k.coff]; delete cond[k.cset]
      }
      updatePreview()
      // Full re-render (not just a display toggle): turning combine off on
      // a restricted indicator must hide the checkbox again, since
      // INDICATORS_NO_COMBINE only grandfathers already-combined refs.
      _renderBody()
    })
  }

  function _bindCombineBody() {
    const cond = _cond, k = _refKeys(_prefix)

    document.getElementById('cs-combine-op').addEventListener('change', e => {
      cond[k.cop] = e.target.value
      updatePreview()
    })
    document.getElementById('cs-combine-ind').addEventListener('change', e => {
      cond[k.cind] = e.target.value
      delete cond[k.cper]; delete cond[k.csrc]; delete cond[k.cset]
      _renderCombineBody()
      updatePreview()
    })
    document.getElementById('cs-combine-period')?.addEventListener('input', e => {
      cond[k.cper] = parseInt(e.target.value) || INDICATOR_DEFAULT_PERIOD[cond[k.cind]] || 14
      updatePreview()
    })
    document.getElementById('cs-combine-source')?.addEventListener('change', e => {
      cond[k.csrc] = e.target.value || null
      updatePreview()
    })
    ;(INDICATOR_EXTRA_PARAMS[cond[k.cind]] || []).forEach(p => {
      document.getElementById(`cs-combine-extra-${p.key}`)?.addEventListener('input', e => {
        cond[k.cset] = cond[k.cset] || {}
        const v = parseFloat(e.target.value)
        cond[k.cset][p.key] = Number.isNaN(v) ? p.default : v
        updatePreview()
      })
    })
    document.getElementById('cs-combine-offset').addEventListener('input', e => {
      const v = parseInt(e.target.value) || 0
      if (v > 0) cond[k.coff] = v; else delete cond[k.coff]
      updatePreview()
    })
  }

  window.openConditionSettings = openConditionSettings
  window.hasNonDefaultConditionSettings = hasNonDefaultConditionSettings
})()