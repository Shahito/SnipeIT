/**
 * header.js - Shared header between all pages
 */

document.addEventListener('i18n:ready', async () => {
  const header = document.getElementById('appHeader')
  if (!header) return

  const active = header.dataset.active || ''

  const navItems = [
    { key: 'strategies', href: '/strategies.html', icon: ICONS.grid, i18n: 'nav.strategies' },
    { key: 'jobs', href: '/jobs.html', icon: ICONS.list, i18n: 'nav.jobs' },
    { key: 'apikeys', href: '/apikeys.html', icon: ICONS.key, i18n: 'nav.apikeys' },
  ]

  const COLOR_SCHEMES = {
    default:   { label: t('colorScheme.default'),    pos: '#00cb6f', neg: '#f91848' }, // Standard western
    asian:     { label: t('colorScheme.asian'),      pos: '#f91848', neg: '#00cb6f' }, // Standard asian
    blue_ora:  { label: t('colorScheme.blueOrange'), pos: '#3b82f6', neg: '#f97316' }, // Colorblind-friendly
    teal_red:  { label: t('colorScheme.tealRed'),    pos: '#14b8a6', neg: '#f43f5e' }, // Dark terminal
  }

  function mountColorSchemePicker(anchorEl) {
    const current = localStorage.getItem('colorScheme') ?? 'default'
    const menu = document.createElement('div')
    menu.className = 'dropdown-menu color-scheme-menu hidden'
    menu.innerHTML = Object.entries(COLOR_SCHEMES).map(([key, s]) => `
      <button class="color-scheme-option ${current === key ? 'active' : ''}" data-scheme="${key}">
        <span class="color-scheme-dots">
          <span class="color-scheme-dot" style="background:${s.pos}"></span>
          <span class="color-scheme-dot" style="background:${s.neg}"></span>
        </span>
        ${s.label}
      </button>
    `).join('')

    anchorEl.classList.add('color-scheme-btn')
    anchorEl.after(menu)
    anchorEl.addEventListener('click', e => {
      e.stopPropagation()
      if(!menu.classList.contains('hidden')) {
        document.querySelectorAll('.dropdown-menu').forEach((el) => el.classList.add('hidden'))
      } else {
        document.querySelectorAll('.dropdown-menu').forEach((el) => el.classList.add('hidden'))
        menu.classList.toggle('hidden')
      }
    })
    menu.addEventListener('click', e => {
      e.stopPropagation()
      const btn = e.target.closest('[data-scheme]')
      if (!btn) return
      applyColorScheme(btn.dataset.scheme)
      menu.querySelectorAll('.color-scheme-option').forEach(o =>
        o.classList.toggle('active', o.dataset.scheme === btn.dataset.scheme)
      )
      menu.classList.add('hidden')
      location.reload();
    })
    document.addEventListener('click', () => menu.classList.add('hidden'))
  }

  function applyColorScheme(name) {
    const s = COLOR_SCHEMES[name] ?? COLOR_SCHEMES.default
    const r = document.documentElement.style
    r.setProperty('--success',     s.pos)
    r.setProperty('--success-dim', dimColor(s.pos, alpha = 0.15))
    r.setProperty('--success-dim-strong', dimColor(s.pos, alpha = 0.4))
    r.setProperty('--danger',      s.neg)
    r.setProperty('--danger-dim',  dimColor(s.neg, alpha = 0.15))
    r.setProperty('--danger-dim-strong',  dimColor(s.neg, alpha = 0.4))
    localStorage.setItem('colorScheme', name)
  }
  
  function dimColor(hex, alpha = 0.15) {
    const [r, g, b] = hex.match(/\w\w/g).map(x => parseInt(x, 16))
    return `rgba(${r},${g},${b},${alpha})`
  }

  function initColorScheme() {
    applyColorScheme(localStorage.getItem('colorScheme') ?? 'default')
  }

    function mountLogoutDropdown(anchorEl) {
      const menu = document.createElement('div')
      menu.className = 'dropdown-menu logout-menu hidden'
      menu.innerHTML = `
        <button class="logout-option" id="logoutBtn">${t('header.logout')}</button>
        <button class="logout-option" id="logoutAllBtn">${t('header.logout_all')}</button>
      `
      anchorEl.classList.add('logout-menu-btn')
      anchorEl.after(menu)

      anchorEl.addEventListener('click', e => {
        e.stopPropagation()
        if(!menu.classList.contains('hidden')) {
          document.querySelectorAll('.dropdown-menu').forEach((el) => el.classList.add('hidden'))
        } else {
          document.querySelectorAll('.dropdown-menu').forEach((el) => el.classList.add('hidden'))
          menu.classList.toggle('hidden')
        }
      })
      document.addEventListener('click', () => menu.classList.add('hidden'))

      document.getElementById('logoutBtn').addEventListener('click', async () => {
        try { await api('/auth/logout', { method: 'POST' }) } finally {
          window.location.href = '/index.html'
        }
      })
      document.getElementById('logoutAllBtn').addEventListener('click', async () => {
        try { await api('/auth/logout-all', { method: 'POST' }) } finally {
          window.location.href = '/index.html'
        }
      })
  }

  const navHTML = navItems.map(item => `
    <a class="nav-link${active === item.key ? ' active' : ''}" href="${item.href}">
      ${item.icon} ${t(item.i18n)}
    </a>
  `).join('')

  // Menu mobile (overlay)
  const mobileNavHTML = `
    <div class="mobile-nav-overlay" id="mobileNav">
      ${navItems.map(item => `
        <a class="nav-link${active === item.key ? ' active' : ''}" href="${item.href}">
          ${item.icon} ${t(item.i18n)}
        </a>
      `).join('')}
      <div class="mobile-nav-divider"></div>
      <div class="user-badge">${ICONS.user}<strong id="mobileHeaderUsername"></strong></div>
      <button class="btn btn-ghost btn-sm color-scheme-btn" id="colorSchemeBtnMobile">
        <span class="color-scheme-dots">
          <span class="color-scheme-dot" style="background: var(--success)"></span>
          <span class="color-scheme-dot" style="background: var(--danger)"></span>
        </span>
        ${t('colorScheme.colors_btn')}
      </button>
      <button class="btn btn-ghost btn-sm lang-btn" id="mobileLangBtn">${t('header.lang')}</button>
      <button class="btn btn-ghost btn-sm" id="mobileLogoutMenuBtn">${t('header.logout_menu')}</button>
    </div>
  `

  header.innerHTML = `
    <div class="header-left">
      <a class="app-logo app-logo--header" tabindex="-1" href="/strategies.html">
        <img src="/images/icons/192.png" class="app-logo-img" alt="SnipeIT">
        <div class="app-title app-title--sm">Snipe<span>IT</span></div>
      </a>
      <nav class="header-nav">${navHTML}</nav>
    </div>
    <div class="header-right">
      <div class="user-badge">${ICONS.user} <strong id="headerUsername"></strong></div>
      <button class="btn btn-ghost btn-sm color-scheme-btn" id="colorSchemeBtn">
        <span class="color-scheme-dots">
          <span class="color-scheme-dot" style="background: var(--success)"></span>
          <span class="color-scheme-dot" style="background: var(--danger)"></span>
        </span>
      </button>
      <button class="btn btn-ghost btn-sm lang-btn" id="langSwitchBtn">${t('header.lang')}</button>
      <button class="btn btn-ghost btn-sm" id="logoutMenuBtn">${t('header.logout_menu')}</button>
    </div>
    <button class="hamburger-btn" id="hamburgerBtn" aria-label="Menu">
      <span></span><span></span><span></span>
    </button>
  `

  // Inject mobile overlay after the header
  const overlay = document.createElement('div')
  overlay.innerHTML = mobileNavHTML
  const mobileNode = overlay.firstElementChild
  if (!mobileNode) return
  document.body.appendChild(mobileNode)

  initColorScheme()
  const picker = document.getElementById('colorSchemeBtn')
  const pickerMobile = document.getElementById('colorSchemeBtnMobile')
  if (picker) mountColorSchemePicker(picker)
  if (pickerMobile) mountColorSchemePicker(pickerMobile)
  
  const logout = document.getElementById('logoutMenuBtn')
  const logoutMobile = document.getElementById('mobileLogoutMenuBtn')
  if (logout) mountLogoutDropdown(logout)
  if (logoutMobile) mountLogoutDropdown(logoutMobile)

  // Hamburger toggle
  const hamburger = document.getElementById('hamburgerBtn')
  const mobileNav = document.getElementById('mobileNav')

  hamburger.addEventListener('click', (e) => {
    e.stopPropagation()
    const isOpen = mobileNav.classList.toggle('open')
    hamburger.setAttribute('aria-expanded', isOpen)
  })

  // Fermer en cliquant ailleurs
  document.addEventListener('click', (e) => {
    if (!mobileNav.contains(e.target) && e.target !== hamburger) {
      mobileNav.classList.remove('open')
    }
  })

  // Close on navigation
  mobileNav.querySelectorAll('.nav-link').forEach(link => {
    link.addEventListener('click', () => mobileNav.classList.remove('open'))
  })

  // Desktop lang switch
  document.getElementById('langSwitchBtn').addEventListener('click', () => {
    setLang(i18nCurrentLang() === 'fr' ? 'en' : 'fr')
  })
  // Mobile lang switch
  document.getElementById('mobileLangBtn').addEventListener('click', () => {
    setLang(i18nCurrentLang() === 'fr' ? 'en' : 'fr')
  })

  // Auth check + user display
  try {
    const { user } = await api('/auth/me')
    document.getElementById('headerUsername').textContent = user.displayUsername
    const mobileUser = document.getElementById('mobileHeaderUsername')
    if (mobileUser) mobileUser.textContent = user.displayUsername
    document.dispatchEvent(new CustomEvent('header:ready', { detail: { user } }))
  } catch (_) {
    window.location.href = '/index.html'
  }
})