let allJobs = []
let allTags = []
let currentPage = 1
let totalPages = 1
const _pref = JSON.parse(localStorage.getItem('jobs_prefs') || '{}')
let sortBy = _pref.sortBy || 'date'
let sortAsc = _pref.sortAsc ?? false
let groupBy = _pref.groupBy || 'none'
let filterStat = _pref.filterStat || 'all'
let popoverJobId = null
let collapsedGroups = new Set()
let autoRefreshTimer = null

const tagManager = new TagManager({ onTagsChanged: () => { allTags = tagManager.tags } })

const _tooltip = (() => {
  const el = document.createElement('div')
  el.className = 'ctx-tooltip'
  document.body.appendChild(el)
  return el
})()

function _showTooltip(e, html, variant = null) {
  _tooltip.innerHTML = html
  _tooltip.classList.toggle('variant-danger', variant === 'danger')
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

function savePrefs() {
  localStorage.setItem('jobs_prefs', JSON.stringify({ sortBy, sortAsc, groupBy, filterStat }))
}

const IDLE_POLL_MS = 5000
const ACTIVE_POLL_MS = 5000
const BG_POLL_MS = 30000

function _hasActiveJobs() {
  return allJobs.some(j => j.status === 'pending' || j.status === 'running' ||
    (j.itemType === 'sweep' && j.status === 'running'))
}

function _scheduleNextPoll() {
  clearTimeout(autoRefreshTimer)
  if (document.hidden) {
    autoRefreshTimer = setTimeout(_tick, BG_POLL_MS)
    return
  }
  const delay = _hasActiveJobs() ? ACTIVE_POLL_MS : IDLE_POLL_MS * 4
  autoRefreshTimer = setTimeout(_tick, delay)
}

async function _tick() {
  await loadJobs()
  await pollWorkerStatus()
  _scheduleNextPoll()
}

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) { clearTimeout(autoRefreshTimer); _tick() }
})

let _debounceTimer = null
function _onLiveUpdate() {
  clearTimeout(_debounceTimer)
  _debounceTimer = setTimeout(loadJobs, 200)
}

function _connectEventStream() {
  const es = new EventSource('/api/events/stream')
  es.addEventListener('sweep:update', _onLiveUpdate)
  es.onerror = () => { } // EventSource retry auto
  return es
}

document.addEventListener('header:ready', async () => {
  applyToDOM()
  updateSortIndicators()
  await Promise.all([loadJobs(), loadTags()])
  pollWorkerStatus()
  _connectEventStream()
  autoRefreshTimer = setInterval(pollWorkerStatus, 15000) // no push for the worker, stay in light poll
})

document.getElementById('refreshBtn').addEventListener('click', () => { loadJobs(); pollWorkerStatus() })

// Worker status
async function pollWorkerStatus() {
  try {
    const { connected, worker } = await api('/worker/status')
    const el = document.getElementById('workerStatus')
    const label = document.getElementById('workerStatusLabel')
    if (connected) {
      el.className = 'status-badge status-running'
      label.textContent = t('jobs.worker.connected') + (worker?.name ? ' - ' + worker.name : '')
    } else {
      el.className = 'status-badge status-error'
      label.textContent = t('jobs.worker.disconnected')
    }
  } catch (_) { }
}

let _lastJobsHash = null
async function loadJobs(page = currentPage) {
  try {
    const sortField = { date: 'createdAt', pnl: 'pnlPercent', sharpe: 'sharpeRatio', winrate: 'winRate', drawdown: 'maxDrawdown', trades: 'totalTrades' }[sortBy] || 'createdAt'
    const params = new URLSearchParams({
      page,
      limit: groupBy !== 'none' ? 9999 : 20,
      sort: sortField,
      order: sortAsc ? 'asc' : 'desc',
      ...(filterStat !== 'all' ? { status: filterStat } : {}),
    })
    const { jobs, total, totalPages: tp } = await api(`/jobs?${params}`)
    const hash = groupBy + '|' + params.toString() + '|' + JSON.stringify(jobs) + '|' + total + '|' + tp
    if (hash === _lastJobsHash) {
      document.getElementById('loadingState').classList.add('hidden')
      return
    }
    _lastJobsHash = hash

    allJobs = jobs
    currentPage = page
    totalPages = tp
    renderJobs()
    document.getElementById('loadingState').classList.add('hidden')
  } catch (e) {
    toast(t('jobs.load_error'), 'error')
  }
}

async function loadTags() {
  await tagManager.load()
  allTags = tagManager.tags
}