const axios = require('axios');
const TOKEN_SCRAP = process.env.TOKEN_SCRAP || 'dFdnWkI3';

async function scrapeTikTok(tiktokUrl) {
  try {
    const payload = new URLSearchParams({
      id: tiktokUrl,
      locale: 'en',
      tt: TOKEN_SCRAP
    });

    const response = await axios.post('https://ssstik.io/abc?url=dl', payload, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://ssstik.io/en',
        'Origin': 'https://ssstik.io',
        'Accept': '*/*'
      },
      timeout: 15000
    });

    const html = response.data;

    const regexVideo = /<a\b(?=[^>]*\bclass="[^"]*\bwithout_watermark\b(?!_hd)[^"]*")(?=[^>]*\bhref="([^"]+)")[^>]*>/i;
    const matchVideo = html.match(regexVideo);
    if (matchVideo && matchVideo[1]) {
      return { type: 'video', urls: [matchVideo[1]] };
    }

    const regexSlides = /<a\b(?=[^>]*\bclass="[^"]*\bdownload_link\b[^"]*\bslide\b[^"]*")(?=[^>]*\bhref="([^"]+)")[^>]*>/gi;
    const urls = [];
    let m;
    while ((m = regexSlides.exec(html)) !== null) {
      if (m[1] && !urls.includes(m[1])) urls.push(m[1]);
    }
    if (urls.length > 0) {
      return { type: 'images', urls };
    }

    return null;
  } catch (error) {
    console.error('[Scraper TikTok Error]:', error.message);
    return null;
  }
}

module.exports = { scrapeTikTok };