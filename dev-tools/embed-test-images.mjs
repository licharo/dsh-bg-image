/**
 * 把测试图片打成 data URL 的 .js 文件，供浏览器测试台直接使用
 * （file:// 下不能让页面自己读文件，所以预先生成）。
 *
 * 运行：<DSH bundled node> dev-tools/embed-test-images.mjs
 */

import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, basename } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const assets = join(here, 'test', 'assets')

const produced = []
for (const file of readdirSync(assets)) {
  if (!file.endsWith('.png')) continue
  const bytes = readFileSync(join(assets, file))
  const key = basename(file, '.png')
  const dataUrl = `data:image/png;base64,${bytes.toString('base64')}`
  const body = `/* 由 dev-tools/embed-test-images.mjs 生成，请勿手改。源文件：${file} */\nwindow.__testImages = window.__testImages || {};\nwindow.__testImages[${JSON.stringify(key)}] = ${JSON.stringify(dataUrl)};\n`
  writeFileSync(join(assets, `${file}.js`), body)
  produced.push(`${file} -> ${file}.js (${bytes.length} bytes)`)
}

console.log(produced.join('\n'))
