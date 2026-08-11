// TagManager: CRUD + rendering logic for tags, decoupled from the host page.
// Depends on existing globals: api(), toast(), t(), ICONS, createTagPalette().
//
// Minimal usage:
//   const tagManager = new TagManager({
//     onTagsChanged: () => loadJobs(),
//     getEntityTags: (entityId) => allJobs.find(j => j.id === entityId),
//     assignEndpoint: (entityId) => `/tags/jobs/${entityId}`,
//   })
//   await tagManager.load()
//   tagManager.mountCreateForm({ nameInput, paletteContainer, createBtn, errorEl })
//   tagManager.mountManageList(listEl)
//   tagManager.openPopover(entityId, anchorEl, { titleEl, listEl, popoverEl })

class TagManager {
  constructor({ onTagsChanged = () => {}, escHtml = defaultEscHtml } = {}) {
    this.tags = []
    this.onTagsChanged = onTagsChanged
    this.escHtml = escHtml
  }

  async load() {
    try {
      const { tags } = await api('/tags')
      this.tags = tags
    } catch (_) { this.tags = [] }
    return this.tags
  }

  get(id) {
    return this.tags.find(t => t.id === id)
  }

  async create(name, color) {
    const { tag } = await api('/tags', { method: 'POST', body: { name, color } })
    this.tags.push({ ...tag, _count: { jobTags: 0 } })
    this.onTagsChanged()
    return tag
  }

  async updateColor(id, color) {
    await api(`/tags/${id}`, { method: 'PUT', body: { color } })
    const idx = this.tags.findIndex(t => t.id === id)
    if (idx !== -1) this.tags[idx] = { ...this.tags[idx], color }
    this.onTagsChanged()
  }

  async remove(id) {
    await api(`/tags/${id}`, { method: 'DELETE' })
    this.tags = this.tags.filter(t => t.id !== id)
    this.onTagsChanged()
  }

  async setEntityTags(assignEndpoint, tagIds) {
    await api(assignEndpoint, { method: 'PUT', body: { tagIds } })
  }

  chip(tag) {
    return `<span class="tag-chip" style="background:${tag.color}20;color:${tag.color};border-color:${tag.color}40">${this.escHtml(tag.name)}</span>`
  }

  // --- Create form ---
  mountCreateForm({ nameInput, paletteContainer, createBtn, errorEl }) {
    const palette = createTagPalette(paletteContainer, TAG_PALETTE[0])

    const submit = async () => {
      errorEl.textContent = ''
      const name = nameInput.value.trim()
      if (!name) { errorEl.textContent = t('jobs.tags.name_req'); return }
      createBtn.disabled = true
      try {
        await this.create(name, palette.getValue())
        nameInput.value = ''
        toast(t('jobs.tags.created'), 'success')
      } catch (e) {
        errorEl.textContent = t('error.' + e.code)
      } finally {
        createBtn.disabled = false
      }
    }

    createBtn.addEventListener('click', submit)
    nameInput.addEventListener('keydown', e => { if (e.key === 'Enter') submit() })

    return { palette, submit }
  }

  // --- Manage list (modal) ---
  mountManageList(listEl) {
    const render = () => {
      if (!this.tags.length) {
        listEl.innerHTML = `<p class="text-muted text-sm">${t('jobs.tags.empty')}</p>`
        return
      }
      listEl.innerHTML = this.tags.map(tag => `
        <div class="tag-manage-row" data-id="${tag.id}">
          ${this.chip(tag)}
          <span class="text-muted text-sm">${tag._count?.jobTags ?? 0} job${(tag._count?.jobTags ?? 0) !== 1 ? 's' : ''}</span>
          <div class="tag-manage-actions">
            <div class="tag-palette-inline" data-id="${tag.id}"></div>
            <button class="btn btn-danger btn-sm delete-btn delete-tag-btn" data-id="${tag.id}">${ICONS.cross}</button>
          </div>
        </div>
      `).join('')

      this.tags.forEach(tag => {
        const container = listEl.querySelector(`.tag-palette-inline[data-id="${tag.id}"]`)
        createTagPalette(container, tag.color, async (color) => {
          try { await this.updateColor(tag.id, color); render() }
          catch (e) { toast(t('error.' + e.code), 'error') }
        })
      })

      listEl.querySelectorAll('.delete-tag-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
          btn.disabled = true
          try {
            await this.remove(parseInt(btn.dataset.id))
            render()
            toast(t('jobs.tags.deleted'), 'success')
          } catch (e) { toast(t('error.' + e.code), 'error'); btn.disabled = false }
        })
      })
    }

    render()
    return { render }
  }

  // --- Assignment popover ---
  mountAssignPopover({ listEl, buildEndpoint, getSelectedIds, onAssignChange, onError }) {
    const render = (entityId) => {
      const selected = getSelectedIds(entityId)
      if (!this.tags.length) {
        listEl.innerHTML = `<p class="text-muted text-sm p-sm">${t('jobs.assign.empty')}</p>`
        return
      }
      listEl.innerHTML = this.tags.map(tag => `
        <label class="assign-tag-row">
          <input type="checkbox" class="assign-tag-cb" data-id="${tag.id}" ${selected.includes(tag.id) ? 'checked' : ''}>
          ${this.chip(tag)}
        </label>
      `).join('')

      const getCheckedIds = () =>
        [...listEl.querySelectorAll('.assign-tag-cb')]
          .filter(el => el.checked)
          .map(el => parseInt(el.dataset.id))

      listEl.querySelectorAll('.assign-tag-cb').forEach(cb => {
        cb.addEventListener('change', async () => {
          const next = getCheckedIds()

          cb.disabled = true
          try {
            await this.setEntityTags(buildEndpoint(entityId), next)
            onAssignChange(entityId, next)
          } catch (e) {
            cb.checked = !cb.checked
            onError(e)
          } finally {
            cb.disabled = false
          }
        })
      })
    }
    return { render }
  }
}

function defaultEscHtml(s) {
  const d = document.createElement('div')
  d.textContent = s
  return d.innerHTML
}