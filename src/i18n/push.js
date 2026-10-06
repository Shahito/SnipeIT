// Server side counterpart to public/js/i18n.js, used to localize push payloads.
// Reuses the same locale files as the front end so translations live in one place.
const fs = require('fs')
const path = require('path')

const SUPPORTED_LANGS = ['fr', 'en']
const DEFAULT_LANG = 'en'

const LOCALES_DIR = path.join(__dirname, '..', '..', 'public', 'locales')
const cache = {}

function loadLocale(lang) {
  if (cache[lang]) return cache[lang]
  const file = path.join(LOCALES_DIR, `${lang}.json`)
  const dict = JSON.parse(fs.readFileSync(file, 'utf8'))
  cache[lang] = dict
  return dict
}

// Mirrors the t function in public/js/i18n.js: simple var interpolation,
// falls back to the raw key if missing so a missing translation never crashes a push.
function t(lang, key, vars = {}) {
  const dict = loadLocale(SUPPORTED_LANGS.includes(lang) ? lang : DEFAULT_LANG)
  let str = dict[key] ?? key
  for (const [k, v] of Object.entries(vars)) {
    str = str.replace(`{${k}}`, v)
  }
  return str
}

module.exports = { t, SUPPORTED_LANGS, DEFAULT_LANG }