import fs from 'fs/promises';

const IMAGE_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.bmp',
  '.tiff',
  '.heic',
  '.heif',
]);

const MEDIA_NOTE_PATTERN = /\[media attached:\s*([^\s(]+)\s*\(([^)]+)\)\]/g;

export interface ImageData {
  base64: string;
  mediaType: string;
  path: string;
}

function hasPrefix(buffer: Buffer, bytes: number[]): boolean {
  return bytes.every((byte, index) => buffer[index] === byte);
}

export function detectSupportedImageMediaType(buffer: Buffer): string | null {
  if (buffer.length >= 8 && hasPrefix(buffer, [0x89, 0x50, 0x4e, 0x47])) {
    return 'image/png';
  }

  if (buffer.length >= 3 && hasPrefix(buffer, [0xff, 0xd8, 0xff])) {
    return 'image/jpeg';
  }

  if (
    buffer.length >= 6 &&
    (buffer.subarray(0, 6).toString('ascii') === 'GIF87a' ||
      buffer.subarray(0, 6).toString('ascii') === 'GIF89a')
  ) {
    return 'image/gif';
  }

  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'image/webp';
  }

  return null;
}

/**
 * Check if a file path has an image extension
 */
export function isImageFile(filePath: string): boolean {
  const ext = filePath.toLowerCase().slice(filePath.lastIndexOf('.'));
  return IMAGE_EXTENSIONS.has(ext);
}

/**
 * Get MIME type from file extension
 */
export function getMimeTypeFromExtension(filePath: string): string {
  const extToMime: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.bmp': 'image/bmp',
    '.tiff': 'image/tiff',
    '.heic': 'image/heic',
    '.heif': 'image/heif',
  };

  const ext = filePath.toLowerCase().slice(filePath.lastIndexOf('.'));
  return extToMime[ext] || 'application/octet-stream';
}

/**
 * Extract image paths from media notes in prompt text
 */
export function extractImagePathsFromMediaNotes(
  prompt: string,
): Array<{ path: string; mimeType: string }> {
  const images: Array<{ path: string; mimeType: string }> = [];
  const matches = [...prompt.matchAll(MEDIA_NOTE_PATTERN)];

  for (const match of matches) {
    const filePath = match[1];
    const mimeType = match[2];

    if (isImageFile(filePath)) {
      images.push({ path: filePath, mimeType });
    }
  }

  return images;
}

/**
 * Load image file and convert to base64
 */
export async function loadImageAsBase64(
  filePath: string,
  mimeType: string,
): Promise<ImageData> {
  const buffer = await fs.readFile(filePath);
  const detectedMediaType = detectSupportedImageMediaType(buffer);

  if (!detectedMediaType) {
    throw new Error(`Unsupported or invalid image data: ${filePath}`);
  }

  const base64 = buffer.toString('base64');

  return {
    base64,
    mediaType:
      detectedMediaType || mimeType || getMimeTypeFromExtension(filePath),
    path: filePath,
  };
}

/**
 * Detect and load all images from prompt media notes
 * Returns array of image data ready for model injection
 */
export async function detectAndLoadImages(
  prompt: string,
): Promise<ImageData[]> {
  const imagePaths = extractImagePathsFromMediaNotes(prompt);

  const images: ImageData[] = [];
  for (const { path, mimeType } of imagePaths) {
    try {
      const imageData = await loadImageAsBase64(path, mimeType);
      images.push(imageData);
    } catch (err) {
      console.warn(`Failed to load image ${path}:`, err);
    }
  }

  return images;
}

/**
 * Detect if a file is an image and load it
 * Used by the Read tool
 */
export async function readImageFile(
  filePath: string,
): Promise<ImageData | null> {
  if (!isImageFile(filePath)) {
    return null;
  }

  try {
    const mimeType = getMimeTypeFromExtension(filePath);
    return await loadImageAsBase64(filePath, mimeType);
  } catch (err) {
    console.warn(`Failed to read image ${filePath}:`, err);
    return null;
  }
}
