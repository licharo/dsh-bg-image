/**
 * 打包产物验证：直接把已安装（由 tarball 解出）的 bundle 放进 jsdom 跑一遍，
 * 证明「全新安装 → 客户端 bundle 可物化、apply 有副作用」这条链路成立。
 *
 * 运行：<DSH bundled node> dev-tools/verify-install.mjs
 */

import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'
import vm from 'node:vm'
import assert from 'node:assert/strict'

const here = dirname(fileURLToPath(import.meta.url))
const pluginRoot = join(here, '..')
const candidates = [
  process.env.DSH_BG_INSTALLED_DIR,
  'C:\\Users\\赵祉豪\\.dsh\\profiles\\desktop\\node_modules\\dsh-bg-image',
  join(pluginRoot, '..', '_scratch_profile', 'profiles', 'zzbgtest', 'node_modules', 'dsh-bg-image')
].filter(Boolean)
const installed = candidates.find((dir) => existsSync(join(dir, 'lib', 'client.js')))
if (!installed) {
  console.error('no installed dsh-bg-image found; tried:\n  ' + candidates.join('\n  '))
  process.exit(2)
}

const { JSDOM } = await import(pathToFileURL(join(pluginRoot, 'dev-tools', 'node_modules', 'jsdom', 'lib', 'api.js')).href)

console.log('installed dir:', installed)

// 1) package.json：dsh.client / dsh.bundle / exports["./client"] 三件套齐备
const manifest = JSON.parse(readFileSync(join(installed, 'package.json'), 'utf8'))
assert.equal(manifest.name, 'dsh-bg-image')
assert.equal(manifest.dsh.client.platform, 'web', 'dsh.client.platform must be web')
assert.equal(manifest.dsh.bundle.patch, './cordis.patch.yml', 'dsh.bundle.patch must point at the patch')
assert.equal(manifest.exports['./client'], './lib/client.js', 'exports["./client"] must point at the bundle')
console.log('ok   package.json declares dsh.client + dsh.bundle + exports["./client"]')

// 2) bundle patch：插入的行 id / name 必须与包名一致
const patch = readFileSync(join(installed, 'cordis.patch.yml'), 'utf8')
assert.match(patch, /id:\s*dsh-bg-image/, 'patch inserts id dsh-bg-image')
assert.match(patch, /name:\s*'dsh-bg-image'/, 'patch inserts name dsh-bg-image')
console.log('ok   cordis.patch.yml inserts row dsh-bg-image')

// 3) client.js：文件存在、路径存在、可直接物化并 apply
const clientPath = join(installed, 'lib', 'client.js')
const source = readFileSync(clientPath, 'utf8')
const dom = new JSDOM(
  '<!doctype html><html><head></head><body style="background:#ffffff"><div id="root" style="background-color: rgb(255,255,255)"><main>chat</main></div></body></html>',
  { url: 'http://127.0.0.1:19387/', pretendToBeVisual: true, runScripts: 'outside-only' }
)
const window = dom.window
const registered = []
window.__ModuleLoader__ = { load: (registration) => registered.push(registration) }
vm.runInContext(source, dom.getInternalVMContext(), { filename: 'client.js' })
assert.equal(registered.length, 1, 'bundle registers exactly one factory')
assert.equal(registered[0].id, 'dsh-bg-image', 'factory id')
const exportsObject = registered[0].factory(() => {
  throw new Error('bundle must not require() anything')
})
assert.equal(typeof exportsObject.apply, 'function', 'bundle exports apply()')
exportsObject.apply({})
assert.ok(window.document.getElementById('dshbg-layer'), 'layer injected into body')
// 按需求：主界面默认没有常驻入口；悬浮按钮只在显式开启后出现。
assert.equal(window.document.getElementById('dshbg-toggle'), null, 'no main-UI button by default')
assert.ok(window.__dshBg && window.__dshBg.state, 'debug handle exposed')
window.__dshBg.set({ dataUrl: 'data:image/png;base64,iVBORw0KGgo=', opacity: 0.5, mode: 'cover' })
const face = window.document.querySelector('[data-dsh-bg="image"]')
assert.match(face.style.backgroundImage, /data:image\/png/, 'image applied')
assert.equal(face.style.opacity, '0.5', 'opacity applied')
window.__dshBg.set({ showFloatingButton: true })
assert.ok(window.document.getElementById('dshbg-toggle'), 'floating button appears when enabled')
console.log('ok   installed lib/client.js materializes, applies and renders')
console.log('\ninstalled-package verification passed')
