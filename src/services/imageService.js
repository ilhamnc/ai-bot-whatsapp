// Layanan optimasi gambar untuk dikirim ke model vision AI.
import sharp from 'sharp';

export const MAX_INCOMING_IMAGE_BYTES = 20 * 1024 * 1024; // 20 MB
export const MAX_AI_IMAGE_BYTES = 6 * 1024 * 1024; // 6 MB

/**
 * Mengompresi dan mengubah ukuran gambar agar memenuhi batas ukuran model AI (maks 6 MB).
 * @param {Buffer} buffer
 * @param {string} mimeType
 * @returns {Promise<{ buffer: Buffer, mimeType: string }>}
 */
export async function optimizeImageForAi(buffer, mimeType) {
  const pipeline = () => sharp(buffer, { failOn: 'error', limitInputPixels: 80_000_000 })
    .rotate()
    .resize({ width: 2560, height: 2560, fit: 'inside', withoutEnlargement: true });

  if (mimeType === 'image/png') {
    const png = await pipeline().png({ compressionLevel: 9, adaptiveFiltering: true }).toBuffer();
    if (png.length <= MAX_AI_IMAGE_BYTES) return { buffer: png, mimeType: 'image/png' };
  } else if (mimeType === 'image/webp') {
    const webp = await pipeline().webp({ quality: 86, effort: 4 }).toBuffer();
    if (webp.length <= MAX_AI_IMAGE_BYTES) return { buffer: webp, mimeType: 'image/webp' };
  }

  let jpeg = await pipeline().flatten({ background: '#ffffff' }).jpeg({ quality: 85, mozjpeg: true }).toBuffer();
  if (jpeg.length > MAX_AI_IMAGE_BYTES) {
    jpeg = await sharp(buffer, { failOn: 'error', limitInputPixels: 80_000_000 })
      .rotate()
      .resize({ width: 1920, height: 1920, fit: 'inside', withoutEnlargement: true })
      .flatten({ background: '#ffffff' })
      .jpeg({ quality: 76, mozjpeg: true })
      .toBuffer();
  }
  if (jpeg.length > MAX_AI_IMAGE_BYTES) {
    jpeg = await sharp(buffer, { failOn: 'error', limitInputPixels: 80_000_000 })
      .rotate()
      .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
      .flatten({ background: '#ffffff' })
      .jpeg({ quality: 68, mozjpeg: true })
      .toBuffer();
  }
  if (jpeg.length > MAX_AI_IMAGE_BYTES) {
    throw new Error('Gambar tetap terlalu besar setelah dikompresi');
  }
  return { buffer: jpeg, mimeType: 'image/jpeg' };
}
