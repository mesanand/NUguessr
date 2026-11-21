// HEIC/HEIF -> JPEG via heic-convert (pure JS; sharp's prebuilt libvips lacks HEVC).
// heic-convert ships no type declarations, so it is loaded through require with a local signature.
type HeicConvert = (opts: { buffer: Buffer | ArrayBuffer | Uint8Array; format: 'JPEG' | 'PNG'; quality?: number }) => Promise<ArrayBuffer | Buffer>

export async function heicToJpeg(buf: Buffer): Promise<Buffer> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const convert = require('heic-convert') as HeicConvert
  const out = await convert({ buffer: buf, format: 'JPEG', quality: 0.92 })
  return Buffer.from(out as ArrayBuffer)
}
