// Helper global pour tous les appels API
// Usage : const data = await api('/auth/me')
//         await api('/auth/login', { method: 'POST', body: { username, password } })
//
// En cas d'erreur, throw un objet avec :
//   err.message → le code brut ex: "INVALID_CREDENTIALS"
//   err.code    → idem (pour t('error.' + err.code))
//   err.status  → le HTTP status
async function api(path, options = {}) {
  const { method = 'GET', body } = options

  const res = await fetch(`/api${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  })

  const data = await res.json()

  if (!res.ok) {
    const code = data.error || 'UNKNOWN'
    const err = new Error(code)
    err.code = code
    err.status = res.status
    err.data = data
    throw err
  }

  return data
}
