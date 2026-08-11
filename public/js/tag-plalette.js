// Predefined color palette for tags (replaces the native color-wheel)
const TAG_PALETTE = [
  '#6c8eff', '#4fd1c5', '#68d391', '#f6e05e', '#f6ad55',
  '#fc8181', '#f687b3', '#b794f4', '#63b3ed', '#a0aec0',
  '#38b2ac', '#48bb78', '#ecc94b', '#ed8936', '#e53e3e',
  '#d53f8c', '#805ad5', '#3182ce', '#718096', '#2d3748',
]

/**
 * Creates a palette picker inside `container`.
 * @param {HTMLElement} container
 * @param {string} initialColor
 * @param {(color:string)=>void} onChange
 * @returns {{ getValue:()=>string, setValue:(c:string)=>void, destroy:()=>void }}
 */
function createTagPalette(container, initialColor = TAG_PALETTE[0], onChange = () => {}) {
  let value = TAG_PALETTE.includes(initialColor) ? initialColor : TAG_PALETTE[0]

  container.classList.add('tag-palette')
  container.innerHTML = TAG_PALETTE.map(c => `
    <button type="button" class="tag-palette-swatch" data-color="${c}" style="background:${c}"
      aria-label="${c}" aria-pressed="${c === value}"></button>
  `).join('')

  function paint() {
    container.querySelectorAll('.tag-palette-swatch').forEach(btn => {
      const active = btn.dataset.color === value
      btn.classList.toggle('active', active)
      btn.setAttribute('aria-pressed', String(active))
    })
  }

  function handleClick(e) {
    const btn = e.target.closest('.tag-palette-swatch')
    if (!btn) return
    value = btn.dataset.color
    paint()
    onChange(value)
  }

  container.addEventListener('click', handleClick)
  paint()

  return {
    getValue: () => value,
    setValue: (c) => { value = TAG_PALETTE.includes(c) ? c : TAG_PALETTE[0]; paint() },
    destroy: () => container.removeEventListener('click', handleClick),
  }
}