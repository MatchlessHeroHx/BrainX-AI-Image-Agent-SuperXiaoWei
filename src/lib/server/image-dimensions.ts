const isValidSize = (width: number, height: number) => width > 0 && height > 0;

const readSvgDimensions = (buffer: Buffer) => {
  const content = buffer.toString("utf8");
  const viewBoxMatch = content.match(/viewBox=["']\s*[\d.+-]+\s+[\d.+-]+\s+([\d.+-]+)\s+([\d.+-]+)\s*["']/i);

  if (viewBoxMatch) {
    const width = Number.parseFloat(viewBoxMatch[1]);
    const height = Number.parseFloat(viewBoxMatch[2]);

    if (isValidSize(width, height)) {
      return { width, height };
    }
  }

  const widthMatch = content.match(/width=["']([\d.]+)(?:px)?["']/i);
  const heightMatch = content.match(/height=["']([\d.]+)(?:px)?["']/i);

  if (widthMatch && heightMatch) {
    const width = Number.parseFloat(widthMatch[1]);
    const height = Number.parseFloat(heightMatch[1]);

    if (isValidSize(width, height)) {
      return { width, height };
    }
  }

  return null;
};

const readPngDimensions = (buffer: Buffer) => {
  if (buffer.length < 24 || buffer.toString("ascii", 1, 4) !== "PNG") {
    return null;
  }

  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  return isValidSize(width, height) ? { width, height } : null;
};

const readGifDimensions = (buffer: Buffer) => {
  if (buffer.length < 10 || buffer.toString("ascii", 0, 3) !== "GIF") {
    return null;
  }

  const width = buffer.readUInt16LE(6);
  const height = buffer.readUInt16LE(8);
  return isValidSize(width, height) ? { width, height } : null;
};

const SOF_MARKERS = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
]);

const readJpegDimensions = (buffer: Buffer) => {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) {
    return null;
  }

  let offset = 2;
  while (offset + 1 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }

    const marker = buffer[offset + 1];
    offset += 2;

    if (marker === 0xd8 || marker === 0xd9) {
      continue;
    }

    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      continue;
    }

    if (offset + 2 > buffer.length) {
      return null;
    }

    const segmentLength = buffer.readUInt16BE(offset);
    if (segmentLength < 2 || offset + segmentLength > buffer.length) {
      return null;
    }

    if (SOF_MARKERS.has(marker)) {
      const height = buffer.readUInt16BE(offset + 3);
      const width = buffer.readUInt16BE(offset + 5);
      return isValidSize(width, height) ? { width, height } : null;
    }

    offset += segmentLength;
  }

  return null;
};

const readWebpDimensions = (buffer: Buffer) => {
  if (
    buffer.length < 30 ||
    buffer.toString("ascii", 0, 4) !== "RIFF" ||
    buffer.toString("ascii", 8, 12) !== "WEBP"
  ) {
    return null;
  }

  const chunkType = buffer.toString("ascii", 12, 16);

  if (chunkType === "VP8X") {
    const width = 1 + buffer.readUIntLE(24, 3);
    const height = 1 + buffer.readUIntLE(27, 3);
    return isValidSize(width, height) ? { width, height } : null;
  }

  if (chunkType === "VP8 " && buffer.length >= 30) {
    const width = buffer.readUInt16LE(26) & 0x3fff;
    const height = buffer.readUInt16LE(28) & 0x3fff;
    return isValidSize(width, height) ? { width, height } : null;
  }

  if (chunkType === "VP8L" && buffer.length >= 25 && buffer[20] === 0x2f) {
    const b0 = buffer[21];
    const b1 = buffer[22];
    const b2 = buffer[23];
    const b3 = buffer[24];
    const width = 1 + (((b1 & 0x3f) << 8) | b0);
    const height = 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6));
    return isValidSize(width, height) ? { width, height } : null;
  }

  return null;
};

export const detectImageDimensions = (buffer: Buffer, mimeType: string) => {
  switch (mimeType) {
    case "image/png":
      return readPngDimensions(buffer);
    case "image/jpeg":
      return readJpegDimensions(buffer);
    case "image/webp":
      return readWebpDimensions(buffer);
    case "image/gif":
      return readGifDimensions(buffer);
    case "image/svg+xml":
      return readSvgDimensions(buffer);
    default:
      return null;
  }
};
