const { loadEsm } = require('load-esm');

let snapsaveModule = null;

async function getSnapsave() {
  if (!snapsaveModule) {
    snapsaveModule = await loadEsm('snapsave-media-downloader');
  }
  return snapsaveModule;
}

async function getSocialMedia(url) {
  try {
    const { snapsave } = await getSnapsave();
    const result = await snapsave(url);

    if (!result.success || !result.data || !result.data.media) {
      throw new Error(result.message || 'No se pudo extraer el contenido');
    }

    const media = result.data.media;

    const video = media.find(item => item.type === 'video');
    if (video) {
      return { type: 'video', url: video.url };
    }

    const images = media.filter(item => item.type === 'image').map(item => item.url);
    
    if (images.length > 0) {
      return { type: 'images', urls: images };
    }

    throw new Error('El contenido no tiene imágenes ni videos válidos');

  } catch (error) {
    console.error('[SnapSave Scraper Error]:', error.message);
    return null;
  }
}

module.exports = { getSocialMedia };