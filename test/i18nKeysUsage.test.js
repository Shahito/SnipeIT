// Cross-checks the keys declared in public/locales/{en,fr}.json against how
// the codebase actually references translation keys, and reports:
//
//   1. MISSING  - key used somewhere in the code but not declared in one or
//                 both locale files (this FAILS the script, exit code 1).
//   2. DEAD     - key declared in the locales but never found used anywhere,
//                 including a best-effort check for dynamically-built keys
//                 like `t('sweep.status.' + s.status)` (this only WARNS by
//                 default - pass --fail-on-dead to make it fatal too).
//
// Where a key is referenced in the UI:
//   - t('some.key')                                   (JS)
//   - data-i18n="some.key" / data-i18n-attr=...        (HTML)
//   - data-i18n-title="some.key" on <html>              (HTML, sets <title>)
//   - i18nKey: 'some.key' / labelKey: 'some.key'        (JS config objects
//     later passed through t(...) indirectly)
//   - t('prefix.' + variable)  or  const key = 'prefix.' + variable
//     -> any declared key starting with "prefix." is treated as
//        "dynamically reachable" rather than exact-matched, and reported
//        separately so a human can still sanity-check it.
//
// Usage: node test/i18nKeysUsage.test.js [--fail-on-dead]
'use strict'

const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..')
const LOCALES_DIR = path.join(ROOT, 'public', 'locales')
const LOCALE_FILES = ['en.json', 'fr.json']
const SCAN_DIRS = [path.join(ROOT, 'public')] // where t()/data-i18n usage lives
const IGNORE_DIRS = new Set(['node_modules', '.git'])

const FAIL_ON_DEAD = process.argv.includes('--fail-on-dead')

function walk(dir, exts) {
  const out = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (IGNORE_DIRS.has(entry.name)) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      out.push(...walk(full, exts))
    } else if (exts.some(ext => entry.name.endsWith(ext))) {
      out.push(full)
    }
  }
  return out
}

function loadDeclaredKeys() {
  const perFile = {}
  for (const filename of LOCALE_FILES) {
    perFile[filename] = new Set(Object.keys(JSON.parse(
      fs.readFileSync(path.join(LOCALES_DIR, filename), 'utf8')
    )))
  }
  // Reference set = union of both locales (a key missing from only one file
  // is already caught by i18nLocalesSync.test.js; here we care about
  // "declared anywhere" vs "used in code").
  const union = new Set()
  for (const set of Object.values(perFile)) for (const k of set) union.add(k)
  return { perFile, union }
}

const KEY_PATTERN = /[a-zA-Z][a-zA-Z0-9_]*(?:\.[a-zA-Z0-9_]+)+/ // e.g. sweep.param.sl_type

// String-aware comment stripper: replaces // line comments and /* */ block
// comments with spaces (preserving line count / offsets), but leaves the
// content of '...' / "..." / `...` string literals untouched (JS files
// contain "//" inside URLs and inline <svg> markup, so a naive regex would
// corrupt those lines). HTML files are passed through unchanged (comments
// there don't use // and rarely wrap i18n examples).
function stripJsComments(src) {
  let out = ''
  let i = 0
  const n = src.length
  let mode = 'code' // 'code' | 'line-comment' | 'block-comment' | 'string'
  let stringChar = null
  while (i < n) {
    const c = src[i]
    const c2 = src[i + 1]
    if (mode === 'code') {
      if (c === '/' && c2 === '/') { mode = 'line-comment'; out += '  '; i += 2; continue }
      if (c === '/' && c2 === '*') { mode = 'block-comment'; out += '  '; i += 2; continue }
      if (c === '\'' || c === '"' || c === '`') { mode = 'string'; stringChar = c; out += c; i++; continue }
      out += c; i++
    } else if (mode === 'line-comment') {
      if (c === '\n') { mode = 'code'; out += c } else { out += ' ' }
      i++
    } else if (mode === 'block-comment') {
      if (c === '*' && c2 === '/') { mode = 'code'; out += '  '; i += 2; continue }
      out += (c === '\n' ? '\n' : ' ')
      i++
    } else if (mode === 'string') {
      if (c === '\\') { out += c + (c2 || ''); i += 2; continue }
      if (c === stringChar) { mode = 'code'; stringChar = null }
      out += c
      i++
    }
  }
  return out
}

function extractUsage(files) {
  const exactUsed = new Map()   // key -> Set("file:line", ...)
  const dynamicPrefixes = new Map() // prefix (ends with ".") -> [ "file:line", ... ]

  // Any quoted string that matches KEY_PATTERN is treated as a candidate
  // i18n key reference, covering: t('key'), data-i18n="key",
  // data-i18n-title="key", { key: 'x.y' }, { i18nKey: 'x.y' },
  // ternaries later resolved via t(variable), etc.
  const reExact = new RegExp(`['"](${KEY_PATTERN.source})['"]`, 'g')
  const reDataI18n = new RegExp(`data-i18n(?:-title)?="(${KEY_PATTERN.source})"`, 'g')

  // 'prefix.' + something   (covers t('prefix.' + x) AND
  // const key = 'prefix.' + x; ...; t(key))
  const reDynamicPrefix = /['"]([a-zA-Z][a-zA-Z0-9_]*(?:\.[a-zA-Z0-9_]+)*\.)['"]\s*\+/g

  for (const file of files) {
    const rel = path.relative(ROOT, file)
    const raw = fs.readFileSync(file, 'utf8')
    const cleaned = file.endsWith('.js') ? stripJsComments(raw) : raw
    const lines = cleaned.split('\n')
    lines.forEach((line, idx) => {
      const lineNo = idx + 1
      const loc = `${rel}:${lineNo}`
      const addUsage = (key) => {
        if (!exactUsed.has(key)) exactUsed.set(key, new Set())
        exactUsed.get(key).add(loc)
      }

      reExact.lastIndex = 0
      let m
      while ((m = reExact.exec(line))) addUsage(m[1])

      reDataI18n.lastIndex = 0
      while ((m = reDataI18n.exec(line))) addUsage(m[1])

      reDynamicPrefix.lastIndex = 0
      while ((m = reDynamicPrefix.exec(line))) {
        const prefix = m[1]
        if (!dynamicPrefixes.has(prefix)) dynamicPrefixes.set(prefix, [])
        dynamicPrefixes.get(prefix).push(loc)
      }
    })
  }

  return { exactUsed, dynamicPrefixes }
}

function main() {
  const { perFile, union: declared } = loadDeclaredKeys()
  const files = walk(SCAN_DIRS[0], ['.js', '.html'])
  const { exactUsed, dynamicPrefixes } = extractUsage(files)

  // --- 1. MISSING: used in code (exact match) but not declared anywhere ---
  const missing = [...exactUsed.keys()].filter(k => !declared.has(k)).sort()

  // --- 2. DEAD: declared but no exact usage found ---
  const declaredNotExactlyUsed = [...declared].filter(k => !exactUsed.has(k)).sort()

  // Split those into "covered by a dynamic prefix" (informational) vs
  // "truly no reference found anywhere" (real dead-key candidates).
  const prefixes = [...dynamicPrefixes.keys()]
  const deadReal = []
  const deadCoveredByPrefix = []
  for (const key of declaredNotExactlyUsed) {
    const coveringPrefix = prefixes.find(p => key.startsWith(p))
    if (coveringPrefix) {
      deadCoveredByPrefix.push({ key, prefix: coveringPrefix })
    } else {
      deadReal.push(key)
    }
  }

  // --- also flag keys missing from only ONE locale (quick cross-ref;
  //     i18nLocalesSync.test.js is the authoritative check for this) ---
  const perLocaleMissing = {}
  for (const filename of LOCALE_FILES) {
    const set = perFile[filename]
    const notInThisFile = [...exactUsed.keys()].filter(k => !set.has(k))
    if (notInThisFile.length) perLocaleMissing[filename] = notInThisFile.sort()
  }

  let hasFatalError = false
  console.log(`Scanned ${files.length} file(s) under public/.\n`)

  if (missing.length) {
    hasFatalError = true
    console.error(`❌ MISSING keys - used in code but declared in NEITHER locale file (${missing.length}):`)
    for (const k of missing) {
      console.error(`   - ${k}`)
      for (const loc of [...exactUsed.get(k)].slice(0, 3)) console.error(`       used at ${loc}`)
    }
    console.error('')
  }

  for (const [filename, keys] of Object.entries(perLocaleMissing)) {
    const stillMissing = keys.filter(k => missing.includes(k) === false) // dedupe with above section
    if (stillMissing.length) {
      hasFatalError = true
      console.error(`❌ Used in code but missing from ${filename} only (${stillMissing.length}):`)
      stillMissing.forEach(k => console.error(`   - ${k}`))
      console.error('')
    }
  }

  if (deadReal.length) {
    console.warn(`⚠️  DEAD keys - declared but no usage found anywhere (${deadReal.length}):`)
    deadReal.forEach(k => console.warn(`   - ${k}`))
    console.warn('   (review manually before deleting - remove from BOTH en.json and fr.json if confirmed unused)\n')
    if (FAIL_ON_DEAD) hasFatalError = true
  }

  if (deadCoveredByPrefix.length) {
    console.log(`ℹ️  No exact usage found, but covered by a dynamic prefix (${deadCoveredByPrefix.length}) - verify manually:`)
    const byPrefix = {}
    for (const { key, prefix } of deadCoveredByPrefix) {
      (byPrefix[prefix] = byPrefix[prefix] || []).push(key)
    }
    for (const [prefix, keys] of Object.entries(byPrefix)) {
      console.log(`   prefix "${prefix}" (built dynamically at ${dynamicPrefixes.get(prefix)[0]}):`)
      keys.forEach(k => console.log(`     - ${k}`))
    }
    console.log('')
  }

  if (hasFatalError) {
    console.error('❌ i18n key usage check FAILED')
    process.exit(1)
  }

  console.log(
    `✅ i18n key usage OK - no undeclared keys used in code` +
    (deadReal.length || FAIL_ON_DEAD ? '' : ` (${deadReal.length} dead-key warning(s) above, non-fatal)`)
  )
}

main()