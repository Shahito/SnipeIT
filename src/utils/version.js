function parseVersion(str) {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(str || '').trim())
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null
}

// > 0 if a is newer than b, < 0 if older, 0 if equal. Null if either is not x.y.z
function compareVersions(a, b) {
  const pa = parseVersion(a)
  const pb = parseVersion(b)
  if (!pa || !pb) return null
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] - pb[i]
  }
  return 0
}

function parseWorkerVersion(userAgent) {
  const m = /^SnipeIT-Worker\/(\d+\.\d+\.\d+)/.exec(String(userAgent || ''))
  return m ? m[1] : null
}

module.exports = { parseVersion, compareVersions, parseWorkerVersion }