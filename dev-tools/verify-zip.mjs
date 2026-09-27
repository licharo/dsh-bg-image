/**
 * 验证「上传给 GitHub 的 zip」本身可用：解压 → 当作插件目录加载 → 物化并渲染。
 * 用法：<node> dev-tools/verify-zip.mjs <zip 路径>
 */

import { readFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import vm from 'node:vm'
import assert from 'node:assert/strict'

const here = dirname(fileURLToPath(import.meta.url))
const pluginRoot = join(here, '..')
const zipPath = process.argv[2] || join(pluginRoot, 'github-upload', 'dsh-bg-image-1.1.0.zip')
if (!existsSync(zipPath)) {
  console.error('zip not found: ' + zipPath)
  process.exit(2)
}

const stage = mkdtempSync(join(tmpdir(), 'dshbg-zip-'))
// 用 PowerShell 的 Expand-Archive（Windows 自带，无需额外依赖）。
execFileSync('powershell.exe', [
  '-NoLogo', '-NoProfile', '-NonInteractive', '-Command',
  `Expand-Archive -LiteralPath '${zipPath}' -DestinationPath '${stage}' -Force`
], { stdio: 'inherit' })

const { JSDOM } = await import(pathToFileURL(join(pluginRoot, 'dev-tools', 'node_modules', 'jsdom', 'lib', 'api.js')).href)

const manifest = JSON.parse(readFileSync(join(stage, 'package.json'), 'utf8'))
assert.equal(manifest.name, 'dsh-bg-image', 'package name')
assert.equal(manifest.version, '1.1.0', 'package version')
assert.equal(manifest.dsh.client.platform, 'web', 'dsh.client.platform')
assert.equal(manifest.exports['./client'], './lib/client.js', 'exports["./client"]')
assert.ok(existsSync(join(stage, 'cordis.patch.yml')), 'cordis.patch.yml present')
assert.ok(existsSync(join(stage, 'lib', 'index.js')), 'lib/index.js present')
const patch = readFileSync(join(stage, 'cordis.patch.yml'), 'utf8')
assert.match(patch, /id:\s*dsh-bg-image/, 'patch row id')
console.log('ok   zip 解压后的清单/补丁结构正确')

const source = readFileSync(join(stage, 'lib', 'client.js'), 'utf8')
const dom = new JSDOM(
  '<!doctype html><html><head></head><body style="background:#ffffff"><div id="root" style="background-color: rgb(255,255,255)"><main>chat</main></div></body></html>',
  { url: 'http://127.0.0.1:19387/', pretendToBeVisual: true, runScripts: 'outside-only' }
)
const window = dom.window
const registered = []
window.__ModuleLoader__ = { load: (registration) => registered.push(registration) }
vm.runInContext(source, dom.getInternalVMContext(), { filename: 'client.js' })
assert.equal(registered[0].id, 'dsh-bg-image', 'registration id')
const exportsObject = registered[0].factory((specifier) => {
  throw new Error('unexpected require: ' + specifier)
})
assert.equal(typeof exportsObject.apply, 'function', 'apply exported')
exportsObject.apply({})
assert.ok(window.document.getElementById('dshbg-layer'), 'layer injected')
assert.equal(window.document.getElementById('dshbg-toggle'), null, 'no main-UI button by default')
window.__dshBg.set({ dataUrl: 'data:image/png;base64,iVBORw0KGgo=', opacity: 0.5, mode: 'contain' })
const face = window.document.querySelector('[data-dsh-bg="image"]')
assert.match(face.style.backgroundImage, /data:image\/png/, 'image applied')
assert.equal(face.style.backgroundSize, 'contain', 'size mode applied')
console.log('ok   zip 里的 bundle 可物化、可应用（背景层 + 大小模式生效）')

console.log(`ok   测试文件也在包内：${existsSync(join(stage, 'dev-tools', 'test', 'run-tests.mjs'))}`)
console.log(`ok   LICENSE / README：${existsSync(join(stage, 'LICENSE'))} / ${existsSync(join(stage, 'README.md'))}`)
rmSync(stage, { recursive: true, force: true })
console.log('\nupload-zip verification passed')
