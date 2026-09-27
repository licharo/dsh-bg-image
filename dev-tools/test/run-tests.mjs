/**
 * dsh-bg-image —— 离线测试（Node + jsdom，不依赖浏览器）
 *
 * 做法：把 lib/client.js 这个「手写 bundle」加载进一个页面环境，给它最小的
 * window.__ModuleLoader__ 假实现，物化 factory 拿到 exports，然后用 exports.__test
 * 暴露的纯函数校验状态矫正/样式推导，再用真实 DOM（jsdom）验证 apply() 的注入行为。
 *
 * 运行：
 *   <DSH bundled node> dev-tools/test/run-tests.mjs
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'
import vm from 'node:vm'
import assert from 'node:assert/strict'

const here = dirname(fileURLToPath(import.meta.url))
const pluginRoot = join(here, '..', '..')
const clientPath = join(pluginRoot, 'lib', 'client.js')
const source = readFileSync(clientPath, 'utf8')

let passed = 0
const failures = []
function test(name, fn) {
  try {
    fn()
    passed += 1
    console.log(`  ok  ${name}`)
  } catch (error) {
    failures.push({ name, error })
    console.log(`FAIL  ${name}\n      ${error && error.message}`)
  }
}

/** 在 vm 中物化 bundle（无 DOM 环境），返回 exports。 */
function loadBundle(requireImpl) {
  const registered = []
  const sandbox = { console, setTimeout, clearTimeout }
  sandbox.window = sandbox
  sandbox.globalThis = sandbox
  sandbox.__ModuleLoader__ = { load: (registration) => registered.push(registration) }
  const context = vm.createContext(sandbox)
  vm.runInContext(source, context, { filename: 'client.js' })
  assert.equal(registered.length, 1, 'bundle must register exactly one factory')
  const registration = registered[0]
  assert.equal(registration.id, 'dsh-bg-image', 'registration id')
  const exports = registration.factory(requireImpl || function require() {
    throw new Error('this bundle must not require() anything')
  })
  assert.equal(typeof exports.apply, 'function', 'bundle must export apply()')
  return { exports, sandbox }
}

// ---------------------------------------------------------------- 核心逻辑

const { exports: bundleExports } = loadBundle()

test('bundle id and factory contract', () => {
  assert.equal(bundleExports.name, 'dsh-bg-image')
  assert.equal(typeof bundleExports.apply, 'function')
  assert.equal(typeof bundleExports.__test, 'object')
})

test('normalizeState fills every default', () => {
  const state = bundleExports.__test.normalizeState({})
  assert.equal(state.version, 1)
  assert.equal(state.enabled, true)
  assert.equal(state.dataUrl, '')
  assert.equal(state.opacity, 0.85)
  assert.equal(state.mode, 'cover')
  assert.equal(state.align, 'center')
  assert.equal(state.offsetX, 0)
  assert.equal(state.glass, 0)
  assert.equal(state.panelX, null)
})

test('normalizeState rejects unusable image sources', () => {
  const t = bundleExports.__test
  assert.equal(t.normalizeState({ dataUrl: 'javascript:alert(1)' }).dataUrl, '')
  assert.equal(t.normalizeState({ dataUrl: 'C:\\pics\\a.png' }).dataUrl, '')
  assert.equal(t.normalizeState({ dataUrl: 'data:image/png;base64,AAA' }).dataUrl, 'data:image/png;base64,AAA')
  assert.equal(t.normalizeState({ dataUrl: 'https://x.test/a.jpg' }).dataUrl, 'https://x.test/a.jpg')
})

test('normalizeState clamps numeric ranges', () => {
  const t = bundleExports.__test
  assert.equal(t.normalizeState({ opacity: 5 }).opacity, 1)
  assert.equal(t.normalizeState({ opacity: -3 }).opacity, 0)
  assert.equal(t.normalizeState({ blur: 999 }).blur, 40)
  assert.equal(t.normalizeState({ widthPct: 0 }).widthPct, 1)
  assert.equal(t.normalizeState({ heightPct: 9999 }).heightPct, 500)
  assert.equal(t.normalizeState({ offsetX: 1e9 }).offsetX, 4000)
  assert.equal(t.normalizeState({ brightness: 0 }).brightness, 0.2)
  assert.equal(t.normalizeState({ opacity: 'NaN' }).opacity, 0.85)
})

test('normalizeState filters enum fields', () => {
  const t = bundleExports.__test
  assert.equal(t.normalizeState({ mode: 'nope' }).mode, 'cover')
  assert.equal(t.normalizeState({ align: 'middle' }).align, 'center')
  assert.equal(t.normalizeState({ repeat: 'repeat-z' }).repeat, 'repeat')
  assert.equal(t.normalizeState({ scrimColor: 'red' }).scrimColor, '#000000')
  assert.equal(t.normalizeState({ scrimColor: '#ABC' }).scrimColor, '#abc')
})

test('normalizeState tolerates junk input', () => {
  const t = bundleExports.__test
  assert.equal(t.normalizeState(null).opacity, 0.85)
  assert.equal(t.normalizeState('garbage').mode, 'cover')
  assert.equal(t.normalizeState(42).enabled, true)
})

test('alignToPosition maps all nine anchors', () => {
  const f = bundleExports.__test.alignToPosition
  assert.equal(f('top left'), '0% 0%')
  assert.equal(f('top center'), '50% 0%')
  assert.equal(f('top right'), '100% 0%')
  assert.equal(f('center left'), '0% 50%')
  assert.equal(f('center'), '50% 50%')
  assert.equal(f('center right'), '100% 50%')
  assert.equal(f('bottom left'), '0% 100%')
  assert.equal(f('bottom center'), '50% 100%')
  assert.equal(f('bottom right'), '100% 100%')
})

test('sizeFor covers every mode', () => {
  const f = bundleExports.__test.sizeFor
  assert.equal(f('cover', 100, 100), 'cover')
  assert.equal(f('contain', 100, 100), 'contain')
  assert.equal(f('fill', 100, 100), '100% 100%')
  assert.equal(f('custom', 40, 70), '40% 70%')
  assert.equal(f('tile', 100, 100), 'auto auto')
})

test('buildLayerStyle carries size/position/opacity/offset', () => {
  const t = bundleExports.__test
  const state = t.normalizeState({
    dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
    mode: 'custom',
    widthPct: 55,
    heightPct: 33,
    align: 'bottom right',
    offsetX: -20,
    offsetY: 15,
    opacity: 0.4
  })
  const style = t.buildLayerStyle(state, true)
  assert.equal(style.backgroundSize, '55% 33%')
  assert.equal(style.backgroundPosition, '100% 100%')
  assert.equal(style.transform, 'translate(-20px, 15px)')
  assert.equal(style.opacity, '0.4')
  assert.equal(style.pointerEvents, 'none')
  assert.equal(style.zIndex, '0')
  assert.match(style.backgroundImage, /^url\("data:image\/png/)
})

test('buildLayerStyle hides the layer without an image', () => {
  const t = bundleExports.__test
  const style = t.buildLayerStyle(t.normalizeState({ opacity: 1 }), false)
  assert.equal(style.backgroundImage, 'none')
  assert.equal(style.opacity, '0')
})

test('buildFilter combines blur and brightness', () => {
  const t = bundleExports.__test
  assert.equal(t.buildFilter(t.normalizeState({})), 'none')
  assert.equal(t.buildFilter(t.normalizeState({ blur: 6 })), 'blur(6px)')
  assert.equal(t.buildFilter(t.normalizeState({ blur: 6, brightness: 0.5 })), 'blur(6px) brightness(0.5)')
})

test('hexToRgba handles #rgb and #rrggbb', () => {
  const t = bundleExports.__test
  assert.equal(t.hexToRgba('#000000', 0.5), 'rgba(0, 0, 0, 0.5)')
  assert.equal(t.hexToRgba('#fff', 1), 'rgba(255, 255, 255, 1)')
  assert.equal(t.hexToRgba('#123456', 0.25), 'rgba(18, 52, 86, 0.25)')
})

test('parseColor reads rgb/rgba/hex and rejects junk', () => {
  const t = bundleExports.__test
  // 注意：vm 沙箱里的数组原型与测试进程不同，因此按值比较而不是 deepStrictEqual。
  const plain = (value) => (value === null ? null : Array.from(value))
  assert.deepStrictEqual(plain(t.parseColor('rgb(1, 2, 3)')), [1, 2, 3, 1])
  assert.deepStrictEqual(plain(t.parseColor('rgba(1, 2, 3, 0.4)')), [1, 2, 3, 0.4])
  assert.deepStrictEqual(plain(t.parseColor('rgba(4, 5, 6)')), [4, 5, 6, 1])
  assert.deepStrictEqual(plain(t.parseColor('#ffffff')), [255, 255, 255, 1])
  assert.equal(t.parseColor('transparent'), null)
})

// ---------------------------------------------------------------- DOM 行为

const { JSDOM } = await import(pathToFileURL(join(pluginRoot, 'dev-tools', 'node_modules', 'jsdom', 'lib', 'api.js')).href)

/** 起一个 jsdom 页面，注入 bundle 并 apply，返回测试句柄。 */
function bootDom(options = {}) {
  const dom = new JSDOM(
    options.html ||
      '<!doctype html><html><head></head><body style="background:#ffffff"><div id="root" style="background-color: rgb(255, 255, 255)"><main><div id="surface" style="background-color: rgb(255, 255, 255)">chat</div></main></div></body></html>',
    { url: 'http://127.0.0.1:19387/', pretendToBeVisual: true, runScripts: 'outside-only' }
  )
  const { window } = dom
  if (options.seed) window.localStorage.setItem('dsh.bgImage.v1', options.seed)

  const registered = []
  // 真实页面里 __ModuleLoader__ 是全局的；jsdom 下直接挂在 window 上再进同一 VM 上下文。
  window.__ModuleLoader__ = { load: (registration) => registered.push(registration) }
  const context = dom.getInternalVMContext()
  vm.runInContext(source, context, { filename: 'client.js' })
  // 平台 seed 表：bundle 里 require('react') 走的就是它（测试时用 dev-tools 里的 React）。
  const requireImpl = options.require || function (specifier) {
    throw new Error('unexpected require: ' + specifier)
  }
  const exports = registered[0].factory(requireImpl)
  exports.apply(options.ctx || {})
  return { dom, window, document: window.document, exports }
}

/** 造一个最小的宿主 ctx：能回答 react/slots/layout 三个服务。 */
function makeHostContext(window, options = {}) {
  const registrations = []
  const slots = options.slots || {
    inject(_name, factory) { return factory() },
    register(registration, Component) {
      registrations.push({ registration, Component })
      return { dispose() {} }
    }
  }
  // cordis 规则：没 inject 过的服务连读属性都会抛错，这里照实模拟。
  const base = {
    effect(factory) { return factory() },
    inject(_names, callback, _label) { return callback(ctx) },
    get(name) {
      if (name === 'react') return options.react || null
      if (name === 'slots') return slots
      if (name === 'layout') return options.layout || null
      return null
    }
  }
  const ctx = Object.create(base)
  Object.defineProperties(ctx, {
    slots: {
      configurable: true,
      get() {
        if (options.injectedSlots !== true) throw new Error('cannot get property "slots" without inject')
        return slots
      }
    },
    react: {
      configurable: true,
      get() {
        if (options.injectedReact !== true) return undefined
        return options.react || null
      }
    }
  })
  return { registrations, ctx, slots }
}

test('apply injects layer, faces and style (no main-UI button by default)', () => {
  const { window, document } = bootDom()
  assert.ok(document.getElementById('dshbg-style'), 'style tag')
  const layer = document.getElementById('dshbg-layer')
  assert.ok(layer, 'layer')
  assert.ok(layer.querySelector('[data-dsh-bg="scrim"]'), 'scrim face')
  assert.ok(layer.querySelector('[data-dsh-bg="image"]'), 'image face')
  // 按需求：默认不占主界面 —— 浮动按钮默认不渲染。
  assert.equal(document.getElementById('dshbg-toggle'), null, 'floating button hidden by default')
  assert.equal(window.__dshBg.state.showFloatingButton, false)
  // 层级/点击穿透由样式表类规则给出（.dshbg-layer / .dshbg-face），图面本身是内联样式。
  const css = document.getElementById('dshbg-style').textContent
  assert.match(css, /\.dshbg-layer\{[^}]*pointer-events:none/)
  assert.match(css, /\.dshbg-layer\{[^}]*z-index:0/)
  assert.equal(layer.className, 'dshbg-layer')
  const face = document.querySelector('[data-dsh-bg="image"]')
  assert.equal(face.style.pointerEvents, 'none')
  assert.equal(face.style.zIndex, '0')
  assert.ok(window.__dshBg, 'debug handle')
  assert.ok(window.__dshBg.state)
  assert.equal(typeof window.__dshBg.openSettings, 'function')
})

test('floating button appears only when explicitly enabled', () => {
  const { window, document } = bootDom()
  window.__dshBg.set({ showFloatingButton: true })
  assert.ok(document.getElementById('dshbg-toggle'), 'button shown')
  window.__dshBg.set({ showFloatingButton: false })
  assert.equal(document.getElementById('dshbg-toggle'), null, 'button removed again')
})

test('settings slots register the React config form (plugins.bundle.config + settings.section)', async () => {
  const React = (await import('react')).default
  const host = makeHostContext(null, { react: React, injectedSlots: true })
  bootDom({ ctx: host.ctx, require: (specifier) => (specifier === 'react' ? React : null) })

  const names = host.registrations.map((entry) => entry.registration.name)
  assert.deepStrictEqual(names.sort(), ['plugins.bundle.config', 'settings.section'])
  const bundleConfig = host.registrations.find((entry) => entry.registration.name === 'plugins.bundle.config')
  assert.equal(bundleConfig.registration.key, 'dsh-bg-image', 'bundle config key must be the package name')
  assert.equal(typeof bundleConfig.Component, 'function')
  const section = host.registrations.find((entry) => entry.registration.name === 'settings.section')
  assert.equal(section.registration.id, 'bg-image')
  assert.equal(section.registration.label(), '背景图')
})

test('config form renders every control and drives state', async () => {
  const React = (await import('react')).default
  const host = makeHostContext(null, { react: React, injectedSlots: true })
  const { window } = bootDom({ ctx: host.ctx, require: (specifier) => (specifier === 'react' ? React : null) })
  const registrations = host.registrations

  // react-dom 需要浏览器全局（jsdom 之外没有 window/document），这里临时挂上再卸载。
  const saved = { window: globalThis.window, document: globalThis.document }
  globalThis.window = window
  globalThis.document = window.document
  // Node 24 的 globalThis.navigator 只有 getter，用 defineProperty 临时覆盖。
  const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
  Object.defineProperty(globalThis, 'navigator', { value: window.navigator, configurable: true, writable: true })
  const { createRoot } = await import('react-dom/client')
  // React 18.3 起 act 从 react 包导出；同时声明这是 act 环境以消掉告警。
  const act = React.act || (await import('react-dom/test-utils')).act
  globalThis.IS_REACT_ACT_ENVIRONMENT = true

  try {
    const Component = registrations.find((entry) => entry.registration.name === 'plugins.bundle.config').Component
    const container = window.document.createElement('div')
    window.document.body.appendChild(container)
    const root = createRoot(container)
    await act(async () => {
      root.render(React.createElement(Component, {}))
    })

    const form = container.querySelector('[data-dsh-bg="settings-form"]')
    assert.ok(form, 'form rendered')
    assert.ok(container.querySelector('[data-dsh-bg="settings-preview"]'), 'preview')
    assert.ok(container.querySelector('[data-dsh-bg="settings-file"]'), 'file input')
    const sliders = [...container.querySelectorAll('input[type=range]')].map((node) => node.id)
    assert.deepStrictEqual(sliders, ['dshbg-opacity', 'dshbg-blur', 'dshbg-brightness', 'dshbg-scrim', 'dshbg-glass'])
    const texts = container.textContent
    for (const label of ['图片', '图片透明度', '大小', '位置', '高级', '界面半透明', '常驻悬浮按钮']) {
      assert.ok(texts.includes(label), `form shows「${label}」`)
    }
    const modeButtons = [...container.querySelectorAll('.dshbg-set-btn')].map((node) => node.textContent)
    for (const label of ['覆盖 cover', '包含 contain', '拉伸 fill', '自定义 %', '平铺']) {
      assert.ok(modeButtons.includes(label), `mode button ${label}`)
    }
    for (const label of ['左上', '居中', '右下']) assert.ok(modeButtons.includes(label), `anchor ${label}`)

    // 拖动透明度滑杆 → 状态与背景层同步（用原生 setter 赋值，React 才会认出这次变更）
    const opacity = container.querySelector('#dshbg-opacity')
    const nativeValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    await act(async () => {
      nativeValueSetter.call(opacity, '0.35')
      opacity.dispatchEvent(new window.Event('input', { bubbles: true }))
    })
    assert.equal(window.__dshBg.state.opacity, 0.35)
    // 没有图片时图面保持透明；有图片后跟随透明度
    assert.equal(window.document.querySelector('[data-dsh-bg="image"]').style.opacity, '0')
    await act(async () => {
      window.__dshBg.set({ dataUrl: 'data:image/png;base64,iVBORw0KGgo=' })
    })
    assert.equal(window.document.querySelector('[data-dsh-bg="image"]').style.opacity, '0.35')

    await act(async () => {
      root.unmount()
    })
  } finally {
    if (saved.window === undefined) delete globalThis.window
    else globalThis.window = saved.window
    if (saved.document === undefined) delete globalThis.document
    else globalThis.document = saved.document
    if (navigatorDescriptor) Object.defineProperty(globalThis, 'navigator', navigatorDescriptor)
    delete globalThis.IS_REACT_ACT_ENVIRONMENT
  }
})

test('set() renders image url, opacity and geometry', () => {
  const { window, document } = bootDom()
  window.__dshBg.set({
    dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
    opacity: 0.3,
    mode: 'custom',
    widthPct: 20,
    heightPct: 30,
    align: 'top left',
    offsetX: 11,
    offsetY: -9
  })
  const face = document.querySelector('[data-dsh-bg="image"]')
  assert.match(face.style.backgroundImage, /data:image\/png;base64,iVBORw0KGgo=/)
  assert.equal(face.style.opacity, '0.3')
  assert.equal(face.style.backgroundSize, '20% 30%')
  assert.equal(face.style.backgroundPosition, '0% 0%')
  assert.equal(face.style.transform, 'translate(11px, -9px)')
})

test('state persists to localStorage and reloads on next boot', () => {
  const first = bootDom()
  first.window.__dshBg.set({ dataUrl: 'https://example.test/wall.jpg', opacity: 0.42, mode: 'tile', repeat: 'repeat-x' })
  const stored = first.window.localStorage.getItem('dsh.bgImage.v1')
  assert.ok(stored, 'state written')
  const second = bootDom({ seed: stored })
  const state = second.window.__dshBg.state
  assert.equal(state.dataUrl, 'https://example.test/wall.jpg')
  assert.equal(state.opacity, 0.42)
  assert.equal(state.mode, 'tile')
  assert.equal(state.repeat, 'repeat-x')
  assert.equal(second.document.querySelector('[data-dsh-bg="image"]').style.backgroundRepeat, 'repeat-x')
})

test('broken stored JSON falls back to defaults instead of throwing', () => {
  const { window } = bootDom({ seed: '{"opacity":' })
  assert.equal(window.__dshBg.state.opacity, 0.85)
})

test('optional floating button opens and closes the panel', () => {
  const { window, document } = bootDom()
  window.__dshBg.set({ showFloatingButton: true })
  const btn = document.getElementById('dshbg-toggle')
  assert.ok(btn, 'floating button present once enabled')
  btn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  const panel = document.getElementById('dshbg-panel')
  assert.ok(panel, 'panel opened')
  assert.equal(window.__dshBg.state.panelOpen, true)
  panel.querySelector('.dshbg-close').dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  assert.equal(document.getElementById('dshbg-panel'), null, 'panel closed')
  assert.equal(window.__dshBg.state.panelOpen, false)
})

test('panel exposes controls for image, size, position and opacity', () => {
  const { window, document } = bootDom()
  window.__dshBg.open()
  const panel = document.getElementById('dshbg-panel')
  const sliders = [...panel.querySelectorAll('[data-dsh-bg="slider"]')].map((node) => node.dataset.field)
  assert.ok(sliders.includes('opacity'), 'opacity slider')
  assert.ok(sliders.includes('blur'), 'blur slider')
  assert.ok(sliders.includes('brightness'), 'brightness slider')
  assert.ok(sliders.includes('scrimAlpha'), 'scrim slider')
  assert.ok(sliders.includes('glass'), 'glass slider')
  const modes = [...panel.querySelectorAll('[data-dsh-bg="mode"]')].map((node) => node.dataset.value)
  assert.deepStrictEqual(modes, ['cover', 'contain', 'fill', 'custom', 'tile'])
  const anchors = [...panel.querySelectorAll('[data-dsh-bg="choice"][data-field="align"]')].length
  assert.equal(anchors, 9, 'nine anchors')
  const numbers = [...panel.querySelectorAll('[data-dsh-bg="number"]')].map((node) => node.dataset.field)
  assert.deepStrictEqual(numbers, ['widthPct', 'heightPct', 'offsetX', 'offsetY'])
  assert.ok(document.querySelector('[data-dsh-bg="file"]'), 'hidden file input exists')
})

test('mode buttons switch size and reveal custom fields', () => {
  const { window, document } = bootDom()
  window.__dshBg.open()
  const panel = document.getElementById('dshbg-panel')
  const customBtn = panel.querySelector('[data-dsh-bg="mode"][data-value="custom"]')
  customBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  assert.equal(window.__dshBg.state.mode, 'custom')
  assert.equal(customBtn.dataset.active, 'true')
  assert.equal(panel.querySelector('[data-dsh-bg="customBox"]').style.display, 'block')
  const tileBtn = panel.querySelector('[data-dsh-bg="mode"][data-value="tile"]')
  tileBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  assert.equal(panel.querySelector('[data-dsh-bg="tileBox"]').style.display, 'block')
})

test('opacity slider drives the image face live', () => {
  const { window, document } = bootDom()
  window.__dshBg.set({ dataUrl: 'data:image/png;base64,iVBORw0KGgo=' })
  window.__dshBg.open()
  const panel = document.getElementById('dshbg-panel')
  const slider = panel.querySelector('[data-dsh-bg="slider"][data-field="opacity"]')
  slider.value = '0.25'
  slider.dispatchEvent(new window.Event('input', { bubbles: true }))
  assert.equal(window.__dshBg.state.opacity, 0.25)
  assert.equal(document.querySelector('[data-dsh-bg="image"]').style.opacity, '0.25')
  const label = panel.querySelector('[data-dsh-bg="value"][data-field="opacity"]')
  assert.equal(label.textContent, '25%')
})

test('anchor buttons re-position the image', () => {
  const { window, document } = bootDom()
  window.__dshBg.set({ dataUrl: 'data:image/png;base64,iVBORw0KGgo=' })
  window.__dshBg.open()
  const panel = document.getElementById('dshbg-panel')
  const bottomRight = panel.querySelector('[data-dsh-bg="choice"][data-value="bottom right"]')
  bottomRight.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  assert.equal(window.__dshBg.state.align, 'bottom right')
  assert.equal(document.querySelector('[data-dsh-bg="image"]').style.backgroundPosition, '100% 100%')
})

test('clear button removes the image', () => {
  const { window, document } = bootDom()
  window.__dshBg.set({ dataUrl: 'data:image/png;base64,iVBORw0KGgo=' })
  window.__dshBg.open()
  const panel = document.getElementById('dshbg-panel')
  const clear = [...panel.querySelectorAll('button')].find((button) => button.textContent === '清空图片')
  assert.ok(clear, 'clear button exists')
  clear.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  assert.equal(window.__dshBg.state.dataUrl, '')
  assert.equal(document.querySelector('[data-dsh-bg="image"]').style.opacity, '0')
})

test('reset restores every default', () => {
  const { window, document } = bootDom()
  window.__dshBg.set({ dataUrl: 'data:image/png;base64,iVBORw0KGgo=', opacity: 0.1, mode: 'fill', align: 'top left', glass: 0.5 })
  window.__dshBg.open()
  const panel = document.getElementById('dshbg-panel')
  const reset = [...panel.querySelectorAll('button')].find((button) => button.textContent === '恢复默认')
  reset.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  const state = window.__dshBg.state
  assert.equal(state.dataUrl, '')
  assert.equal(state.opacity, 0.85)
  assert.equal(state.mode, 'cover')
  assert.equal(state.align, 'center')
  assert.equal(state.glass, 0)
  assert.equal(document.querySelector('[data-dsh-bg="image"]').style.opacity, '0')
})

test('Ctrl+Shift+B toggles the panel and Escape closes it', () => {
  const { window, document } = bootDom()
  window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'B', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true }))
  assert.ok(document.getElementById('dshbg-panel'), 'opened by shortcut')
  window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
  assert.equal(document.getElementById('dshbg-panel'), null, 'closed by Escape')
})

test('arrow keys nudge the offset while the panel is open', () => {
  const { window } = bootDom()
  window.__dshBg.open()
  window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }))
  assert.equal(window.__dshBg.state.offsetX, 1)
  window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowDown', shiftKey: true, bubbles: true, cancelable: true }))
  assert.equal(window.__dshBg.state.offsetY, 10)
})

test('glass makes host surfaces translucent and restores them at 0', () => {
  const { window, document } = bootDom()
  window.__dshBg.set({ dataUrl: 'data:image/png;base64,iVBORw0KGgo=', glass: 0.5 })
  // jsdom 不做排版（getBoundingClientRect 全为 0），因此这里验证无条件纳入的
  // body → #root 单链；大面积容器的尺寸阈值由真实浏览器的 browser-check 覆盖。
  const root = document.getElementById('root')
  const rootGlassed = window.getComputedStyle(root).backgroundColor
  assert.match(rootGlassed, /^rgba\(255, 255, 255, 0\.5/, `expected translucent #root, got ${rootGlassed}`)
  window.__dshBg.set({ glass: 0 })
  const rootRestored = window.getComputedStyle(root).backgroundColor
  assert.match(rootRestored, /^rgb\(255, 255, 255\)$/, `expected opaque #root again, got ${rootRestored}`)
})

test('removed nodes are re-injected by the repair observer', async () => {
  const { document } = bootDom()
  document.getElementById('dshbg-layer').remove()
  document.body.appendChild(document.createElement('div'))
  await new Promise((resolve) => setTimeout(resolve, 400))
  assert.ok(document.getElementById('dshbg-layer'), 'layer restored')
})

test('pagehide restores host surfaces (no leak after unload)', () => {
  const { window, document } = bootDom()
  window.__dshBg.set({ dataUrl: 'data:image/png;base64,iVBORw0KGgo=', glass: 0.4 })
  const root = document.getElementById('root')
  assert.match(window.getComputedStyle(root).backgroundColor, /^rgba\(/, 'translucent while active')
  window.dispatchEvent(new window.Event('pagehide'))
  assert.match(window.getComputedStyle(root).backgroundColor, /^rgb\(255, 255, 255\)$/, 'opaque again after unload')
})

// ---------------------------------------------------------------- 汇总

console.log('')
console.log(`passed: ${passed}, failed: ${failures.length}`)
if (failures.length > 0) {
  for (const failure of failures) console.error(`- ${failure.name}: ${failure.error && failure.error.stack}`)
  process.exit(1)
}
