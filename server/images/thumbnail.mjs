import sharp from "sharp";

export async function createImageThumbnail(original) {
  try {
    return await sharp(original, { failOn: "error" })
      .rotate()
      .flatten({ background: "#ffffff" })
      .resize({ width: 360, height: 360, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 72, mozjpeg: true })
      .toBuffer();
  } catch {
    // Older formats remain viewable even when the server cannot decode them.
    return null;
  }
}
