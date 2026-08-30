import { createHash } from 'node:crypto';
import type { LocalArtifact } from '@ev/contracts';

const MAX_DIMENSION = 12_000;
const MAX_PIXELS = 40_000_000;

export class ImageMetadataError extends Error {
  constructor(readonly code: 'IMAGE_SIGNATURE_MISMATCH' | 'IMAGE_DIMENSIONS_INVALID' | 'IMAGE_PIXEL_LIMIT_EXCEEDED') {
    super(code);
  }
}

function equalAt(bytes: Uint8Array, offset: number, values: readonly number[]): boolean {
  return values.every((value, index) => bytes[offset + index] === value);
}

function u16be(bytes: Uint8Array, offset: number): number {
  return (bytes[offset]! << 8) | bytes[offset + 1]!;
}

function u16le(bytes: Uint8Array, offset: number): number {
  return bytes[offset]! | (bytes[offset + 1]! << 8);
}

function u24le(bytes: Uint8Array, offset: number): number {
  return bytes[offset]! | (bytes[offset + 1]! << 8) | (bytes[offset + 2]! << 16);
}

function u32be(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset]! * 2 ** 24) + (bytes[offset + 1]! << 16) + (bytes[offset + 2]! << 8) + bytes[offset + 3]!) >>> 0;
}

function u32le(bytes: Uint8Array, offset: number): number {
  return (bytes[offset]! + (bytes[offset + 1]! * 2 ** 8) + (bytes[offset + 2]! * 2 ** 16) + (bytes[offset + 3]! * 2 ** 24)) >>> 0;
}

function pngDimensions(bytes: Uint8Array): { width: number; height: number } | undefined {
  if (!equalAt(bytes, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return undefined;
  if (bytes.length < 24 || !equalAt(bytes, 12, [0x49, 0x48, 0x44, 0x52])) {
    throw new ImageMetadataError('IMAGE_DIMENSIONS_INVALID');
  }
  return { width: u32be(bytes, 16), height: u32be(bytes, 20) };
}

function jpegDimensions(bytes: Uint8Array): { width: number; height: number } | undefined {
  if (!equalAt(bytes, 0, [0xff, 0xd8])) return undefined;
  let offset = 2;
  while (offset < bytes.length) {
    while (bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset++];
    if (marker === undefined || marker === 0xd9 || marker === 0xda) break;
    if (marker >= 0xd0 && marker <= 0xd7) continue;
    if (offset + 1 >= bytes.length) throw new ImageMetadataError('IMAGE_DIMENSIONS_INVALID');
    const length = u16be(bytes, offset);
    if (length < 2 || offset + length > bytes.length) throw new ImageMetadataError('IMAGE_DIMENSIONS_INVALID');
    if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf)) {
      if (length < 8) throw new ImageMetadataError('IMAGE_DIMENSIONS_INVALID');
      return { height: u16be(bytes, offset + 3), width: u16be(bytes, offset + 5) };
    }
    offset += length;
  }
  throw new ImageMetadataError('IMAGE_DIMENSIONS_INVALID');
}

function webpDimensions(bytes: Uint8Array): { width: number; height: number } | undefined {
  if (!equalAt(bytes, 0, [0x52, 0x49, 0x46, 0x46]) || !equalAt(bytes, 8, [0x57, 0x45, 0x42, 0x50])) return undefined;
  if (bytes.length < 20) throw new ImageMetadataError('IMAGE_DIMENSIONS_INVALID');
  if (u32le(bytes, 4) !== bytes.length - 8) throw new ImageMetadataError('IMAGE_DIMENSIONS_INVALID');
  let offset = 12;
  let dimensions: { width: number; height: number } | undefined;
  while (offset < bytes.length) {
    if (offset + 8 > bytes.length) throw new ImageMetadataError('IMAGE_DIMENSIONS_INVALID');
    const chunkSize = u32le(bytes, offset + 4);
    const payloadOffset = offset + 8;
    const payloadEnd = payloadOffset + chunkSize;
    const paddedEnd = payloadEnd + (chunkSize % 2);
    if (!Number.isSafeInteger(payloadEnd) || paddedEnd > bytes.length) throw new ImageMetadataError('IMAGE_DIMENSIONS_INVALID');
    if (chunkSize % 2 === 1 && bytes[payloadEnd] !== 0) throw new ImageMetadataError('IMAGE_DIMENSIONS_INVALID');
    if (offset === 12 && equalAt(bytes, offset, [0x56, 0x50, 0x38, 0x58])) {
      if (chunkSize !== 10) throw new ImageMetadataError('IMAGE_DIMENSIONS_INVALID');
      dimensions = { width: u24le(bytes, payloadOffset + 4) + 1, height: u24le(bytes, payloadOffset + 7) + 1 };
    } else if (offset === 12 && equalAt(bytes, offset, [0x56, 0x50, 0x38, 0x20])) {
      if (chunkSize < 10 || !equalAt(bytes, payloadOffset + 3, [0x9d, 0x01, 0x2a])) throw new ImageMetadataError('IMAGE_DIMENSIONS_INVALID');
      dimensions = { width: u16le(bytes, payloadOffset + 6) & 0x3fff, height: u16le(bytes, payloadOffset + 8) & 0x3fff };
    } else if (offset === 12 && equalAt(bytes, offset, [0x56, 0x50, 0x38, 0x4c])) {
      if (chunkSize < 5 || bytes[payloadOffset] !== 0x2f) throw new ImageMetadataError('IMAGE_DIMENSIONS_INVALID');
      const first = bytes[payloadOffset + 1]!;
      const second = bytes[payloadOffset + 2]!;
      const third = bytes[payloadOffset + 3]!;
      const fourth = bytes[payloadOffset + 4]!;
      dimensions = {
        width: 1 + first + ((second & 0x3f) << 8),
        height: 1 + (second >> 6) + (third << 2) + ((fourth & 0x0f) << 10),
      };
    } else if (offset === 12) {
      throw new ImageMetadataError('IMAGE_DIMENSIONS_INVALID');
    }
    offset = paddedEnd;
  }
  if (offset !== bytes.length || !dimensions) throw new ImageMetadataError('IMAGE_DIMENSIONS_INVALID');
  return dimensions;
}

export function readImageMetadata(
  image: Uint8Array,
  declaredMediaType: LocalArtifact['mediaType'],
): Pick<LocalArtifact, 'mediaType' | 'byteSize' | 'width' | 'height' | 'pixelCount' | 'sha256'> {
  const actual: LocalArtifact['mediaType'] | undefined = equalAt(image, 0, [0x89, 0x50, 0x4e, 0x47])
    ? 'image/png'
    : equalAt(image, 0, [0xff, 0xd8])
      ? 'image/jpeg'
      : equalAt(image, 0, [0x52, 0x49, 0x46, 0x46]) && equalAt(image, 8, [0x57, 0x45, 0x42, 0x50])
        ? 'image/webp'
        : undefined;
  if (!actual || actual !== declaredMediaType) throw new ImageMetadataError('IMAGE_SIGNATURE_MISMATCH');
  const dimensions = actual === 'image/png'
    ? pngDimensions(image)
    : actual === 'image/jpeg'
      ? jpegDimensions(image)
      : webpDimensions(image);
  if (!dimensions) throw new ImageMetadataError('IMAGE_DIMENSIONS_INVALID');
  if (!Number.isInteger(dimensions.width) || !Number.isInteger(dimensions.height) || dimensions.width < 1 || dimensions.height < 1 || dimensions.width > MAX_DIMENSION || dimensions.height > MAX_DIMENSION) {
    throw new ImageMetadataError('IMAGE_DIMENSIONS_INVALID');
  }
  const pixelCount = dimensions.width * dimensions.height;
  if (!Number.isSafeInteger(pixelCount) || pixelCount > MAX_PIXELS) throw new ImageMetadataError('IMAGE_PIXEL_LIMIT_EXCEEDED');
  return {
    mediaType: actual,
    byteSize: image.byteLength,
    width: dimensions.width,
    height: dimensions.height,
    pixelCount,
    sha256: createHash('sha256').update(image).digest('hex'),
  };
}
