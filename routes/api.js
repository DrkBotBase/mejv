const express = require('express');
const mongoose = require('mongoose');
const axios = require('axios');
const router = express.Router();

const { fetchNeoxr, fetchStellarwa } = require('../services/api-clients');
const { getSpotifyDownload } = require('../services/spotify');
const { scrapeTikTok } = require('../services/tiktok');
const { scrapePinterest } = require('../services/pinterest');
const { trackLimiter } = require('../utils/limiters');

const usageSchema = new mongoose.Schema({
  userId: { 
    type: String, 
    required: true, 
    unique: true 
  },
  totalCount: { 
    type: Number, 
    default: 0 
  },
  platforms: {
    type: Map,
    of: Number,
    default: {}
  },
  lastUsed: { 
    type: Date, 
    default: Date.now 
  }
});
const Usage = 
  mongoose.models.Usage || 
  mongoose.model('Usage', usageSchema);

let isAccessEnabled = true; 
router.get('/access', (req, res) => {
    const { key, status } = req.query;
    
    const ADMIN_KEY = process.env.ADMIN_PASSWORD;
    if (key && key === ADMIN_KEY) {
        if (status === 'false') {
            isAccessEnabled = false;
        } else if (status === 'true') {
            isAccessEnabled = true;
        } else {
            isAccessEnabled = !isAccessEnabled; 
        }
    }

    return res.json({ 
        status: isAccessEnabled,
        timestamp: new Date().toISOString(),
        message: isAccessEnabled ? 'Servicio activo' : 'Servicio en mantenimiento'
    });
});
router.get('/resolve', async (req, res) => {
  const { url, type, platform, quality } = req.query;
  
  if (!url || !type) return res.status(400).json({ status: false, error: 'Faltan parámetros' });

  try {
    let rawFileUrl = null;
    let filename = null;
    let imageResponse = null;

    // ─── YOUTUBE ───
    if (platform === 'youtube') {
      const finalQuality = type === 'audio' ? '128kbps' : (quality || '360p');
      const data = await fetchNeoxr('/youtube', { url, type, quality: finalQuality });
      rawFileUrl = data.data.url;
      filename = data.data.filename || `video_${Date.now()}.mp4`;

    // ─── SPOTIFY ───
    } else if (platform === 'spotify') {
      try {
        rawFileUrl = await getSpotifyDownload(url);
        filename = `audio_${Date.now()}.mp3`;
      } catch {
        const data = await fetchNeoxr('/spotify', { url });
        rawFileUrl = data.data.url;
        filename = `audio_${Date.now()}.mp3`;
      }

    // ─── TIKTOK ───
    } else if (platform === 'tiktok') {
      const result = await scrapeTikTok(url);
      
      if (result) {
        if (result.type === 'images') {
          imageResponse = { images: result.urls, total: result.urls.length };
        } else {
          rawFileUrl = result.urls[0];
          filename = `tiktok_${Date.now()}.mp4`;
        }
      } else {
        //Stellarwa
        const stellarData = await fetchStellarwa('/dl/tiktok', url);
        if (stellarData && stellarData.status) {
          if (stellarData.data.type === 'image') {
            imageResponse = { images: stellarData.data.dl, total: stellarData.data.dl.length };
          } else {
            rawFileUrl = stellarData.data.dl;
            filename = `tiktok_${stellarData.data.id || Date.now()}.mp4`;
          }
        } else {
          // Neo
          const neoData = await fetchNeoxr('/tiktok', { url });
          if (neoData.data.images?.length > 0) {
            imageResponse = { images: neoData.data.images, total: neoData.data.images.length };
          } else {
            rawFileUrl = neoData.data.videoWM || neoData.data.video;
            filename = `tiktok_${neoData.data.id || Date.now()}.mp4`;
          }
        }
      }

    // ─── PINTEREST ───
    } else if (platform === 'pinterest') {
      const result = await scrapePinterest(url);
      
      if (!result || !result.url) {
        throw new Error('No se pudo extraer el contenido de Pinterest.');
      }

      const safeTitle = result.title.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 30);
      
      if (result.isVideo) {
        rawFileUrl = result.url;
        filename = `pinterest_${safeTitle}.mp4`;
      } else {
        imageResponse = { images: [result.url], total: 1 };
      }

    } else if (platform === 'instagram') {
      const result = await fetchNeoxr('/ig', { url });
      
      if (!result || !result.status) {
        throw new Error('No se pudo extraer el contenido de Instagram.');
      }
      
      if (result.data[0].type === 'mp4') {
        rawFileUrl = result.data[0].url;
        filename = `insta_${Date.now()}.mp4`;
      } else {
        const images = result.data.map(item => item.url);
        imageResponse = { images: images, total: images.length };
      }
    } else {
      return res.status(400).json({ status: false, error: 'Plataforma no soportada' });
    }

    if (imageResponse) {
      return res.json({
        status: true,
        type: 'images',
        data: imageResponse
      });
    }

    // ─── Firma) ───
    if (!rawFileUrl) throw new Error('No se pudo obtener el enlace del archivo.');

    let finalSignedUrl = rawFileUrl;
    try {
      const signResponse = await axios.post('https://secure-signed.pages.dev/api/sign', {
        target_url: rawFileUrl,
        filename: filename
      }, { headers: { 'Content-Type': 'application/json' }, timeout: 45000 });

      if (signResponse.data?.status && signResponse.data?.data?.signed_url) {
        finalSignedUrl = signResponse.data.data.signed_url;
      }
    } catch (signError) {
      console.warn('[Sign Error] Usando URL original:', signError.message);
    }

    return res.json({
      status: true,
      type: 'video',
      data: { url: finalSignedUrl, filename }
    });
  } catch (error) {
    console.error('[API Error]', error.message);
    return res.status(500).json({ status: false, error: error.message });
  }
});
router.post('/track-usage', trackLimiter, async (req, res) => {
  try {
    const { userId, platform } = req.body;
    
    if (!userId) {
      return res.status(400).json({ status: false, error: 'Falta userId' });
    }

    if (mongoose.connection.readyState !== 1) {
      return res.json({ status: true, message: 'Tracking omitido (BD offline)' });
    }

    const updateQuery = { 
      $inc: { totalCount: 1 },
      $set: { lastUsed: new Date() }
    };

    if (platform && typeof platform === 'string') {
      const safePlatform = platform.toLowerCase().replace(/[^a-z]/g, '');
      updateQuery.$inc[`platforms.${safePlatform}`] = 1;
    }

    await Usage.findOneAndUpdate(
      { userId: userId },
      updateQuery,
      { upsert: true, new: true }
    );

    return res.json({ status: true });
  } catch (error) {
    console.error('[Track Usage Error]', error.message);
    return res.json({ status: true, message: 'Error al registrar uso' });
  }
});

module.exports = router;