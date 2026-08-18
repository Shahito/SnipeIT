function escHtml(s) {
  const d = document.createElement('div')
  d.textContent = s
  return d.innerHTML.replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

function escAttr(s) {
  return s.replace(/"/g, '&quot;')
}