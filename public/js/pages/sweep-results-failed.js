// Failed runs popover: click on sweepStatusBadge (error/partial_error) to see
// which individual runs failed and why. Same popover shape as tagPopover
// (see sweep-results-tags.js), styled red via .failed-runs-popover.

const FAILED_RUNS_COLLAPSE_THRESHOLD = 5

let _failedRuns         = []
let _failedRunsExpanded = false

function _renderFailedRunsList() {
  const listEl    = document.getElementById('failedRunsList')
  const footer    = document.getElementById('failedRunsFooter')
  const toggleBtn = document.getElementById('failedRunsToggle')

  if (!_failedRuns.length) {
    listEl.innerHTML = `<div class="text-muted text-sm p-sm">${t('sweep.failed_runs.empty')}</div>`
    footer.classList.add('hidden')
    return
  }

  const visible = _failedRunsExpanded ? _failedRuns : _failedRuns.slice(0, FAILED_RUNS_COLLAPSE_THRESHOLD)
  listEl.innerHTML = visible.map(j => `
    <div class="failed-runs-list-item">
      <strong>${t('sweep.failed_runs.run_label', { id: j.id })}</strong>
      ${escHtml(j.errorMessage || t('sweep.failed_runs.no_message'))}
    </div>
  `).join('')

  const hiddenCount = _failedRuns.length - FAILED_RUNS_COLLAPSE_THRESHOLD
  if (hiddenCount > 0) {
    footer.classList.remove('hidden')
    toggleBtn.textContent = _failedRunsExpanded
      ? t('sweep.failed_runs.show_less')
      : t('sweep.failed_runs.show_more', { count: hiddenCount })
  } else {
    footer.classList.add('hidden')
  }
}

function openFailedRunsPopover(anchorEl, failedRuns) {
  _failedRuns         = failedRuns || []
  _failedRunsExpanded = false
  _renderFailedRunsList()

  const popover = document.getElementById('failedRunsPopover')
  popover.classList.remove('hidden')
  const rect = anchorEl.getBoundingClientRect()
  const pw   = popover.offsetWidth  || 280
  const ph   = popover.offsetHeight || 300
  let top    = rect.bottom + 6
  let left   = rect.right  - pw
  if (left < 8) left = 8
  if (left + pw > window.innerWidth - 8) left = window.innerWidth - pw - 8
  if (top + ph > window.innerHeight - 8) top = rect.top - ph - 6
  popover.style.top  = (top  + window.scrollY) + 'px'
  popover.style.left = (left + window.scrollX) + 'px'
}

function closeFailedRunsPopover() {
  document.getElementById('failedRunsPopover').classList.add('hidden')
}

document.getElementById('failedRunsClose').addEventListener('click', closeFailedRunsPopover)
document.getElementById('failedRunsToggle').addEventListener('click', () => {
  _failedRunsExpanded = !_failedRunsExpanded
  _renderFailedRunsList()
})
document.addEventListener('click', e => {
  const popover = document.getElementById('failedRunsPopover')
  if (!popover.classList.contains('hidden') &&
      !popover.contains(e.target) &&
      !e.target.closest('#sweepStatusBadge')) {
    closeFailedRunsPopover()
  }
})