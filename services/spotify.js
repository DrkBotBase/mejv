const axios = require('axios');
const cheerio = require('cheerio');

const CONFIG = {
  searchURL: "https://spotmp3.net",
  downloadURL: "https://spotidown.app",
  timeout: 25000,
  limit: 1, // Solo pedimos 1 resultado para ser más rápidos
  maxPages: 1,
  retries: 3
};

const cookies = new Map();
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const getHeaders = (extra = {}) => ({
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9",
  Referer: `${CONFIG.searchURL}/`,
  Origin: CONFIG.searchURL,
  ...extra,
  ...(cookies.size ? { Cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join("; ") } : {})
});

function saveCookies(response) {
  const raw = response.headers?.["set-cookie"] || [];
  for (const cookie of raw) {
    const pair = cookie.split(";")[0];
    const index = pair.indexOf("=");
    if (index > 0) cookies.set(pair.slice(0, index).trim(), pair.slice(index + 1).trim());
  }
}

async function request(url, options = {}) {
  let lastError;
  for (let attempt = 0; attempt < CONFIG.retries; attempt++) {
    try {
      const response = await axios({
        url, timeout: CONFIG.timeout, ...options,
        validateStatus: status => status >= 200 && status < 500
      });
      saveCookies(response);
      if (response.status >= 400) throw new Error(`HTTP ${response.status}`);
      return response;
    } catch (error) {
      lastError = error;
      if (attempt + 1 < CONFIG.retries) await sleep(1000 * (attempt + 1));
    }
  }
  throw lastError;
}

async function resolveSpotifyUrl(url) {
  let target = url.trim();
  if (target.includes("spotify.link") || target.includes("spotify.com/s/")) {
    try {
      const response = await axios.get(target, {
        headers: { "User-Agent": "WhatsApp/2.21.19.21 A" },
        maxRedirects: 5, timeout: 10000,
        validateStatus: status => status >= 200 && status < 400
      });
      if (response.request?.res?.responseUrl) target = response.request.res.responseUrl;
      else if (response.headers.location) target = response.headers.location;
      else if (typeof response.data === "string") {
        const $ = cheerio.load(response.data);
        target = $('meta[property="og:url"]').attr("content") || target;
      }
    } catch {}
  }
  return target.split("?")[0];
}

async function getSpotifyDownload(url) {
  const cleanUrl = await resolveSpotifyUrl(url);

  const downloadHeaders = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    Accept: "application/json, text/javascript, */*; q=0.01",
    "X-Requested-With": "XMLHttpRequest",
    Referer: `${CONFIG.downloadURL}/`,
    Origin: CONFIG.downloadURL
  };

  const response = await request(`${CONFIG.downloadURL}/action`, {
    method: "POST",
    headers: { ...downloadHeaders, "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" },
    data: new URLSearchParams({ url: cleanUrl, "g-recaptcha-response": "dummy_token" }).toString()
  });

  let data = response.data;
  if (typeof data === "string") {
    try { data = JSON.parse(data); } catch { throw new Error("Response download bukan JSON valid"); }
  }
  if (!data || data.error) throw new Error(data?.message || "Gagal memproses Spotify URL");

  const $ = cheerio.load(data.data || data);
  const forms = $('form[name="submitspurl"]');
  if (!forms.length) throw new Error("Track tidak ditemukan di SpotiDown");

  const tracks = [];
  forms.each((index, form) => {
    const element = $(form);
    const dataVal = element.find('input[name="data"]').val() || "";
    const baseVal = element.find('input[name="base"]').val() || cleanUrl;
    const tokenVal = element.find('input[name="token"]').val() || "";
    let meta = {};
    if (dataVal) { try { meta = JSON.parse(Buffer.from(dataVal, "base64").toString("utf8")); } catch {} }
    const container = element.closest(".grid-container, .row, .spotidown-downloader, div");
    tracks.push({
      index: index + 1,
      title: meta.name || meta.title || container.find("h1, h2, h3").first().text().trim() || "Spotify Track",
      artist: meta.artist || meta.singer || container.find("p").first().text().trim() || null,
      payload: { data: dataVal, base: baseVal, token: tokenVal, "g-recaptcha-response": "dummy_token" }
    });
  });

  const first = tracks[0];
  const trackResponse = await request(`${CONFIG.downloadURL}/action/track`, {
    method: "POST",
    headers: { ...downloadHeaders, "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8", Cookie: [...cookies].map(([key, value]) => `${key}=${value}`).join("; ") },
    data: new URLSearchParams(first.payload).toString()
  });

  let trackData = trackResponse.data;
  if (typeof trackData === "string") {
    try { trackData = JSON.parse(trackData); } catch { throw new Error("Gagal membaca response download track"); }
  }
  if (!trackData || trackData.error) throw new Error(trackData?.message || "Gagal mendapatkan link download");

  const $download = cheerio.load(trackData.data || trackData);
  let audioUrl = null;

  $download("a").each((_, element) => {
    const href = $download(element).attr("href");
    const text = $download(element).text().trim();
    if (href && href.startsWith("http") && !href.includes("premium.html") && text !== "Download Another Song") {
      if (!text.toLowerCase().includes("cover") && !href.toLowerCase().includes("cover")) {
        audioUrl = href;
      }
    }
  });

  if (!audioUrl) throw new Error("Link audio download tidak ditemukan");
  return audioUrl;
}

module.exports = { getSpotifyDownload };