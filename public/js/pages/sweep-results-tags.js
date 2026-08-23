const assignPopover = tagManager.mountAssignPopover({
  listEl: document.getElementById('popoverTagList'),
  buildEndpoint: (jobId) => `/tags/jobs/${jobId}`,
  getSelectedIds: (jobId) => {
    const job = findJobById(jobId)
    return job ? getJobTags(job).map(tg => tg.id) : []
  },
  onAssignChange: () => loadSweep(),
  onError: (e) => toast(t('error.' + e.code), 'error'),
})

function openTagPopover(jobId, anchorEl) {
  const job = findJobById(jobId)
  if (!job) return

  popoverJobId = jobId
  document.getElementById('popoverTitle').textContent = `#${jobId}`
  assignPopover.render(jobId)

  const popover = document.getElementById('tagPopover')
  popover.classList.remove('hidden')
  const rect = anchorEl.getBoundingClientRect()
  const pw   = popover.offsetWidth  || 240
  const ph   = popover.offsetHeight || 300
  let top    = rect.bottom + 6
  let left   = rect.right  - pw
  if (left < 8) left = 8
  if (left + pw > window.innerWidth - 8) left = window.innerWidth - pw - 8
  if (top + ph > window.innerHeight - 8) top = rect.top - ph - 6
  popover.style.top  = (top  + window.scrollY) + 'px'
  popover.style.left = (left + window.scrollX) + 'px'
}

function closeTagPopover() {
  popoverJobId = null
  document.getElementById('tagPopover').classList.add('hidden')
}

document.getElementById('popoverClose').addEventListener('click', closeTagPopover)
document.addEventListener('click', e => {
  const popover = document.getElementById('tagPopover')
  if (!popover.classList.contains('hidden') &&
      !popover.contains(e.target) &&
      !e.target.closest('.assign-tags-btn')) {
    closeTagPopover()
  }
})