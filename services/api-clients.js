const axios = require('axios');
const { cacheKey, getCached, setCached } = require('./cache');

const NEOXR_KEY = process.env.API_KEY || '';
const NEOXR_BASE = process.env.API_BASE || '';
const STELLARWA_KEY = process.env.STELLARWA_KEY || '';

async function fetchNeoxr(endpoint, params, retries = 2) {
  const key = cacheKey('neoxr' + endpoint + JSON.stringify(params), params.type || 'default');
  const cached = getCached(key);
  if (cached) return cached;

  for (let i = 0; i <= retries; i++) {
    try {
      const { data } = await axios.get(`${NEOXR_BASE}${endpoint}`, {
        params: { ...params, apikey: NEOXR_KEY },
        timeout: 45000,
        headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' },
        validateStatus: () => true,
      });

      if (!data || data.status !== true) throw new Error(data?.message || 'Error en API');
      setCached(key, data);
      return data;
    } catch (error) {
      const status = error.response?.status;
      const isCf5xx = [520, 521, 522, 523, 524, 525, 526].includes(status);
      if ((isCf5xx || !error.response) && i < retries) {
        await new Promise(r => setTimeout(r, 1000 * (i + 1)));
        continue;
      }
      throw error;
    }
  }
}

async function fetchStellarwa(endpoint, url) {
  const key = cacheKey('stellarwa' + endpoint, url);
  const cached = getCached(key);
  if (cached) return cached;

  try {
    const apiUrl = new URL(`https://api.stellarwa.xyz${endpoint}`);
    apiUrl.searchParams.append('url', url);
    apiUrl.searchParams.append('key', STELLARWA_KEY);

    const { data } = await axios.get(apiUrl.toString(), {
      headers: { 'Accept': 'application/json' },
      timeout: 15000
    });

    if (data && data.status) {
      setCached(key, data);
      return data;
    }
    return null;
  } catch (error) {
    console.error(`[Stellarwa Error] ${endpoint}:`, error.message);
    return null;
  }
}

module.exports = { fetchNeoxr, fetchStellarwa };