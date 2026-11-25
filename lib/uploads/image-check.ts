const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5 MB

export type ValidatedImage = {
  mimeType: "image/jpeg" | "image/png" | "image/webp";
  ext: "jpg" | "png" | "webp";
};

/**
 * Validate an uploaded image buffer by size and magic bytes (JPEG, PNG, WEBP).
 * Rejects empty buffers, files larger than 5 MB, and all other formats (including SVG/HTML/GIF).
 */
export function validateImageBuffer(buffer: Buffer): ValidatedImage {
  if (!buffer || buffer.length === 0) {
    throw new Error("Uploaded image is empty.");
  }
  if (buffer.length > MAX_IMAGE_BYTES) {
    throw new Error("Uploaded image exceeds the 5 MB size limit.");
  }

  // JPEG: FF D8 FF
  if (
    buffer.length >= 3 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff
  ) {
    return { mimeType: "image/jpeg", ext: "jpg" };
  }

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return { mimeType: "image/png", ext: "png" };
  }

  // WEBP: "RIFF" at 0..3 and "WEBP" at 8..11
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
    buffer.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return { mimeType: "image/webp", ext: "webp" };
  }

  throw new Error("Unsupported image format. Only JPEG, PNG, and WEBP are allowed.");
}
