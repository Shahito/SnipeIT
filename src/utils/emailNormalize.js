// Domains where "+tag" is a real alias of the same mailbox
// Yahoo is excluded on purpose: it does not support "+" (aliases use "-")
const ALIAS_TAG_DOMAINS = new Set([
  'gmail.com', 'googlemail.com',
  'outlook.com', 'outlook.fr', 'outlook.de', 'outlook.es', 'outlook.it',
  'hotmail.com', 'hotmail.fr', 'hotmail.co.uk', 'hotmail.de', 'hotmail.es', 'hotmail.it',
  'live.com', 'live.fr', 'live.co.uk', 'live.de', 'live.it',
  'msn.com',
  'icloud.com', 'icloud.fr', 'me.com', 'mac.com',
  'protonmail.com', 'protonmail.ch', 'proton.me', 'pm.me',
  'fastmail.com', 'fastmail.fm',
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