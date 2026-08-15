/** Tiny header sniffers for PNG/JPEG/GIF/WebP — enough for dimensions + mime without native deps. */
export interface ImageMeta {
  mime: string
  width: number | null
  height: number | null
}

export function sniffImage(buf: Buffer): ImageMeta | null {
  if (buf.length < 12) return null
  // PNG
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    return { mime: 'image/png', width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
  }
  // GIF
  if (buf.toString('ascii', 0, 3) === 'GIF') {
    return { mime: 'image/gif', width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) }
  }
  // WebP
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
    const chunk = buf.toString('ascii', 12, 16)
    if (chunk === 'VP8 ' && buf.length >= 30) return { mime: 'image/webp', width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff }
    if (chunk === 'VP8L' && buf.length >= 25) {
      const b = buf.readUInt32LE(21)
      return { mime: 'image/webp', width: (b & 0x3fff) + 1, height: ((b >> 14) & 0x3fff) + 1 }
    }
    if (chunk === 'VP8X' && buf.length >= 30) {
      return { mime: 'image/webp', width: (buf.readUIntLE(24, 3) & 0xffffff) + 1, height: (buf.readUIntLE(27, 3) & 0xffffff) + 1 }
    }
    return { mime: 'image/webp', width: null, height: null }
  }
  // JPEG
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let off = 2
    while (off + 9 < buf.length) {
      if (buf[off] !== 0xff) {
        off++
        continue
      }
      const marker = buf[off + 1]
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        off += 2
        continue
      }
      const len = buf.readUInt16BE(off + 2)
      if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf)) {
        return { mime: 'image/jpeg', width: buf.readUInt16BE(off + 7), height: buf.readUInt16BE(off + 5) }
      }
      off += 2 + len
    }
    return { mime: 'image/jpeg', width: null, height: null }
  }
  // BMP
  if (buf[0] === 0x42 && buf[1] === 0x4d && buf.length >= 26) {
    return { mime: 'image/bmp', width: buf.readInt32LE(18), height: Math.abs(buf.readInt32LE(22)) }
  }
  return null
}

export function extForMime(mime: string): string {
  return (
    { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/bmp': 'bmp', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'audio/ogg': 'ogg', 'audio/flac': 'flac', 'text/plain': 'txt', 'application/pdf': 'pdf', 'text/markdown': 'md' }[
      mime
    ] ?? 'bin'
  )
}

export function kindForMime(mime: string): 'image' | 'audio' | 'file' {
  if (mime.startsWith('image/')) return 'image'
  if (mime.startsWith('audio/')) return 'audio'
  return 'file'
}
