const urlParams  = new URLSearchParams(location.search)
const sweepId    = urlParams.get('id') ? parseInt(urlParams.get('id')) : null
let _sweepEventSource = null
let currentSweep = null
let allTags      = []
let popoverJobId = null

const tagManager = new TagManager({ onTagsChanged: () => { allTags = tagManager.tags } })

document.addEventListener('header:ready', async () => {
  applyToDOM()
  if (!sweepId) { window.location.href = '/jobs.html'; return }
  await loadTags()
  await loadSweep()
})
initI18n()
initExport()

async function loadTags() {
  await tagManager.load()
  allTags = tagManager.tags
}

function getJobTags(job) { return (job.jobTags || []).map(jt => jt.tag) }

async function loadSweep() {
  try {
    const { sweep } = await api(`/sweeps/${sweepId}`)
    currentSweep = sweep
    _exportData = sweep
    window._exportData = sweep
    
    document.getElementById('loadingState').classList.add('hidden')
    document.getElementById('sweepContent').classList.remove('hidden')

    const isTerminal = sweep.status === 'done' || sweep.status === 'partial_error' || sweep.status === 'error'
    if (isTerminal && _sweepEventSource) { _sweepEventSource.close(); _sweepEventSource = null }
    if (!isTerminal && !_sweepEventSource) {
      _sweepEventSource = new EventSource('/api/events/stream')
      _sweepEventSource.addEventListener('sweep:update', e => {
        const data = JSON.parse(e.data)
        if (data.sweepGroupId === sweepId) loadSweep()
      })
    }

    document.getElementById('sweepTitle').textContent = `${t('sweep.title')} - ${sweep.strategy.name}`
    document.getElementById('sweepMeta').textContent  = t('sweep.progress', { done: sweep.counts.done, total: sweep.totalRuns })
    document.getElementById('sweepStatusBadge').className = 'status-badge status-' + (sweep.status === 'partial_error' ? 'error' : sweep.status)
    document.getElementById('sweepStatusLabel').textContent = t('sweep.status.' + sweep.status)
    const badge = document.getElementById('sweepStatusBadge')
    if (sweep.status === 'partial_error') {
      const msg = `<span>${t('sweep.status.partial_error.hint')}</span>`
      badge.onmouseenter = e => _showTooltip(e, msg)
      badge.onmousemove  = e => _showTooltip(e, msg)
      badge.onmouseleave = () => _hideTooltip()
    } else {
      badge.onmouseenter = badge.onmousemove = badge.onmouseleave = null
      _hideTooltip()
    }

    renderGlobalMetrics(sweep.global)
    renderCategories(sweep.byCategory)
    renderSensitivity(sweep.sensitivity)

    const worstCard = document.getElementById('worstCard')
    const bestCardTitle = document.getElementById('bestCardTitle')
    if (sweep.all) {
      // Petit sweep : une seule liste "tous les runs" plutôt que best/worst qui se recoupent.
      worstCard.classList.add('hidden')
      bestCardTitle.removeAttribute('data-i18n')
      bestCardTitle.textContent = t('sweep.all_title')
      renderCombosTable('bestTableBody', sweep.all)
    } else {
      worstCard.classList.remove('hidden')
      bestCardTitle.setAttribute('data-i18n', 'sweep.best_title')
      bestCardTitle.textContent = t('sweep.best_title')
      renderCombosTable('bestTableBody', sweep.best)
      renderCombosTable('worstTableBody', sweep.worst)
    }
  } catch (e) {
    document.getElementById('loadingState').classList.add('hidden')
    document.getElementById('errorState').classList.remove('hidden')
  }
}