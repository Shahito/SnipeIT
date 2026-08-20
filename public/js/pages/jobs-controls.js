// Controls
function restoreControlsUI() {
  document.querySelectorAll('#sortGroup .toggle-btn')
    .forEach(b => b.classList.toggle('active', b.dataset.sort === sortBy))
  document.querySelectorAll('#groupGroup .toggle-btn')
    .forEach(b => b.classList.toggle('active', b.dataset.group === groupBy))
  document.querySelectorAll('#filterGroup .toggle-btn')
    .forEach(b => b.classList.toggle('active', b.dataset.filter === filterStat))
  updateSortIndicators()
}

document.getElementById('sortGroup').addEventListener('click', e => {
  const btn = e.target.closest('[data-sort]')
  if (!btn) return
  if (sortBy === btn.dataset.sort) {
    sortAsc = !sortAsc
  } else {
    sortBy = btn.dataset.sort
    sortAsc = false
  }
  document.querySelectorAll('#sortGroup .toggle-btn')
    .forEach(b => b.classList.toggle('active', b === btn))
  updateSortIndicators()
  savePrefs()
  loadJobs(1)
})
function updateSortIndicators() {
  document.querySelectorAll('#sortGroup .toggle-btn').forEach(btn => {
    const label = btn.dataset.originalLabel || btn.textContent
    btn.dataset.originalLabel = label
    if (btn.dataset.sort === sortBy) {
      btn.innerHTML = `${sortAsc ? ICONS.sort_arrow_up : ICONS.sort_arrow_down} ${label}`
    } else {
      btn.textContent = label
    }
  })
}

document.getElementById('groupGroup').addEventListener('click', e => {
  const btn = e.target.closest('[data-group]'); if (!btn) return
  groupBy = btn.dataset.group
  collapsedGroups.clear()
  document.querySelectorAll('#groupGroup .toggle-btn').forEach(b => b.classList.toggle('active', b === btn))
  savePrefs()
  loadJobs(1)
})

document.getElementById('filterGroup').addEventListener('click', e => {
  const btn = e.target.closest('[data-filter]'); if (!btn) return
  filterStat = btn.dataset.filter
  document.querySelectorAll('#filterGroup .toggle-btn').forEach(b => b.classList.toggle('active', b === btn))
  savePrefs()
  loadJobs(1)
})

function renderPagination() {
  const bar  = document.getElementById('paginationBar')
  const prev = document.getElementById('prevPageBtn')
  const next = document.getElementById('nextPageBtn')
  const first = document.getElementById('firstPageBtn')
  const last = document.getElementById('lastPageBtn')
  document.getElementById('pageIndicator').textContent = `${currentPage} / ${totalPages}`
  prev.disabled = currentPage <= 1
  first.disabled = currentPage <= 1
  next.disabled = currentPage >= totalPages
  last.disabled = currentPage >= totalPages
  bar.classList.toggle('hidden', totalPages <= 1 || groupBy !== 'none')
  first.classList.toggle('hidden', totalPages <= 2)
  last.classList.toggle('hidden', totalPages <= 2)
}

function loadAndScrollTop(idx) {
  loadJobs(idx)
  window.scrollTo(0, 0)
}

document.getElementById('prevPageBtn').addEventListener('click', () => loadAndScrollTop(currentPage - 1))
document.getElementById('nextPageBtn').addEventListener('click', () => loadAndScrollTop(currentPage + 1))
document.getElementById('firstPageBtn').addEventListener('click', () => loadAndScrollTop(1))
document.getElementById('lastPageBtn').addEventListener('click', () => loadAndScrollTop(totalPages))
document.getElementById('emptyResetBtn').addEventListener('click', () => {
  filterStat = 'all'
  document.querySelectorAll('#filterGroup .toggle-btn').forEach(b => b.classList.toggle('active', b.dataset.filter === 'all'))
  savePrefs()
  loadJobs(1)
})

restoreControlsUI()