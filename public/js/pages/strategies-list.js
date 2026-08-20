document.addEventListener('header:ready', async () => {
  applyToDOM()
  await loadStrategies()
  autoRefreshTimer = setInterval(async () => { await loadStrategies() }, 5000)
})
initI18n()

let autoRefreshTimer = null
let _lastStrategiesHash = null

async function loadStrategies() {
  try {
    const { strategies } = await api('/strategies')
    document.getElementById('loadingState').classList.add('hidden')
    if (!strategies.length) {
      document.getElementById('emptyState').classList.remove('hidden')
      document.getElementById('strategiesGrid').classList.add('hidden')
      _lastStrategiesHash = null
      return
    }

    const hash = JSON.stringify(strategies)
    if (hash === _lastStrategiesHash) return // no change, skip DOM rebuild
    _lastStrategiesHash = hash

    document.getElementById('emptyState').classList.add('hidden')
    const grid = document.getElementById('strategiesGrid')
    grid.classList.remove('hidden')
    grid.innerHTML = strategies.map(renderStrategyCard).join('')
    bindCardActions()
  } catch (e) {
    toast(t('strategies.load_error'), 'error')
  }
}

function renderStrategyCard(s) {
  const lastJob   = s.jobs?.[0]
  const statusHtml = lastJob
    ? `<span class="status-badge status-${lastJob.status}"><span class="status-dot"></span>${t('status.' + lastJob.status)}</span>`
    : `<span class="status-badge status-none"><span class="status-dot"></span>${t('strategies.never_launched')}</span>`

  const isSweep = lastJob?.sweepGroup?.totalRuns > 1
  const sweepTag = isSweep
    ? `<span class="status-badge status-sweep">${ICONS.shuffle} ${t('strategies.sweep_tag', { n: lastJob.sweepGroup.totalRuns })}</span>`
    : ''

  const pnl = lastJob?.status === 'done' && lastJob.pnlPercent != null
    ? `<span class="tag ${lastJob.pnlPercent >= 0 ? 'tag-success' : 'tag-danger'}">${lastJob.pnlPercent >= 0 ? '+' : ''}${lastJob.pnlPercent.toFixed(2)}%</span>`
    : ''

  const pairsLabel = s.pairs.length > 1
    ? t('strategies.pairs_count', { n: s.pairs.length })
    : escHtml(s.pairs[0])
  const timeframeLabel = formatSweepChoice(s.timeframe).length > 1
    ? t('strategies.sweep_values', { n: formatSweepChoice(s.timeframe).length })
    : escHtml(formatSweepChoice(s.timeframe)[0])

  return `
    <div class="strategy-card glow-card" data-id="${s.id}">
      <div class="strategy-card-header">
        <div class="strategy-card-sup">
          <button class="btn btn-danger btn-sm delete-btn" data-id="${s.id}">${ICONS.cross}</button>
          <span class="status-group">
            ${statusHtml}
            ${sweepTag}
          </span>
        </div>
        <div class="strategy-card-title">${escHtml(s.name)}</div>
      </div>
      ${s.description ? 
        `<div class="strategy-card-desc" data-tooltip="${escHtml(s.description)}">${escHtml(s.description)}</div>`
        :`<div class="strategy-card-desc">${t("strategies.no_desc")}</div>`
      }
      <div class="strategy-tags">
        <span class="tag tag-primary">${pairsLabel}</span>
        <span class="tag">${timeframeLabel}</span>
        <span class="tag">${fmtDate(s.startDate)} - ${fmtDate(s.endDate)}</span>
        ${pnl}
      </div>
      <div class="strategy-card-actions">
        ${lastJob?.status != 'pending' && lastJob?.status != 'running' ?
        `<button class="btn btn-sm launch-btn
          ${lastJob?.status === 'done' ? 'btn-ghost':' btn-primary'}" data-id="${s.id}">
            ${lastJob?.status === 'done' ?
              `${ICONS.replay}${t('strategies.btn.relaunch')}` :
              `${ICONS.play}${t('strategies.btn.launch')}`
            }</button>`:
            ''
          }
        <a href="/strategy-editor.html?id=${s.id}" class="btn btn-ghost btn-sm">${ICONS.pencil}${t('strategies.btn.edit')}</a>
        <button class="btn btn-ghost btn-sm clone-btn" data-id="${s.id}">${ICONS.copy}${t('strategies.btn.clone')}</button>
        ${lastJob?.status === 'done' ?
          (isSweep
            ? `<a href="/sweep-results.html?id=${lastJob.sweepGroup.id}" class="btn btn-ghost btn-sm">${ICONS.chart}${t('strategies.btn.sweep_results')}</a>`
            : `<a href="/results.html?jobId=${lastJob.id}" class="btn btn-ghost btn-sm">${ICONS.chart}${t('strategies.btn.results')}</a>`)
          : ''}
      </div>
    </div>`
}

function bindTooltips() {
  let tooltipEl = document.getElementById('descTooltip')
  if (!tooltipEl) {
    tooltipEl = document.createElement('div')
    tooltipEl.id = 'descTooltip'
    document.body.appendChild(tooltipEl)
  }

  document.querySelectorAll('.strategy-card-desc').forEach(el => {
    const text = el.dataset.tooltip
    if (!text) return
    const show = (x, y) => {
      tooltipEl.textContent = text
      tooltipEl.style.opacity = '0'
      tooltipEl.style.left = '0'
      tooltipEl.style.top = '0'

      const tw = tooltipEl.offsetWidth
      const th = tooltipEl.offsetHeight
      const vw = window.innerWidth
      const vh = window.innerHeight
      const offset = 12
      
      const isMobileWidth = vw <= 850 // 32 = 2rem
      const margin = 8
      const left = isMobileWidth
        ? (vw - tw) / 2
        : x + offset + tw > vw
          ? x - tw - offset
          : x + offset
      
      const leftClamped = Math.min(Math.max(left, margin), vw - tw - margin)

      tooltipEl.style.left = leftClamped + 'px'

      const top = y + offset + th > vh ? y - th - offset : y + offset

      tooltipEl.style.left = left + 'px'
      tooltipEl.style.top  = top  + 'px'
      tooltipEl.style.opacity = '1'
    }
    const hide = () => tooltipEl.style.opacity = '0'

    el.addEventListener('mouseenter', e => show(e.clientX + 12, e.clientY + 12))
    el.addEventListener('mousemove',  e => show(e.clientX + 12, e.clientY + 12))
    el.addEventListener('mouseleave', hide)

    el.addEventListener('touchstart', e => {
      const t = e.touches[0]
      show(t.clientX + 12, t.clientY + 12)
    }, { passive: true })
    el.addEventListener('touchend', () => setTimeout(hide, 1500))
  })
}

function fmtDate(d) { return new Date(d).toLocaleDateString(i18nCurrentLang() === 'fr' ? 'fr-FR' : 'en-GB', { day:'2-digit', month:'2-digit', year:'2-digit' }) }