// Verifies that public/locales/en.json and public/locales/fr.json are in
// sync: same set of keys, same key ORDER (so the files stay diff-friendly
// and a reviewer can eyeball them side by side), and no empty values.
//
// Usage: node test/i18nLocalesSync.test.js
'use strict'

const fs = require('fs')
const path = require('path')

const LOCALES_DIR = path.join(__dirname, '..', 'public', 'locales')
const LOCALE_FILES = ['en.json', 'fr.json']

function loadLocale(filename) {
  const full = path.join(LOCALES_DIR, filename)
  const raw = fs.readFileSync(full, 'utf8')
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch (e) {
    throw new Error(`${filename} is not valid JSON: ${e.message}`)
  }
  return { filename, keys: Object.keys(parsed), values: parsed }
}

function main() {
  const errors = []

  const [ref, ...others] = LOCALE_FILES.map(loadLocale)

  // 1. Same key SET across all locale files (order-independent)
  const refSet = new Set(ref.keys)
  for (const other of others) {
    const otherSet = new Set(other.keys)

    const missingInOther = ref.keys.filter(k => !otherSet.has(k))
    const missingInRef = other.keys.filter(k => !refSet.has(k))

    if (missingInOther.length) {
      errors.push(
        `Keys present in ${ref.filename} but missing from ${other.filename} (${missingInOther.length}):\n` +
        missingInOther.map(k => `    - ${k}`).join('\n')
      )
    }
    if (missingInRef.length) {
      errors.push(
        `Keys present in ${other.filename} but missing from ${ref.filename} (${missingInRef.length}):\n` +
        missingInRef.map(k => `    - ${k}`).join('\n')
      )
    }
  }

  // 2. Same key ORDER (only meaningful once the sets match; still report
  //    the first divergence otherwise so the message stays useful)
  for (const other of others) {
    const len = Math.min(ref.keys.length, other.keys.length)
    const orderDiffs = []
    for (let i = 0; i < len; i++) {
      if (ref.keys[i] !== other.keys[i]) {
        orderDiffs.push({ line: i + 1, ref: ref.keys[i], other: other.keys[i] })
      }
    }
    if (orderDiffs.length) {
      errors.push(
        `Key order mismatch between ${ref.filename} and ${other.filename} ` +
        `(${orderDiffs.length} line(s) diverge, showing up to 15):\n` +
        orderDiffs.slice(0, 15).map(d =>
          `    line ~${d.line}: ${ref.filename}="${d.ref}"  vs  ${other.filename}="${d.other}"`
        ).join('\n')
      )
    }
  }

  // 3. Empty / whitespace-only values in any locale
  for (const locale of [ref, ...others]) {
    const empties = Object.entries(locale.values)
      .filter(([, v]) => typeof v !== 'string' || v.trim() === '')
      .map(([k]) => k)
    if (empties.length) {
      errors.push(
        `Empty values in ${locale.filename} (${empties.length}):\n` +
        empties.map(k => `    - ${k}`).join('\n')
      )
    }
  }

  // 4. Duplicate keys are silently collapsed by JSON.parse, so detect them
  //    from the raw text instead.
  for (const locale of [ref, ...others]) {
    const raw = fs.readFileSync(path.join(LOCALES_DIR, locale.filename), 'utf8')
    const seen = new Map()
    const dupes = []
    const keyRe = /^\s*"((?:[^"\\]|\\.)+)"\s*:/gm
    let m
    while ((m = keyRe.exec(raw))) {
      const key = m[1]
      seen.set(key, (seen.get(key) || 0) + 1)
    }
    for (const [key, count] of seen) {
      if (count > 1) dupes.push(`${key} (${count}x)`)
    }
    if (dupes.length) {
      errors.push(`Duplicate keys in ${locale.filename}:\n` + dupes.map(k => `    - ${k}`).join('\n'))
    }
  }

  if (errors.length) {
    console.error(`❌ i18n locale sync FAILED - ${errors.length} issue(s):\n`)
    errors.forEach(e => console.error('  ' + e + '\n'))
    process.exit(1)
  }

  console.log(
    `✅ i18n locales in sync - ${LOCALE_FILES.join(', ')} share ${ref.keys.length} keys, same order, no empty values, no duplicates`
  )
}

main()