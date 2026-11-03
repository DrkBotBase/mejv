const axios = require('axios');

async function scrapePinterest(pinterestUrl) {
  try {
    const tokenRes = await axios.post('https://ssspin.io/action/token', new URLSearchParams({
      url: pinterestUrl,
      lang: 'es'
    }), {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });

    if (!tokenRes.data || !tokenRes.data.success || !tokenRes.data.vtoken) {
      throw new Error('No se pudo obtener el token de ssspin.io');
    }

    const vtoken = tokenRes.data.vtoken;

    const actionRes = await axios.post('https://ssspin.io/action', new URLSearchParams({
      lang: 'es',
      url: pinterestUrl,
      vtoken: vtoken
    }), {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://ssspin.io/es'
      }
    });

    if (!actionRes.data || !actionRes.data.success || !actionRes.data.html) {
      throw new Error('s sspin.io no devolvió el HTML de descarga');
    }

    const html = actionRes.data.html;
    const regex = /<div class='result_actions'>[\s\S]*?<a href='([^']+)'/i;
    const match = html.match(regex);

    if (match && match[1]) {
      return {
        url: match[1],
        isVideo: html.includes('meta-video'),
        title: html.match(/<p class='title'>([^<]+)<\/p>/)?.[1]?.trim() || 'Pinterest Media'
      };
    }
  } catch (error) {
    console.error('[Pinterest Scraper Error]:', error.message);
    return null;
  }
}

module.exports = { scrapePinterest };