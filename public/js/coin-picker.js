/**
 * coin-picker.js
 *
 * <coin-picker></coin-picker> - sélecteur multi-coins (base ou quote) avec
 * overlay façon indicator-picker.js : recherche + catégories fixes (voir
 * src/config/coinCategories.js, servi via GET /api/coins) + logo/titre
 * (nom)/sous-titre (symbole).
 *
 * Contrairement à <indicator-picker> (mono-sélection, ferme au clic), c'est
 * multi-sélection : chaque clic sur une carte toggle son état actif dans une
 * sélection de travail, et il faut cliquer "Valider" pour committer (Echap/
 * clic dehors annule les changements en cours).
 *
 * API JS :
 *   picker.value = ['BTC', 'ETH']   // set (array de symboles)
 *   picker.value                    // get -> array de symboles
 *   picker.addEventListener('change', () => ...)
 */
(function () {
    let _overlayEl = null
    let _activePicker = null
    let _searchTerm = ''
    let _overlayReady = false
    let _working = []          // sélection de travail (avant validation)
    let _coinsData = null      // { coins, categories } - chargé une seule fois
    let _coinsPromise = null
    const isMobileWidth = () => ((window.innerWidth > 0) ? window.innerWidth : screen.width) <= 640

    async function _ensureCoinsData() {
        if (_coinsData) return _coinsData
        if (!_coinsPromise) {
            _coinsPromise = api('/coins').then(data => { _coinsData = data; return data })
        }
        return _coinsPromise
    }

    function _ensureOverlay() {
        if (_overlayEl) return
        const el = document.createElement('div')
        el.className = 'ip-overlay'
        el.innerHTML = `
      <div class="ip-panel">
        <div class="ip-search-row">
            ${ICONS.search}
            <input type="text" class="ip-search-input cp-search-input" placeholder="${t('coin_picker.search_ph')}" autocomplete="off">
            <button type="button" class="modal-close cp-close-btn" aria-label="${t('picker.close')}">
            ${ICONS.cross}
          </button>
        </div>
        <div class="ip-body">
          <div class="ip-categories" id="cpCategories"></div>
          <div class="ip-results" id="cpResults"></div>
        </div>
        <div class="cp-footer">
          <button type="button" class="btn btn-ghost btn-sm cp-cancel-btn">${t('common.cancel')}</button>
          <button type="button" class="btn btn-primary btn-sm cp-validate-btn"></button>
        </div>
      </div>
    `
        document.body.appendChild(el)
        _overlayEl = el

        el.addEventListener('click', e => { if (e.target === el) _close(false) })
        el.querySelector('.cp-close-btn').addEventListener('click', () => _close(false))
        el.querySelector('.cp-cancel-btn').addEventListener('click', () => _close(false))
        el.querySelector('.cp-validate-btn').addEventListener('click', () => _close(true))
        document.addEventListener('keydown', e => {
            if (e.key === 'Escape' && el.classList.contains('open')) _close(false)
        })

        const input = el.querySelector('.cp-search-input')
        input.addEventListener('input', e => {
            _searchTerm = e.target.value.trim().toLowerCase()
            _renderResults()
        })

        _overlayReady = true
    }

    let _scrollY = 0
    function _lockScroll() {
        _scrollY = window.scrollY
        document.body.style.position = 'fixed'
        document.body.style.top = `-${_scrollY}px`
        document.body.style.width = '100%'
    }
    function _unlockScroll() {
        document.body.style.position = ''
        document.body.style.top = ''
        document.body.style.width = ''
        window.scrollTo(0, _scrollY)
    }

    async function _open(picker) {
        _ensureOverlay()
        _activePicker = picker
        _searchTerm = ''
        _working = [...picker.value]
        _overlayEl.querySelector('.cp-search-input').value = ''
        _lockScroll()
        _overlayEl.classList.add('open')

        _renderValidateBtn()
        _overlayEl.querySelector('#cpResults').innerHTML = `<div class="ip-empty">${t('coin_picker.loading')}</div>`

        try {
            await _ensureCoinsData()
            _renderCategories()
            _renderResults()
        } catch (e) {
            _overlayEl.querySelector('#cpResults').innerHTML = `<div class="ip-empty">${t('error.COIN_LIST_UNAVAILABLE')}</div>`
        }
    }

    function _close(commit) {
        if (!_overlayEl) return
        _overlayEl.classList.remove('open')
        _unlockScroll()
        if (commit && _activePicker) {
            _activePicker.value = [..._working]
        }
        _activePicker = null
        _working = []
    }

    function _renderValidateBtn() {
        _overlayEl.querySelector('.cp-validate-btn').textContent = t('coin_picker.validate', { n: _working.length })
    }

    function _renderCategories() {
        const cats = _coinsData?.categories || []
        const container = document.getElementById('cpCategories')
        container.innerHTML = `
      <button type="button" class="ip-cat-btn ${!_searchTerm ? 'active' : ''}" data-cat="">
        ${ICONS.grid}
        ${t('picker.all')}
      </button>
      ${cats.map(c => `
        <button type="button" class="ip-cat-btn" data-cat="${c.key}">
          ${c.label}
        </button>
      `).join('')}
      <button type="button" class="ip-cat-btn" data-cat="__uncategorized">
        ${t('coin_picker.uncategorized')}
      </button>
    `
        container.querySelectorAll('.ip-cat-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                container.querySelectorAll('.ip-cat-btn').forEach(b => b.classList.remove('active'))
                btn.classList.add('active')
                _renderResults(btn.dataset.cat)
            })
        })
    }

    function _coinLogo(symbol) {
        return `https://cdn.jsdelivr.net/gh/spothq/cryptocurrency-icons@master/svg/color/${symbol.toLowerCase()}.svg`
    }

    function _renderResults(filterCat) {
        const coins = _coinsData?.coins || []
        const results = document.getElementById('cpResults')

        let items = coins
        if (_searchTerm) {
            items = items.filter(c =>
                c.symbol.toLowerCase().includes(_searchTerm) ||
                c.name.toLowerCase().includes(_searchTerm)
            )
        } else if (filterCat === '__uncategorized') {
            items = items.filter(c => !c.category)
        } else if (filterCat) {
            items = items.filter(c => c.category === filterCat)
        }
        items = [...items].sort((a, b) =>
            (_working.includes(a.symbol) ? 0 : 1) - (_working.includes(b.symbol) ? 0 : 1)
        )

        if (!items.length) {
            results.innerHTML = `<div class="ip-empty">${t('picker.no_results')}</div>`
            return
        }

        results.innerHTML = `<div class="ip-group">${items.map(c => `
        <button type="button" class="cp-item ${_working.includes(c.symbol) ? 'active' : ''}" data-symbol="${c.symbol}">
            <span class="cp-item-check"></span>
            <span class="cp-item-logo-wrap">
            <img class="cp-item-logo" src="${_coinLogo(c.symbol)}" alt=""
                onerror="this.style.display='none'; this.nextElementSibling.style.display='flex'">
            <span class="cp-item-logo-fallback" style="display:none;">${c.symbol.slice(0, 2)}</span>
            </span>
            <span class="cp-item-text">
            <span class="cp-item-title">${c.name}</span>
            <span class="cp-item-subtitle">${c.symbol}</span>
            </span>
        </button>
        `).join('')}</div>`

        results.querySelectorAll('.cp-item').forEach(btn => {
            btn.addEventListener('click', () => {
                const symbol = btn.dataset.symbol
                if (_working.includes(symbol)) _working = _working.filter(s => s !== symbol)
                else _working.push(symbol)
                btn.classList.toggle('active')
                _renderValidateBtn()
            })
        })
    }

    class CoinPicker extends HTMLElement {
        constructor() {
            super()
            this._value = []
            try { this._value = JSON.parse(this.getAttribute('value') || '[]') } catch (_) { this._value = [] }
        }

        connectedCallback() {
            if (!this._built) this._build()
            this._syncLabel()
        }

        get value() { return this._value }
        set value(arr) {
            this._value = Array.isArray(arr) ? arr : []
            this._syncLabel()
            this.dispatchEvent(new Event('change', { bubbles: true }))
        }
        setSilent(arr) {
            this._value = Array.isArray(arr) ? arr : []
            this._syncLabel()
        }

        _build() {
            this._built = true
            this.classList.add('ip-trigger')
            this.setAttribute('role', 'button')
            this.setAttribute('tabindex', '0')
            this.innerHTML = `<span class="ip-trigger-label"></span>${isMobileWidth() ? ICONS.panel_bottom : ICONS.maximize}`
            this.addEventListener('click', () => _open(this))
            this.addEventListener('keydown', e => {
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); _open(this) }
            })
        }

        _syncLabel() {
            const label = this.querySelector?.('.ip-trigger-label')
            if (!label) return
            label.textContent = this._value.length
                ? this._value.join(', ')
                : t('coin_picker.placeholder')
        }
    }

    customElements.define('coin-picker', CoinPicker)

    document.addEventListener('i18n:ready', () => {
        document.querySelectorAll('coin-picker').forEach(p => p._syncLabel?.())
    })

    window.CoinPicker = CoinPicker
})()