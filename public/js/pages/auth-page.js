document.addEventListener('i18n:ready', async () => {
  document.getElementById('langBtn').textContent = t('header.lang')
  try {
    const { user } = await api('/auth/me')
    if (user) window.location.href = '/strategies.html'
  } catch (_) {}
})
initI18n()

document.getElementById('langBtn').addEventListener('click', () => {
  setLang(i18nCurrentLang() === 'fr' ? 'en' : 'fr')
})

document.getElementById('toRegister').addEventListener('click', () => {
  document.getElementById('loginSection').classList.add('hidden')
  document.getElementById('registerSection').classList.remove('hidden')
})
document.getElementById('toLogin').addEventListener('click', () => {
  document.getElementById('registerSection').classList.add('hidden')
  document.getElementById('loginSection').classList.remove('hidden')
})

document.getElementById('loginBtn').addEventListener('click', async () => {
  document.getElementById('loginError').textContent = ''
  const btn = document.getElementById('loginBtn')
  btn.disabled = true
  try {
    await api('/auth/login', { method: 'POST', body: {
      username: document.getElementById('loginUsername').value,
      password: document.getElementById('loginPassword').value,
    }})
    window.location.href = '/strategies.html'
  } catch (err) {
    document.getElementById('loginError').textContent = t('error.' + err.code)
  } finally { btn.disabled = false }
})

document.getElementById('registerBtn').addEventListener('click', async () => {
  document.getElementById('registerError').textContent = ''
  const btn = document.getElementById('registerBtn')
  btn.disabled = true
  try {
    const u = document.getElementById('regUsername').value
    const p = document.getElementById('regPassword').value
    await api('/auth/register', { method: 'POST', body: { username: u, password: p } })
    await api('/auth/login',    { method: 'POST', body: { username: u, password: p } })
    window.location.href = '/strategies.html'
  } catch (err) {
    document.getElementById('registerError').textContent = t('error.' + err.code)
  } finally { btn.disabled = false }
})

document.addEventListener('keydown', e => {
  if (e.key !== 'Enter') return
  const loginVisible = !document.getElementById('loginSection').classList.contains('hidden')
  if (loginVisible) document.getElementById('loginBtn').click()
  else document.getElementById('registerBtn').click()
})