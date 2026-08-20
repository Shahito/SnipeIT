// Tags modal
document.getElementById('manageTagsBtn').addEventListener('click', () => {
  renderTagsList()
  openModal('tagsModal', 'tagsModalClose')
})
document.getElementById('tagsModalClose').addEventListener('click', () => closeModal('tagsModal'))

bindModalKeys('tagsModal', {
  onCancel: () => closeModal('tagsModal'),
})

function renderTagsList() {
  tagManager.mountManageList(document.getElementById('tagsList'))
  allTags = tagManager.tags
}

tagManager.mountCreateForm({
  nameInput: document.getElementById('tagNameInput'),
  paletteContainer: document.getElementById('tagPaletteContainer'),
  createBtn: document.getElementById('createTagBtn'),
  errorEl: document.getElementById('tagCreateError'),
})
// re-renders list + refreshes jobs after each create/update/delete
tagManager.onTagsChanged = () => { allTags = tagManager.tags; renderTagsList(); loadJobs() }

const assignPopover = tagManager.mountAssignPopover({
  listEl: document.getElementById('popoverTagList'),
  buildEndpoint: (jobId) => `/tags/jobs/${jobId}`,
  getSelectedIds: (jobId) => {
    const job = allJobs.find(j => j.id === jobId)
    return job ? getJobTags(job).map(tg => tg.id) : []
  },
  onAssignChange: () => loadJobs(),
  onError: (e) => toast(t('error.' + e.code), 'error'),
})

// Popover contextuel
function openTagPopover(jobId, anchorEl) {
  const job = allJobs.find(j => j.id === jobId)
  if (!job) return

  popoverJobId = jobId
  document.getElementById('popoverTitle').textContent = `#${jobId} - ${job.strategy.name}`
  assignPopover.render(jobId)

  // Positionner le popover près du bouton
  const popover = document.getElementById('tagPopover')
  popover.classList.remove('hidden')

  const rect    = anchorEl.getBoundingClientRect()
  const pw      = popover.offsetWidth  || 240
  const ph      = popover.offsetHeight || 300
  let   top     = rect.bottom + 6
  let   left    = rect.right  - pw

  if (left < 8) left = 8
  if (left + pw > window.innerWidth - 8) left = window.innerWidth - pw - 8
  if (top + ph > window.innerHeight - 8) top = rect.top - ph - 6

  popover.style.top  = top  + 'px'
  popover.style.left = left + 'px'
}

function closePopover() {
  popoverJobId = null
  document.getElementById('tagPopover').classList.add('hidden')
}

document.getElementById('popoverClose').addEventListener('click', closePopover)

// Close popover by clicking outside
document.addEventListener('click', e => {
  const popover = document.getElementById('tagPopover')
  if (!popover.classList.contains('hidden') &&
      !popover.contains(e.target) &&
      !e.target.closest('.assign-tags-btn')) {
    closePopover()
  }
})