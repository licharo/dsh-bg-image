/**
 * 生成测试用 PNG（不引入任何图形库，直接手写 PNG 编码 + zlib deflate）。
 *
 * 输出两张图：
 *   dev-tools/test/assets/grid.png   —— 400x300 的四象限色块 + 网格线（便于肉眼确认
 *                                        覆盖/包含/拉伸/平铺/偏移是否生效）
 *   dev-tools/test/assets/photo.png  —— 800x450 的横向渐变（模拟照片壁纸）
 *
 * 运行：<DSH bundled node> dev-tools/make-test-image.mjs
 */

import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const assets = join(here, 'test', 'assets')
mkdirSync(assets, { recursive: true })

const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  return table
})()

function crc32(buffer) {
  let c = 0xffffffff
  for (let i = 0; i < buffer.length; i += 1) c = CRC_TABLE[(c ^ buffer[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length, 0)
  const typeBuffer = Buffer.from(type, 'ascii')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0)
  return Buffer.concat([length, typeBuffer, data, crc])
}

/** pixels: Uint8Array of width*height*3 (RGB)。 */
function encodePng(width, height, pixels) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8        // bit depth
  ihdr[9] = 2        // color type: truecolor RGB
  ihdr[10] = 0       // compression
  ihdr[11] = 0       // filter
  ihdr[12] = 0       // interlace
  const stride = width * 3
  const raw = Buffer.alloc((stride + 1) * height)
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0 // filter type 0 (None)
    Buffer.from(pixels.buffer, pixels.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1)
  }
  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ])
}

/** 四象限 + 网格线，尺寸不规整便于观察 cover / contain / custom / tile 的差别。 */
function makeGrid(width, height) {
  const pixels = new Uint8Array(width * height * 3)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const left = x < width / 2
      const top = y < height / 2
      let color
      if (top && left) color = [232, 74, 74]      // 红
      else if (top) color = [74, 168, 232]        // 蓝
      else if (left) color = [246, 200, 84]       // 黄
      else color = [96, 196, 128]                 // 绿
      const onGrid = x % 50 === 0 || y % 50 === 0
      const onBorder = x < 3 || y < 3 || x >= width - 3 || y >= height - 3
      if (onBorder) color = [20, 20, 24]
      else if (onGrid) color = [Math.round(color[0] * 0.55), Math.round(color[1] * 0.55), Math.round(color[2] * 0.55)]
      const index = (y * width + x) * 3
      pixels[index] = color[0]
      pixels[index + 1] = color[1]
      pixels[index + 2] = color[2]
    }
  }
  return pixels
}

/** 横向渐变，用来肉眼判断透明度与偏移。 */
function makeGradient(width, height) {
  const pixels = new Uint8Array(width * height * 3)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const t = x / (width - 1)
      const v = y / (height - 1)
      const index = (y * width + x) * 3
      pixels[index] = Math.round(20 + 200 * t)
      pixels[index + 1] = Math.round(60 + 120 * (1 - v))
      pixels[index + 2] = Math.round(180 - 140 * t)
    }
  }
  return pixels
}

const grid = makeGrid(400, 300)
writeFileSync(join(assets, 'grid.png'), encodePng(400, 300, grid))
const photo = makeGradient(800, 450)
writeFileSync(join(assets, 'photo.png'), encodePng(800, 450, photo))
console.log('wrote', join(assets, 'grid.png'), 'and', join(assets, 'photo.png'))
