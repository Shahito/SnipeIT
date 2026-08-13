/**
 * indicator-picker.js - <indicator-picker> custom element
 *
 * TradingView-style indicator picker. Standalone web component, no native
 * <select> involved. Exposes the same surface a <select> would so existing
 * call sites barely change:
 *
 *   el.value                  -> current indicator string
 *   el.value = 'RSI'          -> sets it (no event fired, like a select)
 *   el.addEventListener('change', e => e.target.value)
 *   el.dataset.type / gidx / ridx -> plain attributes, untouched
 *
 * Usage:
 *   1. Define window.INDICATOR_CATEGORIES (see bottom of this file)
 *   2. Use <indicator-picker value="RSI" data-type="entry" ...></indicator-picker>
 *      directly in markup/innerHTML - it self-upgrades, no init call needed.
 *   3. Call indicatorPicker.refreshLabels() after i18n loads if pickers were
 *      already in the DOM before i18n:ready fired.
 */

/**
 * HOW TO ADD A NEW INDICATOR
 * ---------------------------------------------------------------
 * Adding an indicator touches up to 4 places. Steps 1-2 are always
 * required; 3-4 only apply if the indicator needs extra params.
 *
 * 1. strategy-editor.html - register the indicator's identity
 *    Add the indicator's string id to `INDICATORS` (top of the
 *    <script> block, ~line 236). This array drives:
 *      - the default picked when toggling fixed-value <-> indicator
 *        (INDICATORS[0] fallback)
 *      - any other business logic that enumerates all indicators
 *    Example:
 *      const INDICATORS = [..., 'CCI']
 *
 * 2. indicator-picker.js - register it for the picker UI
 *    Add an entry to window.INDICATOR_CATEGORIES, inside whichever
 *    category[].items array fits (momentum / trend / volatility /
 *    price_volume), or create a new category object if none fits.
 *    Required fields per item:
 *      value     - must exactly match the id used in step 1
 *      labelKey  - i18n key, e.g. 'picker.ind.cci'
 *    Example:
 *      { value: 'CCI', labelKey: 'picker.ind.cci' }
 *    This alone makes the indicator searchable, categorized, and
 *    selectable in <indicator-picker> - no other picker code change
 *    needed, since the overlay renders purely off this config object.
 *
 * 3. i18n file - add the translation key
 *    Add 'picker.ind.cci' (and any locale variants) to the i18n
 *    source used by t(). If you skip this, the picker still works
 *    but shows the raw key or an empty label depending on your t()
 *    fallback behavior - check t(i.labelKey) usage in
 *    indicator-picker.js if unsure.
 *
 * 4. Only if the indicator needs a period and/or a source param:
 *    - INDICATORS_WITH_PERIOD: add the id here if it should show
 *      the "Period" number input (strategy-editor.html, ~line 257)
 *    - INDICATORS_WITH_SOURCES: add the id here if it should show
 *      the "Source" dropdown (HIGH/LOW/OPEN/VOLUME) (~line 268)
 *    These two arrays drive the show/hide logic in
 *    bindConditionEvents() for both LHS and RHS (indicator-vs-
 *    indicator) condition sides - no picker-side change needed.
 *
 * NOT required:
 *   - No change to indicator-picker.js's IndicatorPicker class
 *   - No change to the overlay rendering logic (_renderResults,
 *     _renderCategories) - it's fully data-driven off
 *     INDICATOR_CATEGORIES
 * ---------------------------------------------------------------
 */

(function () {
    // Single overlay instance shared by every <indicator-picker> on the page.
    let _overlayEl = null
    let _activePicker = null   // the <indicator-picker> currently being edited
    let _searchTerm = ''
    let _overlayReady = false

    function _ensureOverlay() {
        if (_overlayEl) return
        const el = document.createElement('div')
        el.className = 'ip-overlay'
        el.innerHTML = `
      <div class="ip-panel">
        <div class="ip-search-row">
            ${ICONS.search}
            <input type="text" class="ip-search-input" placeholder="${t('picker.search_ph')}" autocomplete="off">
            <button type="button" class="modal-close ip-close-btn" aria-label="${t('picker.close')}">
            ${ICONS.cross}
          </button>
        </div>
        <div class="ip-body">
          <div class="ip-categories" id="ipCategories"></div>
          <div class="ip-results" id="ipResults"></div>
        </div>
      </div>
    `
        document.body.appendChild(el)
        _overlayEl = el

        el.addEventListener('click', e => { if (e.target === el) _close() })
        el.querySelector('.ip-close-btn').addEventListener('click', _close)
        document.addEventListener('keydown', e => {
            if (e.key === 'Escape' && el.classList.contains('open')) _close()
        })

        const input = el.querySelector('.ip-search-input')
        input.addEventListener('input', e => {
            _searchTerm = e.target.value.trim().toLowerCase()
            _renderResults()
        })

        _overlayReady = true
        _renderCategories()
    }

    const isTouchDevice = () => window.matchMedia('(hover: none)').matches
    const isMobileWidth = () => ((window.innerWidth > 0) ? window.innerWidth : screen.width) <= 640

    let _scrollY = 0

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

    let _inertTargets = []
    let _lastFocused = null

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

    function _open(picker) {
        _ensureOverlay()
        _activePicker = picker
        _searchTerm = ''
        _lastFocused = document.activeElement
        const input = _overlayEl.querySelector('.ip-search-input')
        input.value = ''
        _lockScroll()
        _setInert(true)
        _renderCategories()
        _renderResults()
        requestAnimationFrame(() => _overlayEl.classList.add('open'))
        if (!isTouchDevice()) {
            setTimeout(() => input.focus(), 50)
        }
    }

    function _close() {
        if (!_overlayEl) return
        _overlayEl.classList.remove('open')
        _unlockScroll()
        _setInert(false)
        _activePicker = null
        _lastFocused?.focus?.()
        _lastFocused = null
    }

    /* Category sidebar */
    function _renderCategories(activeIndicator) {
        if (!_overlayReady) return
        const cats = window.INDICATOR_CATEGORIES || []
        const container = document.getElementById('ipCategories')
        const activeCat = activeIndicator
            ? cats.find(c => c.items.some(i => i.value === activeIndicator))?.key
            : null

        container.innerHTML = `
      <button type="button" class="ip-cat-btn ${!_searchTerm ? 'active' : ''}" data-cat="">
        ${ICONS.grid}
        ${t('picker.all')}
      </button>
      ${cats.map(c => `
        <button type="button" class="ip-cat-btn ${c.key === activeCat ? 'active' : ''}" data-cat="${c.key}">
          ${c.icon ? `${c.icon}` : ''}
          ${t(c.labelKey)}
        </button>
      `).join('')}
    `

        container.querySelectorAll('.ip-cat-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                container.querySelectorAll('.ip-cat-btn').forEach(b => b.classList.remove('active'))
                btn.classList.add('active')
                _renderResults(btn.dataset.cat)
            })
        })
    }

    /* Results list */
    function _renderResults(filterCat) {
        const cats = window.INDICATOR_CATEGORIES || []
        const results = document.getElementById('ipResults')

        let items = cats.flatMap(c => c.items.map(i => ({ ...i, cat: c.key, catLabel: t(c.labelKey) })))

        if (_searchTerm) {
            items = items.filter(i =>
                i.value.toLowerCase().includes(_searchTerm) ||
                t(i.labelKey).toLowerCase().includes(_searchTerm) ||
                (i.aliases || []).some(a => a.toLowerCase().includes(_searchTerm))
            )
        } else if (filterCat) {
            items = items.filter(i => i.cat === filterCat)
        }

        if (!items.length) {
            results.innerHTML = `<div class="ip-empty">${t('picker.no_results')}</div>`
            return
        }

        const grouped = {}
        items.forEach(i => {
            grouped[i.cat] = grouped[i.cat] || { label: i.catLabel, items: [] }
            grouped[i.cat].items.push(i)
        })

        results.innerHTML = Object.values(grouped).map(group => `
      <div class="ip-group">
        <div class="ip-group-label">${group.label}</div>
        ${group.items.map(i => `
          <button type="button" class="ip-item" data-value="${i.value}">
            <span class="ip-item-name">${i.value}</span>
            <span class="ip-item-desc">${t(i.labelKey)}</span>
          </button>
        `).join('')}
      </div>
    `).join('')

        results.querySelectorAll('.ip-item').forEach(btn => {
            btn.addEventListener('click', () => _commit(btn.dataset.value))
        })
    }

    /* Commit selection to whichever picker opened the overlay */
    function _commit(value) {
        if (!_activePicker) return
        _activePicker.value = value // setter fires the 'change' event itself
        _close()
    }

    class IndicatorPicker extends HTMLElement {
        static get observedAttributes() { return ['value'] }

        constructor() {
            super()
            this._value = this.getAttribute('value') || ''
        }

        connectedCallback() {
            if (!this._built) this._build()
            this._syncLabel()
        }

        attributeChangedCallback(name, oldVal, newVal) {
            if (name === 'value' && newVal !== this._value) {
                this._value = newVal || ''
                this._syncLabel()
            }
        }

        get value() { return this._value }
        set value(v) {
            const changed = v !== this._value
            this._value = v
            // Keep the attribute in sync without re-entering attributeChangedCallback loops
            if (this.getAttribute('value') !== v) this.setAttribute('value', v)
            this._syncLabel()
            if (changed) this.dispatchEvent(new Event('change', { bubbles: true }))
        }

        _build() {
            this._built = true
            this.classList.add('ip-trigger')
            this.setAttribute('role', 'button')
            this.setAttribute('tabindex', '0')
            this.innerHTML = `<span class="ip-trigger-label"></span>${isMobileWidth() ? ICONS.panel_bottom : ICONS.maximize}`

            this.addEventListener('click', () => _open(this))
            this.addEventListener('keydown', e => {
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); _open(this) }
            })
        }

        _syncLabel() {
            const label = this.querySelector?.('.ip-trigger-label')
            if (label) label.textContent = this._value
        }
    }

    customElements.define('indicator-picker', IndicatorPicker)

    // Re-render trigger labels / overlay text once i18n is ready, and build
    // the overlay lazily on first open rather than eagerly here.
    document.addEventListener('i18n:ready', () => {
        document.querySelectorAll('indicator-picker').forEach(p => p._syncLabel?.())
        if (_overlayEl) _renderCategories(_activePicker?.value)
    })

    window.IndicatorPicker = IndicatorPicker
})()


/**
 *  Indicator categories config
 * Edit this to organize INDICATORS (from strategy-editor.html) into
 * TradingView-style categories. `labelKey` is optional i18n key;
 * `label` is the fallback / default display string.
 */
window.INDICATOR_CATEGORIES = [
    {
        key: 'momentum',
        labelKey: 'picker.cat.momentum',
        icon: ICONS.momentum,
        items: [
            { value: 'RSI', labelKey: 'picker.ind.rsi' },
            { value: 'STOCH_RSI_K', labelKey: 'picker.ind.stoch_rsi_k' },
            { value: 'STOCH_RSI_D', labelKey: 'picker.ind.stoch_rsi_d' },
            { value: 'MACD', labelKey: 'picker.ind.macd' },
            { value: 'MACD_SIGNAL', labelKey: 'picker.ind.macd_signal' },
            { value: 'MACD_HIST', labelKey: 'picker.ind.macd_hist' },
        ],
    },
    {
        key: 'trend',
        labelKey: 'picker.cat.trend',
        icon: ICONS.trend,
        items: [
            { value: 'EMA', labelKey: 'picker.ind.ema' },
            { value: 'SMA', labelKey: 'picker.ind.sma' },
            { value: 'VWAP', labelKey: 'picker.ind.vwap' },
        ],
    },
    {
        key: 'volatility',
        labelKey: 'picker.cat.volatility',
        icon: ICONS.volatility,
        items: [
            { value: 'BB_UPPER', labelKey: 'picker.ind.bb_upper' },
            { value: 'BB_MID', labelKey: 'picker.ind.bb_mid' },
            { value: 'BB_LOWER', labelKey: 'picker.ind.bb_lower' },
            { value: 'ATR', labelKey: 'picker.ind.atr' },
        ],
    },
    {
        key: 'price_volume',
        labelKey: 'picker.cat.price_volume',
        icon: ICONS.chart,
        items: [
            { value: 'CLOSE', labelKey: 'picker.ind.price' },
            { value: 'OPEN', labelKey: 'picker.ind.open' },
            { value: 'HIGH', labelKey: 'picker.ind.high' },
            { value: 'LOW', labelKey: 'picker.ind.low' },
            { value: 'VOLUME', labelKey: 'picker.ind.volume' },
        ],
    },
]