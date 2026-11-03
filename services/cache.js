const cache = new Map();
const CACHE_TTL = 5 * 60 * 1000;

function cacheKey(url, type) { return `${url}|${type}`; }

function getCached(key) {
  const entry = cache.get(key);
  if (!entry || Date.now() > entry.expires) { cache.delete(key); return null; }
  return entry.data;
}

function setCached(key, data) {
  cache.set(key, { data, expires: Date.now() + CACHE_TTL });
  if (cache.size > 500) {
    const now = Date.now();
    for (const [k, v] of cache) if (now > v.expires) cache.delete(k);
  }
}

module.exports = { cacheKey, getCached, setCached };