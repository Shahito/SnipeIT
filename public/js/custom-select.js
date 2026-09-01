const _openCustomSelects = new Set()

function initCustomSelect(root, { onChange } = {}) {
  if (!root || root.customSelect) return root && root.customSelect
  const trigger = root.querySelector('.custom-select-trigger')
  const label = root.querySelector('.custom-select-value')
  const menu = root.querySelector('.custom-select-menu')
  if (!trigger || !menu) return null

  const getOptions = () => Array.from(root.querySelectorAll('.custom-select-option'))

  function close() {
    root.classList.remove('open')
    menu.classList.add('hidden')
    trigger.setAttribute('aria-expanded', 'false')
    _openCustomSelects.delete(root)
  }

  function open() {
    _openCustomSelects.forEach(el => { if (el !== root) el.customSelect?.close() })
    root.classList.add('open')
    menu.classList.remove('hidden')
    trigger.setAttribute('aria-expanded', 'true')
    _openCustomSelects.add(root)
  }

  function toggle() {
    root.classList.contains('open') ? close() : open()
  }

  function syncLabel() {
    const active = getOptions().find(o => o.dataset.value === root.dataset.value) || getOptions()[0]
    if (active && label) label.textContent = active.textContent.trim()
  }

  function setValue(value, { silent = false } = {}) {
    root.dataset.value = value
    getOptions().forEach(o => {
      const isActive = o.dataset.value === value
      o.classList.toggle('active', isActive)
      o.setAttribute('aria-selected', isActive ? 'true' : 'false')
    })
    syncLabel()
    if (!silent) onChange && onChange(value)
  }

  trigger.addEventListener('click', e => {
    e.stopPropagation()
    toggle()
  })

  getOptions().forEach(opt => {
    opt.addEventListener('click', () => {
      setValue(opt.dataset.value)
      close()
    })
  })

  document.addEventListener('click', e => {
    if (root.classList.contains('open') && !root.contains(e.target)) close()
  })

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && root.classList.contains('open')) close()
  })

  root.customSelect = { setValue, getValue: () => root.dataset.value, syncLabel, open, close }
  syncLabel()
  return root.customSelect
}