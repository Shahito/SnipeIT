function updateClearFiltersBtn() {
  const isDefault = sortBy === 'date' && !sortAsc && groupBy === 'none' && filterStat === 'all'
  document.getElementById('clearFiltersBtn').disabled = isDefault
}

document.getElementById('filtersToggleBtn').addEventListener('click', () => {
  const panel = document.getElementById('jobsFiltersPanel')
  const btn = document.getElementById('filtersToggleBtn')
  const isOpen = panel.classList.toggle('hidden') === false
  btn.classList.toggle('active', isOpen)
  btn.setAttribute('aria-expanded', String(isOpen))
})

// Controls
const sortSelect = initCustomSelect(document.getElementById('sortSelect'), {
  onChange: (value) => {
    if (sortBy === value) {
      sortAsc = !sortAsc
    } else {
      sortBy = value
      sortAsc = false
    }
    updateSortIndicators()
    updateClearFiltersBtn()
    savePrefs()
    loadJobs(1)
  }
})

const groupSelect = initCustomSelect(document.getElementById('groupSelect'), {
  onChange: (value) => {
    groupBy = value
    collapsedGroups.clear()
    updateClearFiltersBtn()
    savePrefs()
    loadJobs(1)
  }
})

const filterSelect = initCustomSelect(document.getElementById('filterSelect'), {
  onChange: (value) => {
    filterStat = value
    updateClearFiltersBtn()
    savePrefs()
    loadJobs(1)
  }
})

document.getElementById('sortDirBtn').addEventListener('click', () => {
  sortAsc = !sortAsc
  updateSortIndicators()
  updateClearFiltersBtn()
  savePrefs()
  loadJobs(1)
})

document.getElementById('clearFiltersBtn').addEventListener('click', () => {
  sortBy = 'date'
  sortAsc = false
  groupBy = 'none'
  filterStat = 'all'
  collapsedGroups.clear()
  sortSelect.setValue(sortBy, { silent: true })
  groupSelect.setValue(groupBy, { silent: true })
  filterSelect.setValue(filterStat, { silent: true })
  updateSortIndicators()
  updateClearFiltersBtn()
  savePrefs()
  loadJobs(1)
})

function restoreControlsUI() {
  sortSelect.setValue(sortBy, { silent: true })
  groupSelect.setValue(groupBy, { silent: true })
  filterSelect.setValue(filterStat, { silent: true })
  updateSortIndicators()
  updateClearFiltersBtn()
}

function updateSortIndicators() {
  document.getElementById('sortDirBtn').innerHTML =
    sortAsc ? ICONS.sort_arrow_up : ICONS.sort_arrow_down
}

function renderPagination() {
  const bar = document.getElementById('paginationBar')
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
  filterSelect.setValue('all', { silent: true })
  updateClearFiltersBtn()
  savePrefs()
  loadJobs(1)
})

function syncJobsSelectLabels() {
  sortSelect.syncLabel()
  groupSelect.syncLabel()
  filterSelect.syncLabel()
}

restoreControlsUI()