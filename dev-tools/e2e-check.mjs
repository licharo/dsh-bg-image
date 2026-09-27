/**
 * 端到端验证（真实 DSH 实例）：
 *   1. 用进程 token 取回 index，解析 window.__DSH_BOOT__ 启动图；
 *   2. 确认 dsh-bg-image 出现在图里，并抓取它真实的 /plugins bundle 响应；
 *   3. 把 bundle 与源码做逐字节比对；
 *   4. 用 Edge + CDP 打开真实页面，确认插件确实注入了背景层并截图。
 *
 * 运行：<DSH bundled node> dev-tools/e2e-check.mjs [--url http://127.0.0.1:47711/?token=...]
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'

const here = dirname(fileURLToPath(import.meta.url))
const pluginRoot = join(here, '..')
const outDir = join(pluginRoot, 'dev-tools', 'test', 'out')
mkdirSync(outDir, { recursive: true })

const argUrl = (() => {
  const index = process.argv.indexOf('--url')
  return index >= 0 ? process.argv[index + 1] : null
})()

/** 从服务器日志里抓 URL（含 token）。 */
function urlFromLog(logPath) {
  const text = readFileSync(logPath, 'utf8')
  const match = /dsh web:\s*(\S+)/.exec(text)
  return match ? match[1] : null
}

const url = argUrl || urlFromLog('D:\\zhuomian\\deepseek\\_e2e_home\\server.log')
if (!url) {
  console.error('no url given and none found in _e2e_home/server.log')
  process.exit(2)
}
console.log('target:', url)

const report = { url, steps: [] }
const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex')

function step(name, ok, detail) {
  report.steps.push({ name, ok: !!ok, detail: detail === undefined ? '' : String(detail) })
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : '\n      ' + detail}`)
  return ok
}

// ---------------------------------------------------------------- 1. index + boot graph

let html = ''
try {
  // 根路径带 token 会 303 + Set-Cookie（进程 token → 持久 cookie），Node fetch 不会自动
  // 跨重定向转发 cookie，所以手动接一次。
  const first = await fetch(url, { redirect: 'manual' })
  const cookie = first.headers.getSetCookie ? first.headers.getSetCookie() : [first.headers.get('set-cookie')].filter(Boolean)
  const status = first.status
  if (status >= 300 && status < 400 && cookie.length) {
    const second = await fetch(url, { redirect: 'follow', headers: { cookie: cookie.map((value) => value.split(';')[0]).join('; ') } })
    html = await second.text()
    step('index 取回成功（token → cookie）', second.ok, `redirect ${status} → status ${second.status}`)
  } else {
    const body = await first.text()
    html = body
    step('index 取回成功', first.ok, `status ${status}`)
  }
} catch (error) {
  step('index 取回成功', false, String(error))
  process.exit(1)
}

// 启动图以 globalThis["__DSH_BOOT__"] = {…} 的形式注入，这里按标记取 JSON 主体。
const bootMatch = /__DSH_BOOT__"\]\s*=\s*(\{[\s\S]*?\})\s*<\/script>/.exec(html) || /__DSH_BOOT__\s*=\s*(\{[\s\S]*?\})\s*<\/script>/.exec(html)
let boot = null
if (bootMatch) {
  try {
    boot = JSON.parse(bootMatch[1])
  } catch (error) {
    boot = null
  }
}
writeFileSync(join(outDir, 'e2e-index.html'), html)
step('解析 window.__DSH_BOOT__', !!boot, bootMatch ? '启动图 JSON 解析失败' : '页面里没有 __DSH_BOOT__')

// 启动图的行信息：inline 脚本里的图（entries）与模块批次的 preload 链接都应包含插件。
const pluginMentionedInHtml = html.includes('dsh-bg-image')
step('index 里出现 dsh-bg-image', pluginMentionedInHtml, '启动图/预加载里没有该包名')

const rows = (boot && boot.entries) || []
const row = rows.find((entry) => entry.id === 'dsh-bg-image')
step('启动图包含 dsh-bg-image 行', !!row, `entries: ${rows.map((entry) => entry.id).join(', ').slice(0, 400)}`)
if (row) {
  report.entry = row
  console.log('     row:', JSON.stringify(row))
}

const batchHits = ((boot && boot.batches) || []).filter((batch) => (batch.entries || []).includes('dsh-bg-image'))
step('dsh-bg-image 被编入某个初始批次', batchHits.length === 1, JSON.stringify(batchHits))
if (batchHits.length) console.log('     batch:', batchHits[0].phase, batchHits[0].url)

// ---------------------------------------------------------------- 2. bundle route

if (row) {
  // entry.url 是文档相对形式（plugins/??...），拼成绝对地址请求。
  const absolute = new URL(row.url, url).href
  const response = await fetch(absolute)
  const body = Buffer.from(await response.arrayBuffer())
  const source = readFileSync(join(pluginRoot, 'lib', 'client.js'))
  // combo 响应 = bundle 原文 + 分隔用 ";" + sourceMappingURL 注释，比对时去掉这两样。
  const normalized = body
    .toString('utf8')
    .replace(/\n?\/\/# sourceMappingURL=[^\n]*\n?$/, '')
    .replace(/\n;\n?$/, '\n')
  const expected = source.toString('utf8')
  step('bundle 路由返回 200', response.ok, `status ${response.status} url ${absolute}`)
  step('bundle 内容与源码一致', normalized === expected, `served ${sha256(Buffer.from(normalized))} vs source ${sha256(source)}`)
  report.bundleUrl = absolute
  writeFileSync(join(outDir, 'served-bundle.js'), body)
}

// ---------------------------------------------------------------- 3. real page + screenshot

const EDGE = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
].find((candidate) => existsSync(candidate))

class Cdp {
  constructor(socketUrl) {
    this.socket = new WebSocket(socketUrl)
    this.nextId = 1
    this.pending = new Map()
    this.listeners = new Map()
  }
  async open() {
    await new Promise((resolve, reject) => {
      this.socket.addEventListener('open', () => resolve(), { once: true })
      this.socket.addEventListener('error', () => reject(new Error('socket error')), { once: true })
    })
    this.socket.addEventListener('message', (event) => {
      const message = JSON.parse(typeof event.data === 'string' ? event.data : event.data.toString())
      if (message.id !== undefined) {
        const entry = this.pending.get(message.id)
        if (!entry) return
        this.pending.delete(message.id)
        if (message.error) entry.reject(new Error(message.error.message))
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
    const id = this.nextId++
    const payload = { id, method, params }
    if (sessionId) payload.sessionId = sessionId
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.socket.send(JSON.stringify(payload))
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id)
          reject(new Error(`CDP timeout ${method}`))
        }
      }, 30000)
    })
  }
  close() {
    try { this.socket.close() } catch (error) { /* 忽略 */ }
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

if (EDGE) {
  const port = 9600 + Math.floor(Math.random() * 300)
  const profile = join(tmpdir(), `dshbg-e2e-${Date.now()}`)
  mkdirSync(profile, { recursive: true })
  const browser = spawn(EDGE, [
    '--headless=new', '--disable-gpu', '--disable-extensions', '--no-first-run',
    '--no-default-browser-check', '--hide-scrollbars',
    `--user-data-dir=${profile}`, `--remote-debugging-port=${port}`,
    '--window-size=1280,860', 'about:blank'
  ], { stdio: 'ignore' })

  let cdp = null
  try {
    let version = null
    for (let attempt = 0; attempt < 120 && !version; attempt += 1) {
      try {
        const response = await fetch(`http://127.0.0.1:${port}/json/version`)
        if (response.ok) version = await response.json()
      } catch (error) { /* 还没起来 */ }
      if (!version) await sleep(120)
    }
    if (!version) throw new Error('DevTools endpoint never came up')
    cdp = new Cdp(String(version.webSocketDebuggerUrl).replace('127.0.0.1', 'localhost'))
    await cdp.open()

    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' })
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true })
    await cdp.send('Page.enable', {}, sessionId)
    await cdp.send('Runtime.enable', {}, sessionId)

    const consoleErrors = []
    const consoleAll = []
    const pageErrors = []
    cdp.on('Runtime.consoleAPICalled', (params) => {
      const text = (params.args || []).map((arg) => (arg.value !== undefined ? String(arg.value) : arg.description || arg.type)).join(' ')
      consoleAll.push({ type: params.type, text })
      if (params.type === 'error' || params.type === 'warning') consoleErrors.push(`${params.type}: ${text}`)
    })
    cdp.on('Runtime.exceptionThrown', (params) => {
      const details = params.exceptionDetails || {}
      pageErrors.push(details.exception ? details.exception.description : details.text)
    })

    // token 走 cookie：根路径会 303 + Set-Cookie，这里直接带 ?token= 访问一次即可
    await cdp.send('Page.navigate', { url }, sessionId)
    for (let attempt = 0; attempt < 80; attempt += 1) {
      await sleep(250)
      const probe = await cdp.send('Runtime.evaluate', { expression: 'document.readyState === "complete"', returnByValue: true }, sessionId)
      if (probe.result && probe.result.value === true) break
    }
    await sleep(1500)

    const state = await cdp.send('Runtime.evaluate', {
      expression: `JSON.stringify({
        title: document.title,
        hasToggle: !!document.getElementById('dshbg-toggle'),
        hasLayer: !!document.getElementById('dshbg-layer'),
        hasStyle: !!document.getElementById('dshbg-style'),
        hasDebugHandle: !!(window.__dshBg && window.__dshBg.state),
        bootHasPlugin: !!((window.__DSH_BOOT__ && window.__DSH_BOOT__.entries) || []).find(function (e) { return e.id === 'dsh-bg-image'; }),
        rootChildren: Array.prototype.map.call(document.body.children, function (c) { return c.id || c.tagName }).join('|')
      })`,
      returnByValue: true
    }, sessionId)
    const page = JSON.parse(state.result.value)
    report.page = page
    console.log('     page:', JSON.stringify(page))

    step('真实页面加载完成', page.title.length > 0, page.title)
    step('页面启动图包含插件行', page.bootHasPlugin, JSON.stringify(page.bootHasPlugin))
    step('插件已注入背景层', page.hasLayer, JSON.stringify(page))
    step('插件已注入样式与调试面', page.hasStyle && page.hasDebugHandle, JSON.stringify(page))
    // 按用户要求：主界面不应出现常驻按钮
    step('主界面没有常驻悬浮按钮', page.hasToggle === false, `hasToggle=${page.hasToggle}`)
    step('无页面异常', pageErrors.length === 0, pageErrors.join(' | '))
    step('无控制台错误', consoleErrors.length === 0, consoleErrors.join(' | '))
    /** 在页面里求值并返回 JSON。 */
    const evaluate = async (expression) => {
      const result = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId)
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || 'evaluate failed')
      return result.result.value
    }
    const settingsDebug = await evaluate(`window.__dshBg && window.__dshBg.settingsDebug ? JSON.stringify(window.__dshBg.settingsDebug()) : 'no-debug'`)
    console.log('     settings debug:', settingsDebug)
    report.settingsDebug = settingsDebug
    report.consoleAll = consoleAll.slice()
    step('设置页已注册（plugins.bundle.config + settings.section）',
      JSON.parse(settingsDebug).bundleConfigRegistered === true && JSON.parse(settingsDebug).settingsSectionRegistered === true,
      settingsDebug)
    const waitFor = async (expression, label, attempts = 60, delay = 250) => {
      for (let attempt = 0; attempt < attempts; attempt += 1) {
        const value = await evaluate(expression)
        if (value) return value
        await sleep(delay)
      }
      throw new Error(`timeout waiting for ${label}`)
    }

    // ---- 走真实 UI：侧栏「插件」→ 插件详情 → 配置页 -------------------------
    // 首次启动会弹「内测声明」，先点「继续」关掉，否则它挡住后面的点击。
    const dismissed = await evaluate(`(function () {
      var nodes = Array.prototype.slice.call(document.querySelectorAll('button'));
      var hit = nodes.filter(function (node) {
        var text = (node.textContent || '').trim();
        return text === '继续' || text === 'Continue';
      })[0];
      if (hit) { hit.click(); return 'dismissed'; }
      return 'no-modal';
    })()`)
    console.log('     beta notice:', dismissed)
    await sleep(500)

    // 侧栏里的入口文案在当前语言下渲染为「插件」，这里按文本点它（找不到再按面板 id 兜底）。
    const openedPlugins = await evaluate(`(function () {
      var nodes = Array.prototype.slice.call(document.querySelectorAll('button, a, [role="button"], li, div'));
      var hit = nodes.filter(function (node) {
        var text = (node.textContent || '').trim();
        return text === '插件' || text === 'Plugins';
      }).pop();
      if (hit) { hit.click(); return 'clicked-text'; }
      return 'no-entry';
    })()`)
    step('侧栏出现「插件」入口', openedPlugins === 'clicked-text', String(openedPlugins))
    await sleep(1200)

    const panelTitle = await evaluate(`document.body.innerText.indexOf('已安装') !== -1 || document.body.innerText.indexOf('Installed') !== -1`)
    step('插件面板已打开', panelTitle === true, `panelTitle=${panelTitle}`)

    // 点开 dsh-bg-image 的详情卡片
    const openedCard = await evaluate(`(function () {
      var nodes = Array.prototype.slice.call(document.querySelectorAll('button, a, [role="button"], div, li'));
      var matches = nodes.filter(function (node) {
        var text = (node.textContent || '').trim();
        return text.indexOf('dsh-bg-image') !== -1 && text.length < 200;
      });
      if (!matches.length) return 'not-found';
      var deepest = matches[matches.length - 1];
      (deepest.closest('button, a, [role="button"]') || deepest).click();
      return 'clicked';
    })()`)
    step('插件列表里找到 dsh-bg-image 卡片', openedCard === 'clicked', String(openedCard))

    // 配置页应当渲染出来（我们的表单根节点带 data-dsh-bg="settings-form"）
    let formVisible = false
    try {
      formVisible = await waitFor(`!!document.querySelector('[data-dsh-bg="settings-form"]')`, 'settings form', 40, 250)
    } catch (error) {
      formVisible = false
    }
    step('插件详情页渲染出背景图配置表单', formVisible === true, `formVisible=${formVisible}`)
    if (!formVisible) {
      const diagnostics = await evaluate(`JSON.stringify({
        href: location.href,
        hasFormRoot: !!document.querySelector('[data-dsh-bg="settings-form"]'),
        dataPluginConfig: document.querySelectorAll('[data-plugin-config]').length,
        textHead: (document.body.innerText || '').slice(0, 500),
        bootEntries: (((window.__DSH_BOOT__ || {}).entries) || []).length
      })`)
      console.log('     diagnostics:', diagnostics)
    }

    if (formVisible) {
      const controls = await evaluate(`(function () {
        var form = document.querySelector('[data-dsh-bg="settings-form"]');
        var text = form.textContent || '';
        return JSON.stringify({
          sliders: Array.prototype.map.call(form.querySelectorAll('input[type=range]'), function (node) { return node.id; }),
          hasPreview: !!form.querySelector('[data-dsh-bg="settings-preview"]'),
          hasFileInput: !!form.querySelector('[data-dsh-bg="settings-file"]'),
          hasImage: text.indexOf('图片') !== -1,
          hasSize: text.indexOf('大小') !== -1,
          hasPosition: text.indexOf('位置') !== -1,
          hasOpacity: text.indexOf('图片透明度') !== -1,
          hasGlass: text.indexOf('界面半透明') !== -1
        });
      })()`)
      const parsedControls = JSON.parse(controls)
      report.settingsControls = parsedControls
      step('配置页含五条滑杆（透明度/模糊/亮度/蒙层/界面半透明）', parsedControls.sliders.length === 5, JSON.stringify(parsedControls.sliders))
      step('配置页含预览与文件选择', parsedControls.hasPreview && parsedControls.hasFileInput, JSON.stringify(parsedControls))
      step('配置页含图片/大小/位置/透明度分组', parsedControls.hasImage && parsedControls.hasSize && parsedControls.hasPosition && parsedControls.hasOpacity && parsedControls.hasGlass, JSON.stringify(parsedControls))

      // 从设置页真的改一次：选择「包含 contain」并设一张图
      const appliedFromSettings = await evaluate(`(function () {
        var form = document.querySelector('[data-dsh-bg="settings-form"]');
        var cover = Array.prototype.filter.call(form.querySelectorAll('button'), function (node) { return node.textContent === '包含 contain'; })[0];
        if (cover) cover.click();
        var canvas = document.createElement('canvas');
        canvas.width = 8; canvas.height = 8;
        var context = canvas.getContext('2d');
        var gradient = context.createLinearGradient(0, 0, 8, 8);
        gradient.addColorStop(0, '#0b3d91'); gradient.addColorStop(1, '#f7b733');
        context.fillStyle = gradient; context.fillRect(0, 0, 8, 8);
        window.__dshBg.set({ dataUrl: canvas.toDataURL('image/png'), opacity: 0.8, glass: 0.4 });
        var face = document.querySelector('[data-dsh-bg="image"]');
        return JSON.stringify({
          mode: window.__dshBg.state.mode,
          backgroundSize: getComputedStyle(face).backgroundSize,
          backgroundImage: getComputedStyle(face).backgroundImage.slice(0, 24),
          glass: getComputedStyle(document.body).backgroundColor
        });
      })()`)
      const applied2 = JSON.parse(appliedFromSettings)
      report.appliedFromSettings = applied2
      step('在设置页切换大小模式生效', applied2.mode === 'contain' && applied2.backgroundSize === 'contain', JSON.stringify(applied2))
      step('通过插件接口设置背景图', applied2.backgroundImage.startsWith('url("data:image/png'), JSON.stringify(applied2))
    }

    await sleep(700)
    // 首次启动还可能弹出「添加一个 API Key」引导，截图前先点「稍后配置」让配置页露出来。
    const dismissedKey = await evaluate(`(function () {
      var nodes = Array.prototype.slice.call(document.querySelectorAll('button'));
      var hit = nodes.filter(function (node) {
        var text = (node.textContent || '').trim();
        return text === '稍后配置' || text === 'Configure later' || text === '稍后';
      })[0];
      if (hit) { hit.click(); return 'dismissed'; }
      return 'no-modal';
    })()`)
    console.log('     api-key notice:', dismissedKey)
    await sleep(600)
    const shot = await cdp.send('Page.captureScreenshot', { format: 'png' }, sessionId)
    writeFileSync(join(outDir, 'e2e-settings-page.png'), Buffer.from(shot.data, 'base64'))
    step('设置页截图已保存', true, 'dev-tools/test/out/e2e-settings-page.png')

    // 关掉插件面板（回到会话）再截一张，证明主界面本身没有常驻入口
    await evaluate(`window.__dshBg && window.__dshBg.openSettings ? null : null`)
    const backToChat = await evaluate(`(function () {
      var nodes = Array.prototype.slice.call(document.querySelectorAll('button, a, [role="button"]'));
      var hit = nodes.filter(function (node) { return (node.textContent || '').trim() === '新会话'; })[0];
      if (hit) { hit.click(); return 'clicked'; }
      return 'not-found';
    })()`)
    if (backToChat === 'clicked') {
      await sleep(900)
      const shot2 = await cdp.send('Page.captureScreenshot', { format: 'png' }, sessionId)
      writeFileSync(join(outDir, 'e2e-conversation.png'), Buffer.from(shot2.data, 'base64'))
      step('会话页截图已保存', true, 'dev-tools/test/out/e2e-conversation.png')
    }
  } catch (error) {
    step('真实页面驱动', false, String(error && error.stack ? error.stack : error))
  } finally {
    if (cdp) cdp.close()
    browser.kill()
    await sleep(300)
    try { rmSync(profile, { recursive: true, force: true }) } catch (error) { /* 忽略 */ }
  }
} else {
  step('找到 Edge 可执行文件', false, '未找到 msedge.exe')
}

writeFileSync(join(outDir, 'e2e-report.json'), JSON.stringify(report, null, 2))
const failed = report.steps.filter((entry) => !entry.ok)
console.log('')
console.log(`e2e: ${report.steps.length - failed.length} passed, ${failed.length} failed`)
console.log(`report: ${join(outDir, 'e2e-report.json')}`)
process.exit(failed.length ? 1 : 0)
