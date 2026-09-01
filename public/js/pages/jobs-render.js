// Render
function getJobTags(job) { return (job.jobTags || []).map(jt => jt.tag) }

function getSortValue(job) {
  switch (sortBy) {
    case 'date':     return new Date(job.createdAt).getTime()
    case 'pnl':      return job.pnlPercent   ?? -Infinity
    case 'sharpe':   return job.sharpeRatio  ?? -Infinity
    case 'winrate':  return job.winRate       ?? -Infinity
    case 'drawdown': return job.maxDrawdown   ?? -Infinity
    case 'trades':   return job.totalTrades   ?? -Infinity
    default:         return 0
  }
}

function groupJobs(jobs) {
  if (groupBy === 'none') return { '': jobs }
  const groups = {}
  for (const job of jobs) {
    let keys = []
    if (groupBy === 'pair') {
      keys = job.itemType === 'sweep' ? [t('jobs.group.sweep')] : [job.pair || job.strategySnapshot?.pair || '?']
    }
    if (groupBy === 'status') keys = [job.status]
    if (groupBy === 'profit') {
      const p = job.pnlPercent ?? null
      keys = [p === null ? t('jobs.group.no_result') : p >= 0 ? t('jobs.group.profitable') : t('jobs.group.loss')]
    }
    if (groupBy === 'tag') {
      const tags = job.itemType === 'sweep' ? [] : getJobTags(job)
      keys = tags.length ? tags.map(t2 => t2.name + '|||' + t2.color) : [t('jobs.group.no_tag')]
    }
    if (groupBy === 'strategy') {
      keys = [job.strategy.id + '|||' + job.strategy.name]
    }
    keys.forEach(k => { (groups[k] = groups[k] || []).push(job) })
    
  }
  return groups
}

function renderJobs() {
  const grouped = groupJobs(allJobs)
  const content  = document.getElementById('jobsContent')

  if (!allJobs.length) {
    const isFiltered = filterStat !== 'all'
    document.getElementById('emptyState').classList.remove('hidden')
    content.classList.add('hidden')
    document.getElementById('paginationBar').classList.add('hidden')

    document.getElementById('emptyTitle').textContent = isFiltered ? t('jobs.empty.filtered_title') : t('jobs.empty.title')
    document.getElementById('emptyDesc').textContent = isFiltered ? t('jobs.empty.filtered_desc')  : t('jobs.empty.desc')
    document.getElementById('emptyCreateBtn').classList.toggle('hidden', isFiltered)
    document.getElementById('emptyResetBtn').classList.toggle('hidden', !isFiltered)
    return
  }
    document.getElementById('emptyState').classList.add('hidden')
  content.classList.remove('hidden')

  const hasGroups = groupBy !== 'none'

  const html = Object.entries(grouped).map(([groupKey, jobs]) => {
    const rows = jobs.map(j => j.itemType === 'sweep' ? renderSweepRow(j) : renderJobRow(j)).join('')
    if (!hasGroups) return `<div class="jobs-group">${rows}</div>`

    const isCollapsed = collapsedGroups.has(groupKey)
    const header = renderGroupHeader(groupKey, isCollapsed, jobs.length)
    return `
      <div class="jobs-group-block" data-group-key="${escAttr(groupKey)}">
        ${header}
        <div class="jobs-group-wrap${isCollapsed ? ' collapsed' : ''}">
          <div class="jobs-group">${rows}</div>
        </div>
      </div>`
  }).join('')

  content.innerHTML = html || `<div class="empty-state"><p class="text-muted">${t('jobs.empty.filter')}</p></div>`
  bindJobActions()
  bindGroupToggles()
  renderPagination()
}

function renderGroupHeader(key, isCollapsed, count) {
  const parts = key.split('|||')
  let labelHtml
  if (parts.length === 2) {
    const [first, second] = parts
    if (second.match(/^#[0-9a-fA-F]{3,6}$/)) {
      // tag: name|||#color
      labelHtml = `<span class="tag-chip" style="background:${second}20;color:${second};border-color:${second}40">${escHtml(first)}</span>`
    } else {
      // strategy: id|||name
      labelHtml = `<span class="group-header-label">${escHtml(second)}</span>`
    }
  } else {
    const statusLabels = { pending: t('status.pending'), running: t('status.running'), done: t('status.done'), error: t('status.error') }
    labelHtml = `<span class="group-header-label">${escHtml(statusLabels[key] || key)}</span>`
  }
  return `
    <div class="group-header group-header--toggle" data-toggle-group="${escAttr(key)}">
      <span class="group-toggle-arrow${isCollapsed ? '' : ' open'}">${ICONS.chevron_right}</span>
      ${labelHtml}
      <span class="group-count">${count}</span>
    </div>`
}

function bindGroupToggles() {
  document.querySelectorAll('.group-header--toggle').forEach(header => {
    header.addEventListener('click', () => {
      const key = header.dataset.toggleGroup
      const block = document.querySelector(`.jobs-group-block[data-group-key="${CSS.escape(key)}"]`)
      const wrap  = block?.querySelector('.jobs-group-wrap')
      const arrow = header.querySelector('.group-toggle-arrow')
      if (!wrap) return
      if (collapsedGroups.has(key)) {
        collapsedGroups.delete(key)
        wrap.classList.remove('collapsed')
        arrow?.classList.add('open')
      } else {
        collapsedGroups.add(key)
        wrap.classList.add('collapsed')
        arrow?.classList.remove('open')
      }
    })
  })
}

function renderSweepRow(s) {
  const pnlHtml    = s.pnlPercent != null
    ? `<div class="text-sm ${s.pnlPercent >= 0 ? 'pnl-positive' : 'pnl-negative'}">${s.pnlPercent >= 0 ? '+' : ''}${s.pnlPercent.toFixed(2)}%</div>`
    : `<div class="text-sm text-muted">-</div>`
  const sharpeHtml = s.sharpeRatio != null ? s.sharpeRatio.toFixed(2) : '-'
  const winHtml    = s.winRate     != null ? s.winRate.toFixed(1) + '%' : '-'
  const ddHtml     = s.maxDrawdown != null ? '-' + s.maxDrawdown.toFixed(2) + '%' : '-'

  const sweepHasDuration = s.status === 'done' && s.startedAt && s.completedAt

  return `<div class="job-row" data-sweep-id="${s.id}">
    <div class="job-row-main">
      <div class="job-row-left">
      <span class="status-badge status-${s.status === 'partial_error' ? 'error' : s.status} ${sweepHasDuration ? 'has-duration' : ''}"
          ${s.status === 'partial_error' ? `data-partial-error="1"` : ''}
          ${sweepHasDuration ? `data-duration="${escAttr(fmtDuration(new Date(s.completedAt) - new Date(s.startedAt)))}"` : ''}>
          <span class="status-dot"></span>${t('sweep.status.' + s.status)}
        </span>
        <div class="job-row-meta">
          <a href="/strategy-editor.html?id=${s.strategy.id}" class="job-strategy-name">${ICONS.shuffle} ${escHtml(s.strategy.name)}</a>
          <div class="job-row-sub">
            <span class="tag tag-primary">${t('jobs.sweep.runs_count', { n: s.totalRuns })}</span>
            <span class="text-muted text-sm">${fmtDateTime(s.createdAt)}</span>
          </div>
        </div>
      </div>
      <div class="job-row-metrics">
        <div class="job-metric"><div class="job-metric-label">${t('jobs.metric.pnl')} ${t('jobs.sweep.avg')}</div>${pnlHtml}</div>
        <div class="job-metric"><div class="job-metric-label">${t('jobs.metric.sharpe')}</div><div class="text-sm">${sharpeHtml}</div></div>
        <div class="job-metric"><div class="job-metric-label">${t('jobs.metric.winrate')}</div><div class="text-sm">${winHtml}</div></div>
        <div class="job-metric"><div class="job-metric-label">${t('jobs.metric.maxdd')}</div><div class="text-sm" style="color:var(--danger)">${ddHtml}</div></div>
      </div>
      <div class="job-row-actions">
        <a href="/sweep-results.html?id=${s.id}" class="btn btn-ghost btn-sm">
          ${ICONS.chart_pie}${t('jobs.sweep.view')}
        </a>
      </div>
    </div>
  </div>`
}

function renderJobRow(j) {
  const tags = getJobTags(j)

  const pnlHtml    = j.pnlPercent != null
    ? `<div class="text-sm ${j.pnlPercent >= 0 ? 'pnl-positive' : 'pnl-negative'}">${j.pnlPercent >= 0 ? '+' : ''}${j.pnlPercent.toFixed(2)}%</div>`
    : `<div class="text-sm text-muted">-</div>`
  const sharpeHtml = j.sharpeRatio != null ? j.sharpeRatio.toFixed(2) : '-'
  const winHtml    = j.winRate     != null ? j.winRate.toFixed(1) + '%' : '-'
  const ddHtml     = j.maxDrawdown != null ? '-' + j.maxDrawdown.toFixed(2) + '%' : '-'
  const tagsHtml   = tags.map(tg =>
    `<span class="tag-chip" style="background:${tg.color}20;color:${tg.color};border-color:${tg.color}40">${escHtml(tg.name)}</span>`
  ).join('')

  return `<div class="job-row" data-id="${j.id}">
    <div class="job-row-main">
      <div class="job-row-left">
        <span class="status-badge status-${j.status} ${j.status === 'error' && j.errorMessage ? 'has-error-msg' : ''} ${j.startedAt && j.completedAt ? 'has-duration' : ''}"
          data-error-msg="${j.status === 'error' && j.errorMessage ? `${j.id}: ${escAttr(j.errorMessage)}` : ''}"
          data-duration="${j.startedAt && j.completedAt ? escAttr(fmtDuration(new Date(j.completedAt) - new Date(j.startedAt))) : ''}">
          <span class="status-dot"></span>${t('status.' + j.status)}
        </span>
        <div class="job-row-meta">
          <a href="/strategy-editor.html?id=${j.strategy.id}" class="job-strategy-name">${escHtml(j.strategy.name)}</a>
          <div class="job-row-sub">
            <span class="tag tag-primary">${j.pair ?? j.strategySnapshot?.pair ?? '?'}</span>
            <span class="tag">${j.strategySnapshot?.timeframe ?? '?'}</span>
            <span class="text-muted text-sm">${fmtDateTime(j.createdAt)}</span>          </div>
        </div>
      </div>
      <div class="job-row-metrics">
        <div class="job-metric"><div class="job-metric-label">${t('jobs.metric.pnl')}</div>${pnlHtml}</div>
        <div class="job-metric"><div class="job-metric-label">${t('jobs.metric.sharpe')}</div><div class="text-sm">${sharpeHtml}</div></div>
        <div class="job-metric"><div class="job-metric-label">${t('jobs.metric.winrate')}</div><div class="text-sm">${winHtml}</div></div>
        <div class="job-metric"><div class="job-metric-label">${t('jobs.metric.maxdd')}</div><div class="text-sm" style="color:var(--danger)">${ddHtml}</div></div>
      </div>
      <div class="job-row-actions">
        ${j.status === 'done' ? `
          <a href="/results.html?jobId=${j.id}" class="btn btn-ghost btn-sm">
            ${ICONS.chart}
            <span>${t('jobs.btn.results')}</span>
          </a>
          ` : ''}
        ${j.status === 'pending' ? `<button class="btn btn-danger btn-sm cancel-btn" data-id="${j.id}">${ICONS.cross}</button>` : ''}
        <button class="btn btn-ghost btn-sm assign-tags-btn" data-id="${j.id}" title="Tags">${ICONS.tag}</button>
      </div>
    </div>
    ${tags.length ? `<div class="job-row-tags">${tagsHtml}</div>` : ''}
  </div>`
}

function bindJobActions() {
  document.querySelectorAll('.cancel-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      btn.disabled = true
      try {
        await api(`/jobs/${btn.dataset.id}/cancel`, { method: 'POST' })
        toast(t('jobs.cancelled'), 'success'); loadJobs()
      } catch (e) { toast(t('error.' + e.code), 'error'); btn.disabled = false }
    })
  })
  document.querySelectorAll('.assign-tags-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation()
      openTagPopover(parseInt(btn.dataset.id), btn)
    })
  })
  document.querySelectorAll('[data-partial-error]').forEach(badge => {
    const msg = `<span>${t('sweep.status.partial_error.hint')}</span>`
    badge.addEventListener('mouseenter', e => _showTooltip(e, msg, 'danger'))
    badge.addEventListener('mousemove',  e => _showTooltip(e, msg, 'danger'))
    badge.addEventListener('mouseleave', () => _hideTooltip())
  })
  document.querySelectorAll('.has-error-msg').forEach(badge => {
    badge.addEventListener('mouseenter', e => _showTooltip(e, `<span>${badge.dataset.errorMsg}</span>`, 'danger'))
    badge.addEventListener('mousemove',  e => _showTooltip(e, `<span>${badge.dataset.errorMsg}</span>`, 'danger'))
    badge.addEventListener('mouseleave', () => _hideTooltip())
    badge.addEventListener('click',      e => { e.stopPropagation(); _showTooltip(e, `<span>${badge.dataset.errorMsg}</span>`, 'danger') })
  })
  document.querySelectorAll('.has-duration').forEach(badge => {
    const msg = `<span class="tt-with-icon">${ICONS.clock}<span>${badge.dataset.duration}</span></span>`
    badge.addEventListener('mouseenter', e => _showTooltip(e, msg))
    badge.addEventListener('mousemove',  e => _showTooltip(e, msg))
    badge.addEventListener('mouseleave', () => _hideTooltip())
  })
}

window.addEventListener('scroll', () => _hideTooltip(), { passive: true })

function fmtDateTime(d) {
  return new Date(d).toLocaleString(i18nCurrentLang() === 'fr' ? 'fr-FR' : 'en-US', { day:'2-digit', month:'2-digit', year:'2-digit', hour:'2-digit', minute:'2-digit' })
}