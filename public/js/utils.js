function escHtml(s) {
  const d = document.createElement('div')
  d.textContent = s
  return d.innerHTML.replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

function escAttr(s) {
  return s.replace(/"/g, '&quot;')
}

function fmtDuration(ms) {
  if (!ms || ms < 0) return null
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}min ${s % 60}s`
  const h = Math.floor(m / 60)
return `${h}h ${m % 60}min`
}