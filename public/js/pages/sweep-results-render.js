const _tooltip = (() => {
  const el = document.createElement('div')
  el.className = 'error-tooltip'
  document.body.appendChild(el)
  return el
})()

function _showTooltip(e, html) {
  _tooltip.innerHTML = html
  _tooltip.classList.add('visible')
  const tx = e.clientX + 14
  const ty = e.clientY - 10
  let left = tx
  if (left + _tooltip.offsetWidth > window.innerWidth - 8) left = e.clientX - _tooltip.offsetWidth - 14
  if (left < 8) left = 8
  _tooltip.style.left = left + 'px'
  _tooltip.style.top = ty + 'px'
}

function _hideTooltip() { _tooltip.classList.remove('visible') }
window.addEventListener('scroll', () => _hideTooltip(), { passive: true })
window.addEventListener('wheel', () => _hideTooltip(), { passive: true })
window.addEventListener('touchmove', () => _hideTooltip(), { passive: true })

function fmtPct(v) { return v != null ? `${v >= 0 ? '+' : ''}${v.toFixed(2)}%` : '-' }

function safeDescribeSweepValue(path, value, definition) {
  try {
    if (typeof describeSweepValue !== 'function') throw new Error('sweep-labels.js not loaded')
    return describeSweepValue(path, value, definition)
  } catch (_) {
    return `${path}=${JSON.stringify(value)}`
  }
}

function renderGlobalMetrics(g) {
  const grid = document.getElementById('globalMetricsGrid')
  if (!g) {
    grid.innerHTML = `<p class="text-muted text-sm p-sm">${t('sweep.no_results_yet')}</p>`
    return
  }
  const metrics = [
    { key: 'sweep.metric.count',          value: g.count,                                    cls: 'neutral' },
    { key: 'sweep.metric.avg_pnl',        value: fmtPct(g.avgPnlPercent),                     cls: g.avgPnlPercent >= 0 ? 'positive' : 'negative' },
    { key: 'sweep.metric.median_pnl',     value: fmtPct(g.medianPnlPercent),                  cls: g.medianPnlPercent >= 0 ? 'positive' : 'negative' },
    { key: 'sweep.metric.std_pnl',        value: g.stdPnlPercent.toFixed(2) + '%',             cls: 'neutral' },
    { key: 'sweep.metric.pct_profitable', value: g.pctProfitable.toFixed(1) + '%',             cls: g.pctProfitable >= 50 ? 'positive' : 'negative' },
    { key: 'sweep.metric.best',           value: fmtPct(g.bestPnlPercent),                    cls: g.bestPnlPercent >= 0 ? 'positive' : 'negative' },
    { key: 'sweep.metric.worst',          value: fmtPct(g.worstPnlPercent),                   cls: g.worstPnlPercent >= 0 ? 'positive' : 'negative' },
  ]
  grid.innerHTML = metrics.map(m => `
    <div class="metric-card">
      <div class="metric-label">${t(m.key)}</div>
      <div class="metric-value ${m.cls}">${m.value}</div>
    </div>`).join('')
}

function renderCategories(byCategory) {
  const body = document.getElementById('categoriesTableBody')
  if (!byCategory || !byCategory.length) {
    body.innerHTML = `<tr><td colspan="6" class="text-muted text-sm">${t('sweep.categories_empty')}</td></tr>`
    return
  }
  body.innerHTML = byCategory.map(c => {
    const label = c.categoryId === null
      ? `<span class="text-muted">${t('sweep.category.uncategorized')}</span>`
      : `<span class="tag tag-primary">${escHtml(c.name)}</span>`
    if (!c.stats) return `<tr><td>${label}</td><td colspan="5" class="text-muted text-sm">${t('sweep.no_results_yet')}</td></tr>`
    const s = c.stats
    return `<tr>
      <td>${label}</td>
      <td>${s.count}</td>
      <td class="${s.avgPnlPercent >= 0 ? 'pnl-positive' : 'pnl-negative'}">${fmtPct(s.avgPnlPercent)}</td>
      <td>${s.pctProfitable.toFixed(1)}%</td>
      <td class="${s.bestPnlPercent >= 0 ? 'pnl-positive' : 'pnl-negative'}">${fmtPct(s.bestPnlPercent)}</td>
      <td class="${s.worstPnlPercent >= 0 ? 'pnl-positive' : 'pnl-negative'}">${fmtPct(s.worstPnlPercent)}</td>
    </tr>`
  }).join('')
}

function renderSensitivity(sensitivity) {
  const container = document.getElementById('sensitivityContainer')
  if (!sensitivity || !sensitivity.length) {
    container.innerHTML = `<p class="text-muted text-sm p-sm">${t('sweep.sensitivity_empty')}</p>`
    return
  }
  container.innerHTML = sensitivity.map(axis => `
    <div class="mb-md">
      <div class="subtitle text-muted mt-sm mb-sm">${escHtml(describeSweepAxis(axis.path, currentSweep.definition))}</div>
      <div class="table-wrap">
        <table>
          <thead><tr>
            <th>${t('sweep.table.params')}</th>
            <th>${t('sweep.metric.count')}</th>
            <th>${t('sweep.metric.avg_pnl')}</th>
            <th>${t('sweep.metric.pct_profitable')}</th>
          </tr></thead>
          <tbody>
            ${axis.values.map(v => {
              const label = escHtml(safeDescribeSweepValue(axis.path, v.value, currentSweep.definition))
              if (!v.stats) return `<tr><td>${label}</td><td colspan="3" class="text-muted text-sm">${t('sweep.no_results_yet')}</td></tr>`
              return `<tr>
                <td>${label}</td>
                <td>${v.stats.count}</td>
                <td class="${v.stats.avgPnlPercent >= 0 ? 'pnl-positive' : 'pnl-negative'}">${fmtPct(v.stats.avgPnlPercent)}</td>
                <td>${v.stats.pctProfitable.toFixed(1)}%</td>
              </tr>`
            }).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `).join('')
}

function renderCombosTable(bodyId, jobs) {
  const body = document.getElementById(bodyId)
  if (!jobs || !jobs.length) {
    body.innerHTML = `<tr><td colspan="7" class="text-muted text-sm">${t('sweep.no_results_yet')}</td></tr>`
    return
  }
  body.innerHTML = jobs.map(j => {
    const tags = getJobTags(j)
    const tagsHtml = tags.map(tg =>
      `<span class="tag-chip" style="background:${tg.color}20;color:${tg.color};border-color:${tg.color}40">${escHtml(tg.name)}</span>`
    ).join('')
    return `
    <tr>
      <td>
        <span class="tag tag-primary">${escHtml(j.pair || '-')}</span>
        ${tagsHtml ? `<div class="job-row-tags">${tagsHtml}</div>` : ''}
      </td>
      <td class="text-muted text-sm" style="font-family:var(--mono)">
        ${escHtml(Object.entries(j.paramValues || {})
          .map(([k, v]) => safeDescribeSweepValue(k, v, currentSweep.definition))
          .join(', ')) || '-'}
      </td>
      <td class="${j.pnlPercent >= 0 ? 'pnl-positive' : 'pnl-negative'}">${fmtPct(j.pnlPercent)}</td>
      <td>${j.sharpeRatio != null ? j.sharpeRatio.toFixed(2) : '-'}</td>
      <td>${j.winRate != null ? j.winRate.toFixed(1) + '%' : '-'}</td>
      <td style="color:var(--danger)">${j.maxDrawdown != null ? '-' + j.maxDrawdown.toFixed(2) + '%' : '-'}</td>
      <td class="td-actions">
        <div class="td-actions-inner">
          <a href="/results.html?jobId=${j.id}" class="btn btn-ghost btn-sm">${ICONS.chart}${t('sweep.table.view')}</a>
          <button class="btn btn-ghost btn-sm assign-tags-btn" data-id="${j.id}" title="Tags">${ICONS.tag}</button>
        </div>
      </td>
    </tr>`
  }).join('')
  document.querySelectorAll('.assign-tags-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation()
      openTagPopover(parseInt(btn.dataset.id), btn)
    })
  })
}

function findJobById(id) {
  return [...(currentSweep?.all || []), ...(currentSweep?.best || []), ...(currentSweep?.worst || [])].find(j => j.id === id)
}