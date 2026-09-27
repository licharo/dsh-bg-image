/**
 * 真实浏览器验证（CDP）：启动 Edge 无头实例，用 DevTools 协议打开测试台，
 * 收集断言结果、控制台错误与截图。
 *
 * 运行：<DSH bundled node> dev-tools/browser-check.mjs
 * 产物：dev-tools/test/out/
 *   report.json          结构化结果（断言、控制台、失败详情）
 *   dom-<preset>.html    页面快照
 *   shot-<preset>.png    截图
 */

import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'

const here = dirname(fileURLToPath(import.meta.url))
const pluginRoot = join(here, '..')
const harness = join(pluginRoot, 'dev-tools', 'test', 'browser-harness.html')
const outDir = join(pluginRoot, 'dev-tools', 'test', 'out')
mkdirSync(outDir, { recursive: true })

const EDGE_CANDIDATES = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
]
const edge = EDGE_CANDIDATES.find((candidate) => existsSync(candidate))
if (!edge) {
  console.error('Microsoft Edge not found')
  process.exit(2)
}

const PORT = 9333 + Math.floor(Math.random() * 300)
const profileDir = join(tmpdir(), `dshbg-cdp-${Date.now()}`)

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** 等 DevTools 端点可用，返回 browser WebSocket 调试地址。 */
async function waitForTargets() {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${PORT}/json/version`)
      if (response.ok) return await response.json()
    } catch (error) {
      /* 还没起来 */
    }
    await sleep(120)
  }
  throw new Error('DevTools endpoint never came up')
}

/** 极简 CDP 客户端（Node 24 自带 WebSocket）。 */
class Cdp {
  constructor(url) {
    this.socket = new WebSocket(url)
    this.nextId = 1
    this.pending = new Map()
    this.listeners = new Map()
  }

  async open() {
    await new Promise((resolve, reject) => {
      this.socket.addEventListener('open', () => resolve(), { once: true })
      this.socket.addEventListener('error', (event) => reject(new Error(`socket error: ${event.message || 'unknown'}`)), { once: true })
    })
    this.socket.addEventListener('message', (event) => {
      const message = JSON.parse(typeof event.data === 'string' ? event.data : event.data.toString())
      if (message.id !== undefined) {
        const entry = this.pending.get(message.id)
        if (!entry) return
        this.pending.delete(message.id)
        if (message.error) entry.reject(new Error(`${message.error.message}`))
        else entry.resolve(message.result)
        return
      }
      const handlers = this.listeners.get(message.method)
      if (handlers) for (const handler of handlers) handler(message.params)
    })
  }

  on(method, handler) {
    if (!this.listeners.has(method)) this.listeners.set(method, [])
    this.listeners.get(method).push(handler)
  }

  send(method, params = {}, sessionId) {
    const id = this.nextId
    this.nextId += 1
    const payload = { id, method, params }
    if (sessionId) payload.sessionId = sessionId
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.socket.send(JSON.stringify(payload))
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id)
          reject(new Error(`CDP timeout: ${method}`))
        }
      }, 30000)
    })
  }

  close() {
    try {
      this.socket.close()
    } catch (error) {
      /* 忽略 */
    }
  }
}

const browser = spawn(edge, [
  '--headless=new',
  '--disable-gpu',
  '--disable-extensions',
  '--no-first-run',
  '--no-default-browser-check',
  '--allow-file-access-from-files',
  '--hide-scrollbars',
  `--user-data-dir=${profileDir}`,
  `--remote-debugging-port=${PORT}`,
  '--window-size=1280,860',
  'about:blank'
], { stdio: 'ignore' })

const report = { presets: [], console: [], pageErrors: [], screenshots: [] }
let exitCode = 0

try {
  const version = await waitForTargets()
  // Chromium 的 DevTools WebSocket 只接受 Host 为 localhost/IP 的连接，这里统一走 localhost。
  const wsUrl = String(version.webSocketDebuggerUrl || `ws://localhost:${PORT}/devtools/browser`).replace('127.0.0.1', 'localhost')
  const cdp = new Cdp(wsUrl)
  await cdp.open()

  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' })
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true })
  await cdp.send('Page.enable', {}, sessionId)
  await cdp.send('Runtime.enable', {}, sessionId)
  await cdp.send('Log.enable', {}, sessionId).catch(() => {})

  cdp.on('Runtime.consoleAPICalled', (params) => {
    const text = (params.args || []).map((arg) => (arg.value !== undefined ? String(arg.value) : arg.description || arg.type)).join(' ')
    report.console.push({ type: params.type, text })
  })
  cdp.on('Runtime.exceptionThrown', (params) => {
    const details = params.exceptionDetails || {}
    report.pageErrors.push(details.exception ? details.exception.description || details.exception.value : details.text)
  })
  cdp.on('Log.entryAdded', (params) => {
    if (params.entry && params.entry.level === 'error') report.console.push({ type: 'log-error', text: `${params.entry.text} ${params.entry.url || ''}` })
  })

  const presets = [
    { name: 'cover', query: '?preset=cover' },
    { name: 'contain', query: '?preset=contain' },
    { name: 'custom', query: '?preset=custom' },
    { name: 'tile', query: '?preset=tile' },
    { name: 'panel', query: '?preset=cover&panel=1' },
    { name: 'clear', query: '?preset=clear' }
  ]

  for (const preset of presets) {
    const url = `${pathToFileURL(harness).href}${preset.query}`
    report.console.length = 0
    report.pageErrors.length = 0
    await cdp.send('Page.navigate', { url }, sessionId)
    // 轮询 __harnessDone，最多 6s
    let done = false
    for (let attempt = 0; attempt < 60 && !done; attempt += 1) {
      await sleep(100)
      try {
        const probe = await cdp.send('Runtime.evaluate', { expression: 'window.__harnessDone === true', returnByValue: true }, sessionId)
        done = probe.result && probe.result.value === true
      } catch (error) {
        /* 导航中，重试 */
      }
    }

    const collected = await cdp.send('Runtime.evaluate', {
      expression: `JSON.stringify({
        results: window.__harness ? window.__harness.results : [],
        state: window.__dshBg ? window.__dshBg.state : null,
        layerStyle: (function () {
          var face = document.querySelector('[data-dsh-bg="image"]');
          if (!face) return null;
          var cs = getComputedStyle(face);
          return { backgroundSize: cs.backgroundSize, backgroundPosition: cs.backgroundPosition, backgroundRepeat: cs.backgroundRepeat, opacity: cs.opacity, filter: cs.filter, transform: cs.transform, hasImage: cs.backgroundImage.indexOf('data:image') !== -1 };
        })(),
        panelOpen: !!document.getElementById('dshbg-panel'),
        hostGlass: (function () {
          var side = document.querySelector('.side');
          return side ? getComputedStyle(side).backgroundColor : null;
        })(),
        errors: window.__harnessErrors || []
      })`,
      returnByValue: true
    }, sessionId)
    const parsed = JSON.parse(collected.result.value)
    const failed = parsed.results.filter((entry) => !entry.pass)
    report.presets.push({ name: preset.name, passed: parsed.results.length - failed.length, failed: failed.length, failures: failed, state: parsed.state, layerStyle: parsed.layerStyle, panelOpen: parsed.panelOpen, hostGlass: parsed.hostGlass, console: [...report.console], pageErrors: [...report.pageErrors] })
    if (failed.length > 0) exitCode = 1

    const dom = await cdp.send('Runtime.evaluate', { expression: 'document.documentElement.outerHTML', returnByValue: true }, sessionId)
    writeFileSync(join(outDir, `dom-${preset.name}.html`), dom.result.value, 'utf8')

    const shot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }, sessionId)
    writeFileSync(join(outDir, `shot-${preset.name}.png`), Buffer.from(shot.data, 'base64'))
    report.screenshots.push(`shot-${preset.name}.png`)
  }

  cdp.close()
} catch (error) {
  report.fatal = String(error && error.stack ? error.stack : error)
  exitCode = 2
} finally {
  browser.kill()
  await sleep(300)
  try {
    rmSync(profileDir, { recursive: true, force: true })
  } catch (error) {
    /* 忽略清理失败 */
  }
}

writeFileSync(join(outDir, 'report.json'), JSON.stringify(report, null, 2), 'utf8')

for (const preset of report.presets) {
  console.log(`[${preset.failed === 0 ? 'PASS' : 'FAIL'}] ${preset.name.padEnd(8)} ${preset.passed} passed, ${preset.failed} failed`)
  for (const failure of preset.failures) console.log(`        - ${failure.name}: ${failure.detail}`)
  if (preset.pageErrors.length) for (const error of preset.pageErrors) console.log(`        ! page error: ${error}`)
  const consoleErrors = preset.console.filter((entry) => entry.type === 'error' || entry.type === 'log-error')
  for (const entry of consoleErrors) console.log(`        ! console: ${entry.text}`)
}
if (report.fatal) console.error(report.fatal)
console.log(`report: ${join(outDir, 'report.json')}`)
process.exit(exitCode)
