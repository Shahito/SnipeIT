const ALIAS_TAG_DOMAINS = new Set([
  'gmail.com', 'googlemail.com',
  'outlook.com', 'hotmail.com', 'live.com', 'msn.com',
  'yahoo.com', 'yahoo.fr',
  'icloud.com', 'me.com', 'mac.com',
  'protonmail.com', 'proton.me',
  'fastmail.com',
])

const DOT_INSENSITIVE_DOMAINS = new Set(['gmail.com', 'googlemail.com'])

function splitEmail(email) {
  const trimmed = (email || '').trim().toLowerCase()
  const at = trimmed.lastIndexOf('@')
  if (at === -1) return { local: trimmed, domain: '' }
  return { local: trimmed.slice(0, at), domain: trimmed.slice(at + 1) }
}

function hasAliasTag(email) {
  const { local, domain } = splitEmail(email)
  return ALIAS_TAG_DOMAINS.has(domain) && local.includes('+')
}

function canonicalizeEmail(email) {
  let { local, domain } = splitEmail(email)
  if (domain === 'googlemail.com') domain = 'gmail.com'

  if (ALIAS_TAG_DOMAINS.has(domain)) {
    const plusIdx = local.indexOf('+')
    if (plusIdx !== -1) local = local.slice(0, plusIdx)
  }
  if (DOT_INSENSITIVE_DOMAINS.has(domain)) local = local.replace(/\./g, '')

  return domain ? `${local}@${domain}` : local
}

module.exports = { canonicalizeEmail, hasAliasTag }