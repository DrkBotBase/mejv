const express = require('express');
const mongoose = require('mongoose');
const axios = require('axios');
const router = express.Router();

// whatmusic
const multer = require('multer');
const FormData = require('form-data');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');

const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const { fetchNeoxr, fetchStellarwa } = require('../services/api-clients');
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
      const data = await fetchNeoxr('/spotify', { url });
      rawFileUrl = data.data.url;
      filename = `audio_${Date.now()}.mp3`;

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

if (!ffmpegPath) {
    throw new Error('No se encontró el binario de FFmpeg.');
}
ffmpeg.setFfmpegPath(ffmpegPath);
const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 10 * 1024 * 1024
    },
    fileFilter: (req, file, callback) => {
        if (!file.mimetype || !file.mimetype.startsWith('audio/')) {
            return callback(new Error('Solo se permiten archivos de audio.'));
        }

        callback(null, true);
    }
});
function getInputFormat(mimeType = '') {
    const baseMimeType = mimeType
        .toLowerCase()
        .split(';')[0]
        .trim();

    const formats = {
        'audio/webm': 'webm',
        'audio/ogg': 'ogg',
        'audio/mp4': 'mp4',
        'audio/m4a': 'mp4',
        'audio/x-m4a': 'mp4',
        'audio/mpeg': 'mp3'
    };

    return formats[baseMimeType] || null;
}
async function convertAudioToMp3(buffer, mimeType) {
    const tempDir = await fsp.mkdtemp(
        path.join(os.tmpdir(), 'mejv-audio-')
    );

    const inputPath = path.join(
        tempDir,
        `input-${crypto.randomUUID()}`
    );

    const outputPath = path.join(
        tempDir,
        `output-${crypto.randomUUID()}.mp3`
    );

    try {
        await fsp.writeFile(inputPath, buffer);

        const inputFormat = getInputFormat(mimeType);

        await new Promise((resolve, reject) => {
            let command = ffmpeg(inputPath);

            if (inputFormat) {
                command = command.inputFormat(inputFormat);
            }

            command
                .audioCodec('libmp3lame')
                .audioBitrate('128k')
                .audioChannels(1)
                .audioFrequency(44100)
                .format('mp3')
                .on('end', resolve)
                .on('error', reject)
                .save(outputPath);
        });

        const mp3Buffer = await fsp.readFile(outputPath);

        if (!mp3Buffer.length) {
            throw new Error('FFmpeg generó un archivo MP3 vacío.');
        }

        return mp3Buffer;
    } finally {
        await fsp.rm(tempDir, {
            recursive: true,
            force: true
        });
    }
}
router.post('/whatmusic', upload.single('audio'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({
                status: false,
                error: 'No se envió ningún audio.'
            });
        }

        const mp3Buffer = await convertAudioToMp3(
            req.file.buffer,
            req.file.mimetype
        );

        const formData = new FormData();

        formData.append('file', mp3Buffer, {
            filename: 'grabacion.mp3',
            contentType: 'audio/mpeg',
            knownLength: mp3Buffer.length
        });

        const uploadResponse = await axios.post(
            'https://tmpfiles.org/api/v1/upload',
            formData,
            {
                headers: formData.getHeaders(),
                maxBodyLength: Infinity,
                maxContentLength: Infinity,
                timeout: 15000
            }
        );

        const temporaryUrl = uploadResponse.data?.data?.url;

        if (!temporaryUrl) {
            throw new Error(
                'tmpfiles.org no devolvió una URL válida.'
            );
        }

        const directUrl = temporaryUrl.includes('/dl/')
            ? temporaryUrl
            : temporaryUrl.replace(
                'tmpfiles.org/',
                'tmpfiles.org/dl/'
            );

        const neoxrResponse = await fetchNeoxr(
            '/whatmusic',
            {
                url: directUrl
            }
        );

        return res.json(neoxrResponse);
    } catch (error) {
        console.error('[WhatMusic Error]', error);

        return res.status(500).json({
            status: false,
            error: 'No se pudo convertir o reconocer la canción. Intenta grabar de nuevo.'
        });
    }
});
router.post('/whatmusic-url', async (req, res) => {
    try {
        const { url } = req.body || {};

        if (!url || typeof url !== 'string') {
            return res.status(400).json({
                status: false,
                error: 'Falta el enlace del audio.'
            });
        }

        let parsedUrl;

        try {
            parsedUrl = new URL(url.trim());

            if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
                throw new Error('Protocolo inválido');
            }
        } catch {
            return res.status(400).json({
                status: false,
                error: 'El enlace debe ser una URL válida.'
            });
        }

        const neoxrResponse = await fetchNeoxr(
            '/whatmusic',
            {
                url: parsedUrl.href
            }
        );

        return res.json(neoxrResponse);
    } catch (error) {
        console.error('[WhatMusic URL Error]', error);

        return res.status(500).json({
            status: false,
            error: 'No se pudo reconocer la canción desde el enlace.'
        });
    }
});

module.exports = router;