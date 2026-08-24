// Global helper for all API calls
// Usage : const data = await api('/auth/me')
//         await api('/auth/login', { method: 'POST', body: { username, password } })
//
// On error, throws an object with:
//   err.message -> the raw code, e.g. "INVALID_CREDENTIALS"
//   err.code    -> same (for t('error.' + err.code))
//   err.status  -> the HTTP status
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
