const dns = require('dns').promises

const LOOKUP_TIMEOUT_MS = 3000

function withTimeout(promise, ms) {
  let timer
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('DNS_TIMEOUT')), ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

/**
 * Best-effort check that an email's domain can plausibly receive mail:
 * it must have either MX records, or at least an A/AAAA record (some
 * domains accept mail with no MX, falling back to the A record - RFC 5321).
 *
 * Returns true if the domain looks reachable, false if it's clearly bogus
 * (e.g. "a.a", a typo, a domain that doesn't exist). On DNS errors that
 * aren't a clear "domain doesn't exist" (timeouts, resolver hiccups), we
 * fail OPEN (return true) so a flaky DNS server never blocks a legit signup.
 */
async function domainCanReceiveMail(domain) {
  if (!domain) return false

  try {
    const mx = await withTimeout(dns.resolveMx(domain), LOOKUP_TIMEOUT_MS)
    if (mx && mx.length > 0) return true
  } catch (e) {
    if (e.code === 'ENOTFOUND' || e.code === 'ENODATA') {
      // No MX - fall through and try A/AAAA below before giving up.
    } else {
      return true
    }
  }

  try {
    const addresses = await withTimeout(dns.resolve4(domain), LOOKUP_TIMEOUT_MS)
    if (addresses && addresses.length > 0) return true
  } catch (e) {
    if (e.code !== 'ENOTFOUND' && e.code !== 'ENODATA') return true
  }

  try {
    const addresses6 = await withTimeout(dns.resolve6(domain), LOOKUP_TIMEOUT_MS)
    if (addresses6 && addresses6.length > 0) return true
  } catch (e) {
    if (e.code !== 'ENOTFOUND' && e.code !== 'ENODATA') return true
  }

  return false
}

module.exports = { domainCanReceiveMail }