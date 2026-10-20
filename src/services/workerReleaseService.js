const {
  WORKER_RELEASE_REPO, WORKER_ASSET_NAME, WORKER_TAG_PREFIX,
  WORKER_RELEASE_CACHE_TTL_MS, WORKER_RELEASE_RETRY_MS,
} = require('../config/worker')
const { parseVersion } = require('../utils/version')

let cache = { value: null, expiresAt: 0 }

async function fetchLatestRelease() {
  const res = await fetch(`https://api.github.com/repos/${WORKER_RELEASE_REPO}/releases/latest`, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'SnipeIT' },
  })
  
  if (res.status === 404) return null // no published release yet
  if (!res.ok) throw new Error(`GitHub responded ${res.status}`)

  const release = await res.json()
  const tag = String(release.tag_name || '')
  if (!tag.startsWith(WORKER_TAG_PREFIX)) return null
  const version = tag.slice(WORKER_TAG_PREFIX.length)
  if (!parseVersion(version)) return null
  if (!(release.assets || []).some(a => a.name === WORKER_ASSET_NAME)) return null

  return {
    version,
    url: `https://github.com/${WORKER_RELEASE_REPO}/releases/latest/download/${WORKER_ASSET_NAME}`,
  }
}

// { version, url } of the latest published worker release, or null. Never throws:
// on a GitHub error the last known value is kept and the next try is delayed
async function getLatestWorkerRelease() {
  if (!WORKER_RELEASE_REPO) return null
  if (Date.now() < cache.expiresAt) return cache.value
  try {
    cache = { value: await fetchLatestRelease(), expiresAt: Date.now() + WORKER_RELEASE_CACHE_TTL_MS }
  } catch (e) {
    cache = { value: cache.value, expiresAt: Date.now() + WORKER_RELEASE_RETRY_MS }
  }
  return cache.value
}

function resetWorkerReleaseCache() {
  cache = { value: null, expiresAt: 0 }
}

module.exports = { getLatestWorkerRelease, resetWorkerReleaseCache }