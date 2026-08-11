// Predefined color palette for tags (replaces the native color-wheel)
const TAG_PALETTE = [
  '#6c8eff', '#4fd1c5', '#68d391', '#f6e05e', '#f6ad55',
  '#fc8181', '#f687b3', '#b794f4', '#63b3ed', '#a0aec0',
  '#38b2ac', '#48bb78', '#ecc94b', '#ed8936', '#e53e3e',
  '#d53f8c', '#805ad5', '#3182ce', '#718096', '#2d3748',
]

// Single shared floating dropdown, reused by every trigger on the page
let _paletteDropdown = null
function _getDropdown() {
  if (_paletteDropdown) return _paletteDropdown
  const el = document.createElement('div')
  el.className = 'tag-palette-dropdown hidden'
  document.body.appendChild(el)
  document.addEventListener('click', (e) => {
    if (!el.classList.contains('hidden') &&
        !el.contains(e.target) &&
        !e.target.closest('.tag-palette-trigger')) {
      el.classList.add('hidden')
    }
  })
  _paletteDropdown = el
  return el
}

/**
 * Creates a compact color-swatch trigger in `container`. Clicking it opens
 * a small floating palette to pick a color.
 * @param {HTMLElement} container
 * @param {string} initialColor
 * @param {(color:string)=>void} onChange
 * @returns {{ getValue:()=>string, setValue:(c:string)=>void, destroy:()=>void }}
 */
function createTagPalette(container, initialColor = TAG_PALETTE[0], onChange = () => {}) {
  let value = TAG_PALETTE.includes(initialColor) ? initialColor : TAG_PALETTE[0]

  container.classList.add('tag-palette-picker')
  container.innerHTML = `<button type="button" class="tag-palette-trigger" style="background:${value}" aria-label="${value}"></button>`
  const trigger = container.querySelector('.tag-palette-trigger')

  function paintTrigger() {
    trigger.style.background = value
    trigger.setAttribute('aria-label', value)
  }

  function openDropdown() {
    const dropdown = _getDropdown()
    dropdown.innerHTML = TAG_PALETTE.map(c => `
      <button type="button" class="tag-palette-swatch" data-color="${c}" style="background:${c}"
        aria-label="${c}" aria-pressed="${c === value}"></button>
    `).join('')

    dropdown.querySelectorAll('.tag-palette-swatch').forEach(btn => {
      btn.addEventListener('click', () => {
        value = btn.dataset.color
        paintTrigger()
        onChange(value)
        dropdown.classList.add('hidden')
      })
    })

    dropdown.classList.remove('hidden')
    const rect = trigger.getBoundingClientRect()
    const dw = dropdown.offsetWidth  || 168
    const dh = dropdown.offsetHeight || 90
    let top  = rect.bottom + 6
    let left = rect.left
    if (left + dw > window.innerWidth - 8) left = window.innerWidth - dw - 8
    if (left < 8) left = 8
    if (top + dh > window.innerHeight - 8) top = rect.top - dh - 6
    dropdown.style.top  = top  + 'px'
    dropdown.style.left = left + 'px'
  }

  function handleClick(e) {
    e.stopPropagation()
    const dropdown = _getDropdown()
    if (!dropdown.classList.contains('hidden') && dropdown._trigger === trigger) {
      dropdown.classList.add('hidden')
      return
    }
    dropdown._trigger = trigger
    openDropdown()
  }

  trigger.addEventListener('click', handleClick)
  paintTrigger()

  return {
    getValue: () => value,
    setValue: (c) => { value = TAG_PALETTE.includes(c) ? c : TAG_PALETTE[0]; paintTrigger() },
    destroy: () => trigger.removeEventListener('click', handleClick),
  }
}