/**
 * dsh-bg-image —— DSH Web / 桌面 GUI 自定义背景图（浏览器半侧）
 *
 * 文件形态说明（重要）：
 *   这是 DSH 客户端模块系统的「手写 bundle」，不是编译产物。
 *   它只在 `window.__ModuleLoader__.load({ id, factory })` 里注册一个 factory，
 *   真正的副作用（注入 DOM、挂样式、注册配置页）全部发生在 factory 被物化时，
 *   也就是 DSH 的 Loader 建立本插件条目并调用导出的 `apply(ctx)` 时。
 *   这与 dsh-raw-html-v2 / dsh-web-frontend 的客户端 bundle 约定一致：
 *   不依赖打包器，改完直接重启/刷新即可生效。
 *
 * 功能（对应需求：自定义图片文件 + 大小 + 位置 + 透明度）：
 *   1. 图片：本地图片文件（选择或拖入）/ 图片 URL / 清空；
 *   2. 大小：覆盖 cover、包含 contain、拉伸 fill、自定义宽高百分比、平铺；
 *   3. 位置：九宫格对齐 + 水平/垂直像素偏移（可拖图微调、方向键微调）；
 *   4. 透明度：图片自身透明度、蒙层（颜色+浓度）、界面半透明（露出壁纸）。
 *
 * 入口（按用户要求：不占主界面）：
 *   - 主入口：侧栏「插件」→ dsh-bg-image 详情页里的配置页
 *     （官方 Slot：plugins.bundle.config，key = 包名）；
 *   - 备用入口：Settings 面板的「背景图」分区（Slot：settings.section），
 *     宿主启用 settings 界面时才会出现；
 *   - 隐藏入口：Ctrl+Shift+B（不渲染任何常驻 UI），控制台 __dshBg.*。
 *   常驻悬浮按钮默认关闭，可在配置页里显式打开（showFloatingButton）。
 *
 * 状态持久化：localStorage['dsh.bgImage.v1']，图片以 data URL 存入。
 * 与宿主完全解耦：不需要 Host 侧服务、不注册 systemPrompt、不改任何 bundle。
 */

'use strict'

window.__ModuleLoader__.load({
  id: 'dsh-bg-image',
  factory: function (require) {
    var module = { exports: {} }
    var exports = module.exports

    /**
     * 解析宿主模块：优先走 Loader 提供的 require（平台 seed 表 / 已注册的 bundle），
     * 失败返回 null —— 绝不让它把插件加载拖垮。
     */
    var hostRequire = typeof require === 'function' ? require : function () { throw new Error('no require') }
    function requireOptional(specifier) {
      try {
        return hostRequire(specifier) || null
      } catch (e) {
        return null
      }
    }

    /** localStorage 键（版本化，便于以后迁移）。 */
    var KEY = 'dsh.bgImage.v1'
    var LAYER_ID = 'dshbg-layer'
    var BTN_ID = 'dshbg-toggle'
    var PANEL_ID = 'dshbg-panel'
    var STYLE_ID = 'dshbg-style'
    var SETTINGS_STYLE_ID = 'dshbg-settings-style'
    /** 官方 Slot：插件配置页（key = 包名）与设置面板分区。 */
    var BUNDLE_CONFIG_SLOT = 'plugins.bundle.config'
    var SETTINGS_SECTION_SLOT = 'settings.section'
    var PLUGINS_PANEL_ID = 'plugins'

    /** 点击「打开背景图设置」时用的面板导航句柄（ctx.layout.selectPanel）。 */
    var layoutHandle = null
    /** 状态订阅者（React 配置页通过它跟随变化）。 */
    var listeners = []
    /** 宿主 UI 框架（react）与 slot 服务上下文，仅在 apply 时填充。 */
    var React = null
    var slotsApi = null
    var registeredBundleConfig = false
    var registeredSettingsSection = false

    /** 面板文案（中文优先；宿主若为英文界面也不影响功能）。 */
    var TEXT = {
      title: '背景图',
      toggle: '背景图（Ctrl+Shift+B）',
      image: '图片',
      choose: '选择图片文件…',
      clear: '清空图片',
      urlPlaceholder: '或粘贴图片 URL / data URL，回车应用',
      apply: '应用 URL',
      none: '当前未设置图片',
      fromFile: '本地文件',
      fromUrl: '图片 URL',
      opacity: '图片透明度',
      size: '大小',
      modeCover: '覆盖 cover',
      modeContain: '包含 contain',
      modeFill: '拉伸 fill',
      modeCustom: '自定义 %',
      modeTile: '平铺',
      width: '宽',
      height: '高',
      tileRepeat: '平铺方式',
      repBoth: '双向',
      repX: '横向',
      repY: '纵向',
      repNone: '不平铺',
      natural: '原始像素',
      position: '位置',
      anchor: '对齐',
      offsetX: '水平偏移',
      offsetY: '垂直偏移',
      alignTopLeft: '左上',
      alignTop: '上中',
      alignTopRight: '右上',
      alignLeft: '左中',
      alignCenter: '居中',
      alignRight: '右中',
      alignBottomLeft: '左下',
      alignBottom: '下中',
      alignBottomRight: '右下',
      advanced: '高级',
      blur: '模糊',
      brightness: '亮度',
      scrim: '蒙层',
      scrimColor: '蒙层颜色',
      scrimAlpha: '蒙层浓度',
      glass: '界面半透明',
      glassHint: '把宿主不透明表面的底色按比例透出壁纸（0 = 关闭）',
      reset: '恢复默认',
      close: '关闭',
      dragHint: '拖标题移动面板，拖图片微调位置，方向键微调（Shift ×10）',
      quota: '图片过大，浏览器存储装不下；请换小图或用图片 URL。',
      loaded: '已应用图片',
      cleared: '已清空图片',
      reset_done: '已恢复默认设置',
      badFile: '请选择图片文件',
      // ---- 设置页（插件配置页 / 设置分区）专用文案
      settingsDesc: '把任意图片设为界面壁纸：可调大小、位置与透明度。设置保存在本浏览器，刷新后自动恢复。',
      settingsHint: '提示：设置面板打开时，可直接在页面上拖动图片微调位置，方向键微调 1px（Shift 为 10px）；随时按 Ctrl+Shift+B 开关设置面板。',
      floatingLabel: '常驻悬浮按钮',
      floatingOn: '显示',
      floatingOff: '隐藏（默认）',
      backToChat: '返回会话'
    }

    /** 默认设置。所有字段都可被 normalizeState 矫正。 */
    var DEFAULTS = {
      version: 1,
      enabled: true,
      dataUrl: '',
      opacity: 0.85,
      blur: 0,
      brightness: 1,
      mode: 'cover',
      widthPct: 100,
      heightPct: 100,
      align: 'center',
      offsetX: 0,
      offsetY: 0,
      repeat: 'repeat',
      scrimColor: '#000000',
      scrimAlpha: 0,
      glass: 0,
      /** 常驻悬浮按钮：默认关闭 —— 入口放在「设置/插件」里，不占主界面。 */
      showFloatingButton: false,
      panelX: null,
      panelY: null,
      panelOpen: false
    }

    var clamp = function (value, min, max) {
      var n = typeof value === 'number' ? value : Number(value)
      if (!isFinite(n)) return min
      if (n < min) return min
      if (n > max) return max
      return n
    }

    var num = function (value, fallback) {
      var n = typeof value === 'number' ? value : Number(value)
      return isFinite(n) ? n : fallback
    }

    var oneOf = function (value, allowed, fallback) {
      return allowed.indexOf(value) === -1 ? fallback : value
    }

    var isDataImage = function (value) {
      return typeof value === 'string' && /^data:image\//i.test(value)
    }

    var isHttpImage = function (value) {
      return typeof value === 'string' && /^https?:\/\//i.test(value)
    }

    var isBlobImage = function (value) {
      return typeof value === 'string' && /^blob:/i.test(value)
    }

    var isUsableImage = function (value) {
      return isDataImage(value) || isHttpImage(value) || isBlobImage(value)
    }

    var isHexColor = function (value) {
      return typeof value === 'string' && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(value.trim())
    }

    /** 把任意（可能是旧版本/被破坏的）持久化值矫正成完整合法状态。 */
    function normalizeState(raw) {
      var src = raw && typeof raw === 'object' ? raw : {}
      var out = {}
      out.version = 1
      out.enabled = src.enabled === false ? false : true
      out.dataUrl = isUsableImage(src.dataUrl) ? src.dataUrl : ''
      out.opacity = clamp(num(src.opacity, DEFAULTS.opacity), 0, 1)
      out.blur = clamp(num(src.blur, DEFAULTS.blur), 0, 40)
      out.brightness = clamp(num(src.brightness, DEFAULTS.brightness), 0.2, 2)
      out.mode = oneOf(src.mode, ['cover', 'contain', 'fill', 'custom', 'tile'], DEFAULTS.mode)
      out.widthPct = clamp(num(src.widthPct, DEFAULTS.widthPct), 1, 500)
      out.heightPct = clamp(num(src.heightPct, DEFAULTS.heightPct), 1, 500)
      out.align = oneOf(
        src.align,
        ['top left', 'top center', 'top right', 'center left', 'center', 'center right', 'bottom left', 'bottom center', 'bottom right'],
        DEFAULTS.align
      )
      out.offsetX = clamp(num(src.offsetX, DEFAULTS.offsetX), -4000, 4000)
      out.offsetY = clamp(num(src.offsetY, DEFAULTS.offsetY), -4000, 4000)
      out.repeat = oneOf(src.repeat, ['repeat', 'repeat-x', 'repeat-y', 'no-repeat'], DEFAULTS.repeat)
      out.scrimColor = isHexColor(src.scrimColor) ? String(src.scrimColor).trim().toLowerCase() : DEFAULTS.scrimColor
      out.scrimAlpha = clamp(num(src.scrimAlpha, DEFAULTS.scrimAlpha), 0, 1)
      out.glass = clamp(num(src.glass, DEFAULTS.glass), 0, 1)
      out.showFloatingButton = src.showFloatingButton === true
      out.panelX = src.panelX === null || src.panelX === undefined ? null : clamp(num(src.panelX, 0), -10000, 10000)
      out.panelY = src.panelY === null || src.panelY === undefined ? null : clamp(num(src.panelY, 0), -10000, 10000)
      out.panelOpen = src.panelOpen === true
      return out
    }

    /** 浅合并 + 矫正（面板改单项时用）。 */
    function mergeState(base, patch) {
      var merged = {}
      var k
      for (k in base) if (Object.prototype.hasOwnProperty.call(base, k)) merged[k] = base[k]
      for (k in patch) if (Object.prototype.hasOwnProperty.call(patch, k)) merged[k] = patch[k]
      return normalizeState(merged)
    }

    /** 对齐 → background-position（支持 'center' 单值与 '<纵向> <横向>' 组合）。 */
    function alignToPosition(align) {
      var parts = String(align).trim().split(/\s+/)
      var first = parts[0] || 'center'
      var second = parts.length > 1 ? parts[1] : null
      var mapX = { left: '0%', center: '50%', right: '100%' }
      var mapY = { top: '0%', center: '50%', bottom: '100%' }
      var x
      var y
      if (second === null) {
        // 单值：'center' 两个方向都居中；'left' / 'right' 视为水平，'top' / 'bottom' 视为垂直。
        if (first === 'center') { x = 'center'; y = 'center' }
        else if (first === 'left' || first === 'right') { x = first; y = 'center' }
        else if (first === 'top' || first === 'bottom') { x = 'center'; y = first }
        else { x = 'center'; y = 'center' }
      } else if (mapY[first] !== undefined && mapX[second] !== undefined) {
        x = second
        y = first
      } else if (mapX[first] !== undefined && mapY[second] !== undefined) {
        x = first
        y = second
      } else {
        x = 'center'
        y = 'center'
      }
      return (mapX[x] || '50%') + ' ' + (mapY[y] || '50%')
    }

    /** 大小 → background-size。 */
    function sizeFor(mode, widthPct, heightPct) {
      if (mode === 'contain') return 'contain'
      if (mode === 'fill') return '100% 100%'
      if (mode === 'tile') return 'auto auto'
      if (mode === 'custom') return widthPct + '% ' + heightPct + '%'
      return 'cover'
    }

    /** 计算背景层样式（纯函数，便于单测）。 */
    function buildLayerStyle(state, hasImage) {
      var style = {
        position: 'fixed',
        left: '0px',
        top: '0px',
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        zIndex: '0',
        backgroundImage: 'none',
        backgroundSize: sizeFor(state.mode, state.widthPct, state.heightPct),
        backgroundPosition: alignToPosition(state.align),
        backgroundRepeat: state.mode === 'tile' ? state.repeat : 'no-repeat',
        backgroundAttachment: 'fixed',
        backgroundOrigin: 'border-box',
        backgroundClip: 'border-box',
        opacity: String(hasImage ? state.opacity : 0),
        filter: buildFilter(state),
        transition: 'opacity 160ms ease-out',
        transform: 'translate(' + state.offsetX + 'px, ' + state.offsetY + 'px)',
        willChange: 'opacity, transform'
      }
      if (hasImage) style.backgroundImage = 'url("' + String(state.dataUrl).replace(/"/g, '%22') + '")'
      return style
    }

    function buildFilter(state) {
      var parts = []
      if (state.blur > 0) parts.push('blur(' + state.blur + 'px)')
      if (state.brightness !== 1) parts.push('brightness(' + state.brightness + ')')
      return parts.length ? parts.join(' ') : 'none'
    }

    /** hex + alpha → rgba()。 */
    function hexToRgba(hex, alpha) {
      var value = isHexColor(hex) ? hex.replace('#', '') : '000000'
      if (value.length === 3) value = value.charAt(0) + value.charAt(0) + value.charAt(1) + value.charAt(1) + value.charAt(2) + value.charAt(2)
      var int = parseInt(value, 16)
      var r = (int >> 16) & 255
      var g = (int >> 8) & 255
      var b = int & 255
      return 'rgba(' + r + ', ' + g + ', ' + b + ', ' + clamp(alpha, 0, 1) + ')'
    }

    // ---------------------------------------------------------------- state

    var state = normalizeState(DEFAULTS)
    var storage = null
    var layer = null
    var scrim = null
    var toggleBtn = null
    var panelEl = null
    var statusEl = null
    var statusTimer = null
    var touched = []            // 界面半透明改动过的元素（用于还原）
    var fileInput = null
    var observer = null

    function readStorage() {
      try {
        var raw = window.localStorage.getItem(KEY)
        return raw ? normalizeState(JSON.parse(raw)) : null
      } catch (e) {
        return null
      }
    }

    function loadState() {
      var stored = readStorage()
      state = stored ? stored : normalizeState(DEFAULTS)
    }

    /** 立即持久化；配额不足时保留内存状态并提示。 */
    function saveState() {
      try {
        window.localStorage.setItem(KEY, JSON.stringify(state))
        return true
      } catch (e) {
        setStatus(TEXT.quota, true)
        return false
      }
    }

    function setState(patch, options) {
      var opts = options || {}
      state = mergeState(state, patch)
      if (opts.persist !== false) saveState()
      if (opts.render !== false) render()
      if (opts.controls !== false) syncControls()
      syncFloatingButton()
      notify()
      return state
    }

    /** 通知订阅者（React 配置页据此重渲染）。 */
    function notify() {
      for (var i = 0; i < listeners.length; i++) {
        try {
          listeners[i](state)
        } catch (e) { /* 单个订阅者出错不影响其它 */ }
      }
    }

    /** 订阅状态变化，返回退订函数。 */
    function subscribe(listener) {
      if (typeof listener !== 'function') return function () {}
      listeners.push(listener)
      return function () {
        var index = listeners.indexOf(listener)
        if (index !== -1) listeners.splice(index, 1)
      }
    }

    // ------------------------------------------------------------- 渲染

    function ensureStyleTag() {
      if (document.getElementById(STYLE_ID)) return
      var style = document.createElement('style')
      style.id = STYLE_ID
      // 宿主 CSS 不认识的私有类名；容器用 all:initial 隔离继承样式。
      style.textContent = [
        '.dshbg-layer{position:fixed;inset:0;pointer-events:none;z-index:0}',
        '.dshbg-face{position:fixed;inset:0;pointer-events:none}',
        '.dshbg-root{all:initial;position:fixed;z-index:2147483000;color:#e8eaed;',
        'font:13px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei",sans-serif}',
        '.dshbg-btn{all:initial;position:fixed;right:14px;bottom:14px;display:flex;align-items:center;gap:6px;',
        'box-sizing:border-box;padding:6px 10px;border-radius:999px;cursor:pointer;opacity:.42;',
        'background:rgba(20,22,26,.86);color:#e8eaed;border:1px solid rgba(255,255,255,.16);',
        'font:12px/1 -apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei",sans-serif;',
        'box-shadow:0 2px 10px rgba(0,0,0,.35);user-select:none;transition:opacity 140ms ease}',
        '.dshbg-btn:hover{opacity:1}',
        '.dshbg-btn[data-on="true"]{border-color:rgba(120,190,255,.7)}',
        '.dshbg-panel{all:initial;position:fixed;z-index:2147483001;width:330px;max-height:82vh;overflow:auto;',
        'box-sizing:border-box;padding:10px 12px 12px;border-radius:12px;',
        'background:rgba(22,24,29,.97);border:1px solid rgba(255,255,255,.16);',
        'box-shadow:0 18px 48px rgba(0,0,0,.55);color:#e8eaed;',
        'font:13px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei",sans-serif}',
        '.dshbg-panel *{box-sizing:border-box}',
        '.dshbg-head{display:flex;align-items:center;justify-content:space-between;gap:8px;',
        'cursor:move;padding-bottom:8px;margin-bottom:8px;border-bottom:1px solid rgba(255,255,255,.12);',
        'font-weight:600}',
        '.dshbg-close{all:initial;cursor:pointer;padding:2px 7px;border-radius:6px;color:#c8ccd4;',
        'font:13px/1 sans-serif}',
        '.dshbg-close:hover{background:rgba(255,255,255,.12);color:#fff}',
        '.dshbg-sec{margin:10px 0 0;padding-top:8px;border-top:1px solid rgba(255,255,255,.08)}',
        '.dshbg-sec:first-of-type{border-top:0;padding-top:0}',
        '.dshbg-sec>h4{margin:0 0 6px;font-size:12px;font-weight:600;color:#9fb0c6;letter-spacing:.04em}',
        '.dshbg-row{display:flex;align-items:center;gap:8px;margin:6px 0}',
        '.dshbg-row>label{flex:0 0 76px;color:#aab4c4;font-size:12px}',
        '.dshbg-row>input[type=range]{flex:1 1 auto;min-width:0;accent-color:#5b9dff}',
        '.dshbg-row>input[type=text],.dshbg-row>input[type=number]{flex:1 1 auto;min-width:0;',
        'background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.16);border-radius:6px;',
        'color:#e8eaed;padding:4px 6px;font:12px/1.4 inherit}',
        '.dshbg-val{flex:0 0 46px;text-align:right;color:#8f9bb0;font-size:12px}',
        '.dshbg-panel button{all:initial;cursor:pointer;padding:5px 9px;border-radius:7px;',
        'background:rgba(255,255,255,.1);color:#e8eaed;border:1px solid rgba(255,255,255,.14);',
        'font:12px/1.3 inherit;text-align:center}',
        '.dshbg-panel button:hover{background:rgba(255,255,255,.18)}',
        '.dshbg-panel button[data-active="true"]{background:rgba(91,157,255,.32);border-color:rgba(91,157,255,.7)}',
        '.dshbg-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:4px;flex:1 1 auto}',
        '.dshbg-modes{display:grid;grid-template-columns:repeat(2,1fr);gap:4px}',
        '.dshbg-btns{display:flex;gap:6px;flex-wrap:wrap}',
        '.dshbg-thumb{width:100%;height:88px;border-radius:8px;border:1px solid rgba(255,255,255,.16);',
        'background-color:rgba(255,255,255,.05);background-size:cover;background-position:center;',
        'display:flex;align-items:center;justify-content:center;color:#7c889a;font-size:12px;',
        'overflow:hidden;text-align:center;padding:4px}',
        '.dshbg-drop{outline:2px dashed rgba(91,157,255,.9);outline-offset:-4px}',
        '.dshbg-status{margin-top:8px;min-height:16px;font-size:12px;color:#8ef0b6}',
        '.dshbg-status[data-err="true"]{color:#ffb4a8}',
        '.dshbg-hint{margin-top:6px;color:#79839a;font-size:11px;line-height:1.5}',
        '.dshbg-inline{display:flex;align-items:center;gap:6px;flex:1 1 auto}',
        '.dshbg-swatch{all:initial;width:34px;height:24px;padding:0;border:1px solid rgba(255,255,255,.2);',
        'border-radius:6px;background:transparent;cursor:pointer}',
        // ---- 设置页（插件配置页 / 设置分区）用的宿主主题样式：统一 dshbg-set- 前缀，
        //      颜色全部走宿主的设计令牌，跟随亮/暗主题，不写死深浅色。
        '.dshbg-set{display:flex;flex-direction:column;gap:16px;color:var(--dsw-alias-label-primary,#0f1115);',
        'font:inherit}',
        '.dshbg-set-sec{display:flex;flex-direction:column;gap:8px}',
        '.dshbg-set-title{margin:0;font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary,#0f1115)}',
        '.dshbg-set-desc{margin:0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-caption,#6b7280)}',
        '.dshbg-set-preview{width:100%;max-width:420px;height:120px;border-radius:10px;',
        'border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.12));',
        'background-color:var(--dsw-alias-bg-layer-2,rgba(0,0,0,.03));background-size:cover;',
        'background-position:center;display:flex;align-items:center;justify-content:center;',
        'color:var(--dsw-alias-label-caption,#6b7280);font-size:12px;overflow:hidden}',
        '.dshbg-set-preview[data-drop="true"]{outline:2px dashed var(--dsw-alias-brand-primary,#4d6bfe);outline-offset:-4px}',
        '.dshbg-set-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}',
        '.dshbg-set-slider{display:grid;grid-template-columns:104px 1fr 52px;align-items:center;gap:10px;',
        'max-width:420px;font-size:12px}',
        '.dshbg-set-slider>label{color:var(--dsw-alias-label-secondary,#4b5563)}',
        '.dshbg-set-slider>output{text-align:right;color:var(--dsw-alias-label-caption,#6b7280);',
        'font-variant-numeric:tabular-nums}',
        '.dshbg-set-slider>input[type=range]{width:100%;margin:0;min-width:0}',
        '.dshbg-set-btn{all:initial;box-sizing:border-box;cursor:pointer;padding:4px 10px;border-radius:8px;',
        'background:var(--dsw-alias-button-tool-bar-fill,rgba(0,0,0,.05));',
        'border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.12));',
        'color:var(--dsw-alias-label-primary,#0f1115);font:12px/18px inherit;text-align:center}',
        '.dshbg-set-btn:hover{background:var(--dsw-alias-button-tool-bar-hover,rgba(0,0,0,.09))}',
        '.dshbg-set-btn[data-active="true"]{border-color:var(--dsw-alias-brand-primary,#4d6bfe);',
        'color:var(--dsw-alias-brand-primary,#4d6bfe)}',
        '.dshbg-set-modes{display:flex;flex-wrap:wrap;gap:6px}',
        '.dshbg-set-grid{display:grid;grid-template-columns:repeat(3,minmax(56px,72px));gap:4px}',
        '.dshbg-set-input{box-sizing:border-box;width:96px;padding:4px 6px;border-radius:8px;',
        'background:var(--dsw-alias-bg-layer-2,rgba(0,0,0,.03));',
        'border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.12));',
        'color:var(--dsw-alias-label-primary,#0f1115);font:12px/18px inherit}',
        '.dshbg-set-input[type=color]{padding:0;width:38px;height:26px;cursor:pointer}',
        '.dshbg-set-status{margin:0;font-size:12px;color:var(--dsw-alias-state-success-primary,#1a7f37)}',
        '.dshbg-set-status[data-err="true"]{color:var(--dsw-alias-state-error-primary,#c0392b)}',
        '.dshbg-set-hint{margin:0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-caption,#6b7280)}',
        '.dshbg-set-link{all:initial;cursor:pointer;color:var(--dsw-alias-link,#4d6bfe);font:12px/18px inherit;',
        'text-decoration:underline}'
      ].join('')
      document.head.appendChild(style)
    }

    function applyStyles(el, styles) {
      var k
      for (k in styles) if (Object.prototype.hasOwnProperty.call(styles, k)) el.style[k] = styles[k]
    }

    /** 创建/复用背景层。 */
    function ensureLayer() {
      if (!document.body) return null
      if (!layer || !layer.isConnected) {
        layer = document.createElement('div')
        layer.id = LAYER_ID
        layer.className = 'dshbg-layer'
        layer.setAttribute('aria-hidden', 'true')
        layer.dataset.dshBg = 'layer'
        scrim = document.createElement('div')
        scrim.className = 'dshbg-face'
        scrim.dataset.dshBg = 'scrim'
        layer.appendChild(scrim)
        document.body.appendChild(layer)
      }
      return layer
    }

    /** 图片层：与 scrim 分开，避免 scrim 参与 transform/滤镜。 */
    var imageFace = null
    function ensureFaces() {
      ensureLayer()
      if (!layer) return null
      if (!imageFace || !imageFace.isConnected) {
        imageFace = document.createElement('div')
        imageFace.className = 'dshbg-face'
        imageFace.dataset.dshBg = 'image'
        layer.insertBefore(imageFace, scrim)
      }
      return imageFace
    }

    function render() {
      ensureStyleTag()
      var face = ensureFaces()
      if (!face) return
      var hasImage = state.enabled && isUsableImage(state.dataUrl)
      applyStyles(face, buildLayerStyle(state, hasImage))
      face.style.opacity = String(hasImage ? state.opacity : 0)
      scrim.style.background = hexToRgba(state.scrimColor, hasImage ? state.scrimAlpha : 0)
      applyGlass(hasImage ? state.glass : 0)
      if (toggleBtn) toggleBtn.dataset.on = hasImage ? 'true' : 'false'
    }

    // --------------------------------------------------- 界面半透明（玻璃）

    /**
     * 把宿主容器的不透明底色按比例透出壁纸。
     * 只处理「本就带非透明 background-color 的元素」，逐元素记忆原值，便于还原；
     * 从会话区向上走到 body，最多 4 层，够覆盖 #root 与主面板容器。
     */
    function applyGlass(alpha) {
      var i
      if (!document.body) return
      if (alpha <= 0) {
        for (i = 0; i < touched.length; i++) {
          var rec = touched[i]
          try {
            if (rec.el.isConnected) {
              if (rec.value === '') rec.el.style.removeProperty('background-color')
              else rec.el.style.setProperty('background-color', rec.value)
            }
          } catch (e) { /* 忽略：元素可能已卸载 */ }
        }
        touched = []
        return
      }
      var targets = glassTargets()
      for (i = 0; i < targets.length; i++) {
        var el = targets[i]
        if (isTouched(el)) continue
        var rgba = readBackgroundColor(el)
        if (!rgba || rgba[3] <= 0.01) continue
        touched.push({ el: el, value: el.style.getPropertyValue('background-color') })
        // 注：不写 !important —— 宿主主题的选择器通常带优先级，普通声明会被它盖住，
        // 反而不会误伤；只有宿主自己用内联样式或嵌套层次更浅时才会生效。
        el.style.setProperty('background-color', 'rgba(' + rgba[0] + ', ' + rgba[1] + ', ' + rgba[2] + ', ' + (rgba[3] * (1 - clamp(alpha, 0, 1))).toFixed(3) + ')')
      }
    }

    /**
     * 读元素当前生效的底色。
     * 优先内联样式（宿主主题通常把底色写在 style 属性/变量里），
     * 拿不到时再问 getComputedStyle —— 这样在宿主 CSS 未就绪的环境里也不至于漏掉。
     */
    function readBackgroundColor(el) {
      var inline = ''
      try {
        inline = el.style && el.style.backgroundColor ? el.style.backgroundColor : ''
      } catch (e) {
        inline = ''
      }
      var fromInline = parseColor(inline)
      if (fromInline) return fromInline
      try {
        return parseColor(window.getComputedStyle(el).backgroundColor)
      } catch (e) {
        return null
      }
    }

    function isTouched(el) {
      for (var i = 0; i < touched.length; i++) if (touched[i].el === el) return true
      return false
    }

    /**
     * 目标链：
     *   1) body 起沿「唯一元素子节点」向里最多 5 层的单链（宿主的主外壳/主面板）；
     *   2) 从 #root 起宽度优先遍历（深度 ≤4、节点 ≤120），只收「至少 160×360 像素
     *      且覆盖视口 ≥15% 宽 / ≥50% 高」的大面板（侧栏、主区、整屏容器）。
     * 只处理本身就带非透明底色的元素，逐个记忆原值可完整还原；尺寸阈值用来避免
     * 把消息气泡、按钮这类正常 UI 也涂成半透明。
     */
    function glassTargets() {
      var out = []
      var body = document.body
      if (!body) return out
      var seen = []
      var push = function (el) {
        if (!el || seen.indexOf(el) !== -1) return
        if (el.id === LAYER_ID) return
        seen.push(el)
        out.push(el)
      }
      push(body)

      // 第一步：先点名宿主最外层容器（DSH 的 #root），保证一定进入链上。
      var root = null
      try {
        root = document.getElementById('root')
      } catch (e) {
        root = null
      }
      if (root) push(root)

      // 第二步：从该容器继续沿「唯一宿主子节点」向里最多 4 层。
      // 只看真实宿主子节点：插件注入的 #dshbg-layer / #dshbg-toggle / #dshbg-panel
      // 不能算进「单链」判断，否则链会在第一步就断掉。
      var node = root || body
      for (var depth = 0; depth < 4; depth++) {
        var hostChildren = []
        var rawChildren = node.children || []
        for (var index = 0; index < rawChildren.length; index++) {
          var candidate = rawChildren[index]
          if (candidate.dataset && candidate.dataset.dshBg) continue
          hostChildren.push(candidate)
        }        if (hostChildren.length !== 1) break // 没有子节点或出现分叉 → 交给浅层遍历
        push(hostChildren[0])
        node = hostChildren[0]
      }

      var viewportWidth = window.innerWidth || 1280
      var viewportHeight = window.innerHeight || 800
      // 面积门槛：既看相对视口的比例，也看绝对像素，避免把窄条控件当成大面板。
      var minWidth = Math.max(160, viewportWidth * 0.15)
      var minHeight = Math.max(360, viewportHeight * 0.5)
      var queue = [{ el: root || body, depth: 0 }]
      var visited = 0
      while (queue.length && visited < 120) {
        var item = queue.shift()
        var el = item.el
        if (!el) continue
        visited += 1
        var rect = null
        try {
          rect = el.getBoundingClientRect ? el.getBoundingClientRect() : null
        } catch (e) {
          rect = null
        }
        if (rect && rect.width >= minWidth && rect.height >= minHeight) push(el)
        if (item.depth >= 4) continue
        var children = el.children || []
        for (var i = 0; i < children.length; i++) queue.push({ el: children[i], depth: item.depth + 1 })
      }
      return out
    }

    /** 'rgb(a)(...)' / '#rrggbb' → [r,g,b,a]，解析失败返回 null。 */
    function parseColor(value) {
      if (typeof value !== 'string') return null
      var text = value.trim().toLowerCase()
      var m = /^rgba?\(([^)]+)\)$/.exec(text)
      if (m) {
        var parts = m[1].split(/[,\s/]+/).filter(function (p) { return p !== '' })
        if (parts.length < 3) return null
        var r = clamp(num(parts[0], 0), 0, 255)
        var g = clamp(num(parts[1], 0), 0, 255)
        var b = clamp(num(parts[2], 0), 0, 255)
        var a = parts.length > 3 ? clamp(num(parts[3], 1), 0, 1) : 1
        return [Math.round(r), Math.round(g), Math.round(b), a]
      }
      if (isHexColor(text)) {
        var hex = text.replace('#', '')
        if (hex.length === 3) hex = hex.charAt(0) + hex.charAt(0) + hex.charAt(1) + hex.charAt(1) + hex.charAt(2) + hex.charAt(2)
        var int = parseInt(hex, 16)
        return [(int >> 16) & 255, (int >> 8) & 255, int & 255, 1]
      }
      return null
    }

    // ---------------------------------------------------------------- 工具

    function el(tag, styles, text) {
      var node = document.createElement(tag)
      if (styles) applyStyles(node, styles)
      if (text !== undefined && text !== null) node.textContent = String(text)
      return node
    }

    function setStatus(message, isError) {
      if (!statusEl) return
      statusEl.textContent = message || ''
      statusEl.dataset.err = isError ? 'true' : 'false'
      if (statusTimer) window.clearTimeout(statusTimer)
      if (message) {
        statusTimer = window.setTimeout(function () {
          if (statusEl) statusEl.textContent = ''
        }, 6000)
      }
    }

    // ---------------------------------------------------------------- 面板

    function isPanelOpen() {
      return !!(panelEl && panelEl.isConnected)
    }

    function openPanel() {
      if (isPanelOpen()) return
      ensureStyleTag()
      ensureFileInput()
      panelEl = buildPanel()
      document.body.appendChild(panelEl)
      placePanel()
      state = mergeState(state, { panelOpen: true })
      saveState()
      syncControls()
    }

    function closePanel() {
      if (panelEl && panelEl.parentNode) panelEl.parentNode.removeChild(panelEl)
      panelEl = null
      state = mergeState(state, { panelOpen: false })
      saveState()
    }

    function togglePanel() {
      if (isPanelOpen()) closePanel()
      else openPanel()
    }

    /** 面板位置：记忆值优先，否则贴着右下角按钮上方。 */
    function placePanel() {
      if (!panelEl) return
      var width = 330
      var height = panelEl.offsetHeight || 420
      var maxX = Math.max(8, window.innerWidth - width - 8)
      var maxY = Math.max(8, window.innerHeight - 80)
      var x = state.panelX === null ? Math.max(8, window.innerWidth - width - 14) : clamp(state.panelX, 8, maxX)
      var y = state.panelY === null ? Math.max(8, window.innerHeight - height - 70) : clamp(state.panelY, 8, maxY)
      panelEl.style.left = x + 'px'
      panelEl.style.top = y + 'px'
      panelEl.style.right = 'auto'
      panelEl.style.bottom = 'auto'
    }

    /** 构造面板（原生 DOM，零 React 依赖）。 */
    function buildPanel() {
      var panel = el('div', null)
      panel.id = PANEL_ID
      panel.className = 'dshbg-panel'
      panel.dataset.dshBg = 'panel'

      var head = el('div', null)
      head.className = 'dshbg-head'
      var headTitle = el('span', null, TEXT.title)
      var closeBtn = el('button', null, '✕')
      closeBtn.className = 'dshbg-close'
      closeBtn.title = TEXT.close
      closeBtn.addEventListener('click', function () { closePanel() })
      head.appendChild(headTitle)
      head.appendChild(closeBtn)
      panel.appendChild(head)
      makeDraggable(panel, head)

      // ---- 图片
      panel.appendChild(section(TEXT.image))
      var thumb = el('div', null, state.dataUrl ? '' : TEXT.none)
      thumb.className = 'dshbg-thumb'
      thumb.dataset.dshBg = 'thumb'
      if (state.dataUrl) {
        thumb.style.backgroundImage = 'url("' + String(state.dataUrl).replace(/"/g, '%22') + '")'
      }
      panel.appendChild(thumb)

      var imageBtns = el('div', null)
      imageBtns.className = 'dshbg-btns'
      imageBtns.style.marginTop = '6px'
      var chooseBtn = el('button', null, TEXT.choose)
      chooseBtn.addEventListener('click', function () { pickFile() })
      var clearBtn = el('button', null, TEXT.clear)
      clearBtn.addEventListener('click', function () {
        setState({ dataUrl: '' }, { controls: false })
        setStatus(TEXT.cleared)
        if (panelEl) refreshThumb()
      })
      imageBtns.appendChild(chooseBtn)
      imageBtns.appendChild(clearBtn)
      panel.appendChild(imageBtns)

      var urlRow = el('div', null)
      urlRow.className = 'dshbg-row'
      var urlInput = document.createElement('input')
      urlInput.type = 'text'
      urlInput.placeholder = TEXT.urlPlaceholder
      urlInput.dataset.dshBg = 'url'
      urlInput.addEventListener('keydown', function (event) {
        if (event.key === 'Enter') {
          event.preventDefault()
          applyUrlInput(urlInput)
        }
      })
      var urlBtn = el('button', null, TEXT.apply)
      urlBtn.addEventListener('click', function () { applyUrlInput(urlInput) })
      urlRow.appendChild(urlInput)
      urlRow.appendChild(urlBtn)
      panel.appendChild(urlRow)

      // ---- 透明度 / 滤镜
      panel.appendChild(section(TEXT.opacity))
      panel.appendChild(sliderRow(TEXT.opacity, 'opacity', 0, 1, 0.01, function (v) { return Math.round(v * 100) + '%' }))
      panel.appendChild(sliderRow(TEXT.blur, 'blur', 0, 40, 1, function (v) { return Math.round(v) + 'px' }))
      panel.appendChild(sliderRow(TEXT.brightness, 'brightness', 0.2, 2, 0.01, function (v) { return Math.round(v * 100) + '%' }))

      // ---- 大小
      panel.appendChild(section(TEXT.size))
      var modes = el('div', null)
      modes.className = 'dshbg-modes'
      var modeDefs = [
        ['cover', TEXT.modeCover],
        ['contain', TEXT.modeContain],
        ['fill', TEXT.modeFill],
        ['custom', TEXT.modeCustom],
        ['tile', TEXT.modeTile]
      ]
      for (var i = 0; i < modeDefs.length; i++) {
        modes.appendChild(modeButton(modeDefs[i][0], modeDefs[i][1]))
      }
      panel.appendChild(modes)

      var customBox = el('div', null)
      customBox.dataset.dshBg = 'customBox'
      customBox.appendChild(numberRow(TEXT.width, 'widthPct', 1, 500))
      customBox.appendChild(numberRow(TEXT.height, 'heightPct', 1, 500))
      panel.appendChild(customBox)

      var tileBox = el('div', null)
      tileBox.dataset.dshBg = 'tileBox'
      var repRow = el('div', null)
      repRow.className = 'dshbg-row'
      repRow.appendChild(el('label', null, TEXT.tileRepeat))
      var repGrid = el('div', null)
      repGrid.className = 'dshbg-grid'
      var repDefs = [['repeat', TEXT.repBoth], ['repeat-x', TEXT.repX], ['repeat-y', TEXT.repY], ['no-repeat', TEXT.repNone]]
      for (var j = 0; j < repDefs.length; j++) repGrid.appendChild(choiceButton('repeat', repDefs[j][0], repDefs[j][1]))
      repRow.appendChild(repGrid)
      tileBox.appendChild(repRow)
      panel.appendChild(tileBox)

      // ---- 位置
      panel.appendChild(section(TEXT.position))
      var posRow = el('div', null)
      posRow.className = 'dshbg-row'
      posRow.appendChild(el('label', null, TEXT.anchor))
      var anchorGrid = el('div', null)
      anchorGrid.className = 'dshbg-grid'
      var anchorDefs = [
        ['top left', TEXT.alignTopLeft], ['top center', TEXT.alignTop], ['top right', TEXT.alignTopRight],
        ['center left', TEXT.alignLeft], ['center', TEXT.alignCenter], ['center right', TEXT.alignRight],
        ['bottom left', TEXT.alignBottomLeft], ['bottom center', TEXT.alignBottom], ['bottom right', TEXT.alignBottomRight]
      ]
      for (var k = 0; k < anchorDefs.length; k++) anchorGrid.appendChild(choiceButton('align', anchorDefs[k][0], anchorDefs[k][1]))
      posRow.appendChild(anchorGrid)
      panel.appendChild(posRow)
      panel.appendChild(numberRow(TEXT.offsetX, 'offsetX', -4000, 4000))
      panel.appendChild(numberRow(TEXT.offsetY, 'offsetY', -4000, 4000))

      // ---- 高级：蒙层 + 界面半透明
      panel.appendChild(section(TEXT.advanced))
      var scrimRow = el('div', null)
      scrimRow.className = 'dshbg-row'
      scrimRow.appendChild(el('label', null, TEXT.scrimColor))
      var colorInput = document.createElement('input')
      colorInput.type = 'color'
      colorInput.className = 'dshbg-swatch'
      colorInput.value = state.scrimColor
      colorInput.dataset.dshBg = 'scrimColor'
      colorInput.addEventListener('input', function () {
        setState({ scrimColor: colorInput.value }, { controls: false })
      })
      scrimRow.appendChild(colorInput)
      panel.appendChild(scrimRow)
      panel.appendChild(sliderRow(TEXT.scrimAlpha, 'scrimAlpha', 0, 1, 0.01, function (v) { return Math.round(v * 100) + '%' }))
      panel.appendChild(sliderRow(TEXT.glass, 'glass', 0, 1, 0.01, function (v) { return Math.round(v * 100) + '%' }))
      var glassHint = el('div', null, TEXT.glassHint)
      glassHint.className = 'dshbg-hint'
      panel.appendChild(glassHint)

      // ---- 底部
      var foot = el('div', null)
      foot.className = 'dshbg-btns'
      foot.style.marginTop = '10px'
      var resetBtn = el('button', null, TEXT.reset)
      resetBtn.addEventListener('click', function () {
        var keepOpen = true
        state = normalizeState(DEFAULTS)
        state.panelOpen = keepOpen
        saveState()
        render()
        syncControls()
        refreshThumb()
        setStatus(TEXT.reset_done)
      })
      foot.appendChild(resetBtn)
      panel.appendChild(foot)

      statusEl = el('div', null, '')
      statusEl.className = 'dshbg-status'
      statusEl.dataset.dshBg = 'status'
      panel.appendChild(statusEl)

      var hint = el('div', null, TEXT.dragHint)
      hint.className = 'dshbg-hint'
      panel.appendChild(hint)

      // 拖放图片文件到面板 = 选图
      panel.addEventListener('dragover', function (event) {
        event.preventDefault()
        panel.classList.add('dshbg-drop')
      })
      panel.addEventListener('dragleave', function () {
        panel.classList.remove('dshbg-drop')
      })
      panel.addEventListener('drop', function (event) {
        event.preventDefault()
        panel.classList.remove('dshbg-drop')
        var files = event.dataTransfer && event.dataTransfer.files
        if (files && files.length) handleFile(files[0])
      })

      return panel
    }

    function section(title) {
      var node = el('div', null)
      node.className = 'dshbg-sec'
      var h = el('h4', null, title)
      node.appendChild(h)
      return node
    }

    function modeButton(mode, label) {
      var btn = el('button', null, label)
      btn.dataset.dshBg = 'mode'
      btn.dataset.value = mode
      btn.addEventListener('click', function () {
        setState({ mode: mode }, { controls: false })
        syncControls()
      })
      return btn
    }

    function choiceButton(field, value, label) {
      var btn = el('button', null, label)
      btn.dataset.dshBg = 'choice'
      btn.dataset.field = field
      btn.dataset.value = value
      btn.addEventListener('click', function () {
        var patch = {}
        patch[field] = value
        setState(patch, { controls: false })
        syncControls()
      })
      return btn
    }

    function sliderRow(label, field, min, max, step, format) {
      var row = el('div', null)
      row.className = 'dshbg-row'
      row.appendChild(el('label', null, label))
      var input = document.createElement('input')
      input.type = 'range'
      input.min = String(min)
      input.max = String(max)
      input.step = String(step)
      input.value = String(state[field])
      input.dataset.dshBg = 'slider'
      input.dataset.field = field
      var valueEl = el('span', null, format(state[field]))
      valueEl.className = 'dshbg-val'
      valueEl.dataset.dshBg = 'value'
      valueEl.dataset.field = field
      input.addEventListener('input', function () {
        var patch = {}
        patch[field] = Number(input.value)
        setState(patch, { controls: false })
        valueEl.textContent = format(Number(input.value))
      })
      row.appendChild(input)
      row.appendChild(valueEl)
      return row
    }

    function numberRow(label, field, min, max) {
      var row = el('div', null)
      row.className = 'dshbg-row'
      row.appendChild(el('label', null, label))
      var input = document.createElement('input')
      input.type = 'number'
      input.min = String(min)
      input.max = String(max)
      input.step = '1'
      input.value = String(state[field])
      input.dataset.dshBg = 'number'
      input.dataset.field = field
      input.addEventListener('input', function () {
        var patch = {}
        patch[field] = Number(input.value)
        setState(patch, { controls: false })
      })
      row.appendChild(input)
      return row
    }

    /** 把 state 回灌到面板控件（模式/对齐/高亮/数值）。 */
    function syncControls() {
      if (!panelEl) return
      var i
      var modes = panelEl.querySelectorAll('[data-dsh-bg="mode"]')
      for (i = 0; i < modes.length; i++) modes[i].dataset.active = modes[i].dataset.value === state.mode ? 'true' : 'false'
      var choices = panelEl.querySelectorAll('[data-dsh-bg="choice"]')
      for (i = 0; i < choices.length; i++) {
        var field = choices[i].dataset.field
        choices[i].dataset.active = String(state[field]) === choices[i].dataset.value ? 'true' : 'false'
      }
      var sliders = panelEl.querySelectorAll('[data-dsh-bg="slider"]')
      for (i = 0; i < sliders.length; i++) {
        var sf = sliders[i].dataset.field
        if (String(state[sf]) !== sliders[i].value) sliders[i].value = String(state[sf])
      }
      var numbers = panelEl.querySelectorAll('[data-dsh-bg="number"]')
      for (i = 0; i < numbers.length; i++) {
        var nf = numbers[i].dataset.field
        if (document.activeElement !== numbers[i] && String(state[nf]) !== numbers[i].value) numbers[i].value = String(state[nf])
      }
      var colorInput = panelEl.querySelector('[data-dsh-bg="scrimColor"]')
      if (colorInput && document.activeElement !== colorInput) colorInput.value = state.scrimColor
      var customBox = panelEl.querySelector('[data-dsh-bg="customBox"]')
      if (customBox) customBox.style.display = state.mode === 'custom' ? 'block' : 'none'
      var tileBox = panelEl.querySelector('[data-dsh-bg="tileBox"]')
      if (tileBox) tileBox.style.display = state.mode === 'tile' ? 'block' : 'none'
      var urlInput = panelEl.querySelector('[data-dsh-bg="url"]')
      if (urlInput && isHttpImage(state.dataUrl) && document.activeElement !== urlInput) urlInput.value = state.dataUrl
      if (toggleBtn) toggleBtn.dataset.on = state.enabled && isUsableImage(state.dataUrl) ? 'true' : 'false'
    }

    function refreshThumb() {
      if (!panelEl) return
      var thumb = panelEl.querySelector('[data-dsh-bg="thumb"]')
      if (!thumb) return
      if (state.dataUrl) {
        thumb.style.backgroundImage = 'url("' + String(state.dataUrl).replace(/"/g, '%22') + '")'
        thumb.textContent = ''
      } else {
        thumb.style.backgroundImage = 'none'
        thumb.textContent = TEXT.none
      }
    }

    function applyUrlInput(input) {
      var value = String(input.value || '').trim()
      if (!value) {
        setState({ dataUrl: '' })
        refreshThumb()
        setStatus(TEXT.cleared)
        return
      }
      if (!isUsableImage(value)) {
        setStatus('URL 需要以 http(s):// 或 data:image/ 开头', true)
        return
      }
      setState({ dataUrl: value })
      refreshThumb()
      setStatus(TEXT.loaded)
    }

    // --------------------------------------------------------- 文件选择

    function ensureFileInput() {
      if (fileInput && fileInput.isConnected) return fileInput
      fileInput = document.createElement('input')
      fileInput.type = 'file'
      fileInput.accept = 'image/*'
      fileInput.style.display = 'none'
      fileInput.dataset.dshBg = 'file'
      fileInput.addEventListener('change', function () {
        var files = fileInput.files
        if (files && files.length) handleFile(files[0])
        fileInput.value = ''
      })
      document.body.appendChild(fileInput)
      return fileInput
    }

    function pickFile() {
      var input = ensureFileInput()
      input.click()
    }

    function handleFile(file) {
      if (!file || !/^image\//i.test(file.type || '')) {
        setStatus(TEXT.badFile, true)
        return
      }
      var reader = new FileReader()
      reader.onload = function () {
        var result = String(reader.result || '')
        if (!isDataImage(result)) {
          setStatus(TEXT.badFile, true)
          return
        }
        var ok = setState({ dataUrl: result }, { controls: false })
        refreshThumb()
        setStatus(ok === false ? TEXT.quota : TEXT.loaded + '（' + file.name + '）', ok === false)
      }
      reader.onerror = function () {
        setStatus('读取图片失败', true)
      }
      reader.readAsDataURL(file)
    }

    // --------------------------------------------------------- 拖拽/微调

    function makeDraggable(panel, handle) {
      var drag = null
      handle.addEventListener('mousedown', function (event) {
        if (event.target && event.target.tagName === 'BUTTON') return
        drag = {
          dx: event.clientX - panel.getBoundingClientRect().left,
          dy: event.clientY - panel.getBoundingClientRect().top
        }
        event.preventDefault()
        document.addEventListener('mousemove', onMove)
        document.addEventListener('mouseup', onUp)
      })
      function onMove(event) {
        if (!drag) return
        var x = clamp(event.clientX - drag.dx, 4, Math.max(4, window.innerWidth - 60))
        var y = clamp(event.clientY - drag.dy, 4, Math.max(4, window.innerHeight - 40))
        panel.style.left = x + 'px'
        panel.style.top = y + 'px'
      }
      function onUp() {
        drag = null
        document.removeEventListener('mousemove', onMove)
        document.removeEventListener('mouseup', onUp)
        if (panelEl) {
          state = mergeState(state, {
            panelX: Math.round(panel.getBoundingClientRect().left),
            panelY: Math.round(panel.getBoundingClientRect().top)
          })
          saveState()
        }
      }
    }

    /** 拖图片微调位置（在背景层画面上按下并拖动）。 */
    function installPictureDrag() {
      var start = null
      document.addEventListener('mousedown', function (event) {
        if (!isPanelOpen()) return
        var target = event.target
        if (!target || target.closest && (target.closest('#' + PANEL_ID) || target.closest('#' + BTN_ID))) return
        start = { x: event.clientX, y: event.clientY, ox: state.offsetX, oy: state.offsetY }
      }, true)
      document.addEventListener('mousemove', function (event) {
        if (!start) return
        setState({ offsetX: Math.round(start.ox + (event.clientX - start.x)), offsetY: Math.round(start.oy + (event.clientY - start.y)) }, { controls: false })
      }, true)
      document.addEventListener('mouseup', function () {
        if (start) {
          start = null
          saveState()
          syncControls()
        }
      }, true)
    }

    function installKeyboard() {
      document.addEventListener('keydown', function (event) {
        var key = event.key
        // Ctrl+Shift+B：开关面板（沿用浏览器里不冲突的组合）
        if (event.ctrlKey && event.shiftKey && (key === 'B' || key === 'b')) {
          event.preventDefault()
          togglePanel()
          return
        }
        if (key === 'Escape' && isPanelOpen()) {
          closePanel()
          return
        }
        if (!isPanelOpen()) return
        var step = event.shiftKey ? 10 : 1
        var patch = null
        if (key === 'ArrowLeft') patch = { offsetX: state.offsetX - step }
        else if (key === 'ArrowRight') patch = { offsetX: state.offsetX + step }
        else if (key === 'ArrowUp') patch = { offsetY: state.offsetY - step }
        else if (key === 'ArrowDown') patch = { offsetY: state.offsetY + step }
        if (!patch) return
        event.preventDefault()
        setState(patch)
      })
    }

    // ------------------------------------------------------------ 悬浮按钮（可选）

    /**
     * 常驻悬浮按钮：默认不显示。
     * 入口按用户要求放在「插件/设置」里，这里是可选的快捷方式（配置页里能开关）。
     */
    function syncFloatingButton() {
      if (state.showFloatingButton) ensureButton()
      else hideButton()
    }

    function ensureButton() {
      if (!document.body) return null
      if (toggleBtn && toggleBtn.isConnected) return toggleBtn
      ensureStyleTag()
      toggleBtn = document.createElement('button')
      toggleBtn.id = BTN_ID
      toggleBtn.className = 'dshbg-btn'
      toggleBtn.title = TEXT.toggle
      toggleBtn.dataset.dshBg = 'toggle'
      toggleBtn.dataset.on = state.enabled && isUsableImage(state.dataUrl) ? 'true' : 'false'
      toggleBtn.textContent = '🖼 ' + TEXT.title
      toggleBtn.addEventListener('click', function () { togglePanel() })
      document.body.appendChild(toggleBtn)
      return toggleBtn
    }

    function hideButton() {
      if (toggleBtn && toggleBtn.parentNode) toggleBtn.parentNode.removeChild(toggleBtn)
      toggleBtn = null
      var stale = document.getElementById(BTN_ID)
      if (stale && stale.parentNode) stale.parentNode.removeChild(stale)
    }

    // ------------------------------------------------- 设置页（官方 Slot，React）

    function settingsH() {
      if (!React) throw new Error('dsh-bg-image: react 未解析，无法渲染设置页')
      return React.createElement
    }

    /** 一个受控滑杆行。 */
    function RangeRow(props) {
      var h = settingsH()
      return h('div', { className: 'dshbg-set-slider' },
        h('label', { htmlFor: props.id }, props.label),
        h('input', {
          id: props.id,
          type: 'range',
          min: String(props.min),
          max: String(props.max),
          step: String(props.step),
          value: String(props.value),
          onChange: function (event) { props.onChange(Number(event.target.value)) }
        }),
        h('output', null, props.format(props.value))
      )
    }

    /** 一组互斥按钮（大小模式 / 对齐 / 平铺方式）。 */
    function ChoiceGroup(props) {
      var h = settingsH()
      return h('div', { className: props.grid ? 'dshbg-set-grid' : 'dshbg-set-modes' },
        props.options.map(function (option) {
          return h('button', {
            key: option.value,
            type: 'button',
            className: 'dshbg-set-btn',
            'data-active': String(props.value) === String(option.value) ? 'true' : 'false',
            title: option.title || option.label,
            onClick: function () { props.onChange(option.value) }
          }, option.label)
        })
      )
    }

    /** 数字输入行。 */
    function NumberRow(props) {
      var h = settingsH()
      return h('div', { className: 'dshbg-set-row' },
        h('span', { className: 'dshbg-set-hint', style: { minWidth: '64px' } }, props.label),
        h('input', {
          className: 'dshbg-set-input',
          type: 'number',
          min: String(props.min),
          max: String(props.max),
          step: '1',
          value: String(props.value),
          onChange: function (event) { props.onChange(Number(event.target.value)) }
        }),
        props.suffix ? h('span', { className: 'dshbg-set-hint' }, props.suffix) : null
      )
    }

    var MODE_OPTIONS = [
      { value: 'cover', label: TEXT.modeCover },
      { value: 'contain', label: TEXT.modeContain },
      { value: 'fill', label: TEXT.modeFill },
      { value: 'custom', label: TEXT.modeCustom },
      { value: 'tile', label: TEXT.modeTile }
    ]
    var ALIGN_OPTIONS = [
      { value: 'top left', label: TEXT.alignTopLeft },
      { value: 'top center', label: TEXT.alignTop },
      { value: 'top right', label: TEXT.alignTopRight },
      { value: 'center left', label: TEXT.alignLeft },
      { value: 'center', label: TEXT.alignCenter },
      { value: 'center right', label: TEXT.alignRight },
      { value: 'bottom left', label: TEXT.alignBottomLeft },
      { value: 'bottom center', label: TEXT.alignBottom },
      { value: 'bottom right', label: TEXT.alignBottomRight }
    ]
    var REPEAT_OPTIONS = [
      { value: 'repeat', label: TEXT.repBoth },
      { value: 'repeat-x', label: TEXT.repX },
      { value: 'repeat-y', label: TEXT.repY },
      { value: 'no-repeat', label: TEXT.repNone }
    ]

    /**
     * 背景图设置表单：同时用于「插件配置页」与「设置分区」。
     * 纯受控组件——所有改动都写入插件状态（localStorage 持久化）。
     */
    function BackgroundSettingsForm(props) {
      var h = settingsH()
      var useState = React.useState
      var useRef = React.useRef
      var useEffect = React.useEffect

      var pair = useState(function () { return mergeState(state, {}) })
      var current = pair[0]
      var setCurrent = pair[1]
      var statusPair = useState({ text: '', error: false })
      var status = statusPair[0]
      var setStatusState = statusPair[1]
      var fileRef = useRef(null)
      var urlPair = useState(isHttpImage(current.dataUrl) ? current.dataUrl : '')
      var url = urlPair[0]
      var setUrl = urlPair[1]
      var dropPair = useState(false)
      var dragging = dropPair[0]
      var setDragging = dropPair[1]

      useEffect(function () {
        return subscribe(function (next) { setCurrent(mergeState(next, {})) })
      }, [])

      var patch = function (changes, message) {
        setState(changes)
        if (message) setStatusState({ text: message, error: false })
      }
      var pct = function (value) { return Math.round(value * 100) + '%' }

      var readFile = function (file) {
        if (!file || !/^image\//i.test(file.type || '')) {
          setStatusState({ text: TEXT.badFile, error: true })
          return
        }
        var reader = new FileReader()
        reader.onload = function () {
          var result = String(reader.result || '')
          if (!isDataImage(result)) {
            setStatusState({ text: TEXT.badFile, error: true })
            return
          }
          var ok = setState({ dataUrl: result }) !== false
          setStatusState({ text: ok ? TEXT.loaded + '（' + file.name + '）' : TEXT.quota, error: !ok })
        }
        reader.onerror = function () { setStatusState({ text: '读取图片失败', error: true }) }
        reader.readAsDataURL(file)
      }

      var children = []
      children.push(h('h3', { key: 'title', className: 'dshbg-set-title' }, TEXT.title))
      children.push(h('p', { key: 'desc', className: 'dshbg-set-desc' }, TEXT.settingsDesc))

      // ---- 图片
      children.push(h('section', { key: 'image', className: 'dshbg-set-sec' },
        h('h4', { className: 'dshbg-set-title' }, TEXT.image),
        h('div', {
          className: 'dshbg-set-preview',
          'data-drop': dragging ? 'true' : 'false',
          'data-dsh-bg': 'settings-preview',
          style: current.dataUrl ? { backgroundImage: 'url("' + String(current.dataUrl).replace(/"/g, '%22') + '")' } : null,
          onDragOver: function (event) { event.preventDefault(); setDragging(true) },
          onDragLeave: function () { setDragging(false) },
          onDrop: function (event) {
            event.preventDefault()
            setDragging(false)
            var files = event.dataTransfer && event.dataTransfer.files
            if (files && files.length) readFile(files[0])
          }
        }, current.dataUrl ? null : TEXT.none),
        h('div', { className: 'dshbg-set-row' },
          h('button', {
            type: 'button',
            className: 'dshbg-set-btn',
            onClick: function () { if (fileRef.current) fileRef.current.click() }
          }, TEXT.choose),
          h('button', {
            type: 'button',
            className: 'dshbg-set-btn',
            onClick: function () { setState({ dataUrl: '' }); setUrl(''); setStatusState({ text: TEXT.cleared, error: false }) }
          }, TEXT.clear),
          h('input', {
            ref: fileRef,
            type: 'file',
            accept: 'image/*',
            'data-dsh-bg': 'settings-file',
            style: { display: 'none' },
            onChange: function (event) {
              var files = event.target.files
              if (files && files.length) readFile(files[0])
              event.target.value = ''
            }
          })
        ),
        h('div', { className: 'dshbg-set-row' },
          h('input', {
            className: 'dshbg-set-input',
            style: { width: '240px' },
            type: 'text',
            placeholder: TEXT.urlPlaceholder,
            value: url,
            onChange: function (event) { setUrl(event.target.value) },
            onKeyDown: function (event) { if (event.key === 'Enter') applyUrl() }
          }),
          h('button', { type: 'button', className: 'dshbg-set-btn', onClick: applyUrl }, TEXT.apply)
        )
      ))

      function applyUrl() {
        var value = String(url || '').trim()
        if (!value) {
          setState({ dataUrl: '' })
          setStatusState({ text: TEXT.cleared, error: false })
          return
        }
        if (!isUsableImage(value)) {
          setStatusState({ text: 'URL 需要以 http(s):// 或 data:image/ 开头', error: true })
          return
        }
        setState({ dataUrl: value })
        setStatusState({ text: TEXT.loaded, error: false })
      }

      // ---- 透明度与滤镜
      children.push(h('section', { key: 'opacity', className: 'dshbg-set-sec' },
        h('h4', { className: 'dshbg-set-title' }, TEXT.opacity),
        h(RangeRow, { id: 'dshbg-opacity', label: TEXT.opacity, min: 0, max: 1, step: 0.01, value: current.opacity, format: pct, onChange: function (value) { patch({ opacity: value }) } }),
        h(RangeRow, { id: 'dshbg-blur', label: TEXT.blur, min: 0, max: 40, step: 1, value: current.blur, format: function (value) { return Math.round(value) + 'px' }, onChange: function (value) { patch({ blur: value }) } }),
        h(RangeRow, { id: 'dshbg-brightness', label: TEXT.brightness, min: 0.2, max: 2, step: 0.01, value: current.brightness, format: pct, onChange: function (value) { patch({ brightness: value }) } })
      ))

      // ---- 大小
      var sizeChildren = [
        h('h4', { key: 'h', className: 'dshbg-set-title' }, TEXT.size),
        h(ChoiceGroup, { key: 'modes', options: MODE_OPTIONS, value: current.mode, onChange: function (value) { patch({ mode: value }) } })
      ]
      if (current.mode === 'custom') {
        sizeChildren.push(h('div', { key: 'custom', className: 'dshbg-set-row' },
          h(NumberRow, { label: TEXT.width, min: 1, max: 500, value: current.widthPct, suffix: '%', onChange: function (value) { patch({ widthPct: value }) } }),
          h(NumberRow, { label: TEXT.height, min: 1, max: 500, value: current.heightPct, suffix: '%', onChange: function (value) { patch({ heightPct: value }) } })
        ))
      }
      if (current.mode === 'tile') {
        sizeChildren.push(h('div', { key: 'tile', className: 'dshbg-set-row' },
          h('span', { className: 'dshbg-set-hint', style: { minWidth: '64px' } }, TEXT.tileRepeat),
          h(ChoiceGroup, { options: REPEAT_OPTIONS, value: current.repeat, onChange: function (value) { patch({ repeat: value }) } })
        ))
      }
      children.push(h('section', { key: 'size', className: 'dshbg-set-sec' }, sizeChildren))

      // ---- 位置
      children.push(h('section', { key: 'position', className: 'dshbg-set-sec' },
        h('h4', { className: 'dshbg-set-title' }, TEXT.position),
        h('div', { className: 'dshbg-set-row' },
          h('span', { className: 'dshbg-set-hint', style: { minWidth: '64px' } }, TEXT.anchor),
          h(ChoiceGroup, { options: ALIGN_OPTIONS, value: current.align, grid: true, onChange: function (value) { patch({ align: value }) } })
        ),
        h('div', { className: 'dshbg-set-row' },
          h(NumberRow, { label: TEXT.offsetX, min: -4000, max: 4000, value: current.offsetX, suffix: 'px', onChange: function (value) { patch({ offsetX: value }) } }),
          h(NumberRow, { label: TEXT.offsetY, min: -4000, max: 4000, value: current.offsetY, suffix: 'px', onChange: function (value) { patch({ offsetY: value }) } })
        )
      ))

      // ---- 高级
      children.push(h('section', { key: 'advanced', className: 'dshbg-set-sec' },
        h('h4', { className: 'dshbg-set-title' }, TEXT.advanced),
        h('div', { className: 'dshbg-set-row' },
          h('span', { className: 'dshbg-set-hint', style: { minWidth: '64px' } }, TEXT.scrimColor),
          h('input', {
            className: 'dshbg-set-input',
            type: 'color',
            value: current.scrimColor,
            onChange: function (event) { patch({ scrimColor: event.target.value }) }
          }),
          h('span', { className: 'dshbg-set-hint' }, current.scrimColor)
        ),
        h(RangeRow, { id: 'dshbg-scrim', label: TEXT.scrimAlpha, min: 0, max: 1, step: 0.01, value: current.scrimAlpha, format: pct, onChange: function (value) { patch({ scrimAlpha: value }) } }),
        h(RangeRow, { id: 'dshbg-glass', label: TEXT.glass, min: 0, max: 1, step: 0.01, value: current.glass, format: pct, onChange: function (value) { patch({ glass: value }) } }),
        h('p', { className: 'dshbg-set-hint' }, TEXT.glassHint),
        h('div', { className: 'dshbg-set-row' },
          h('span', { className: 'dshbg-set-hint', style: { minWidth: '64px' } }, TEXT.floatingLabel),
          h(ChoiceGroup, {
            options: [
              { value: 'off', label: TEXT.floatingOff },
              { value: 'on', label: TEXT.floatingOn }
            ],
            value: current.showFloatingButton ? 'on' : 'off',
            onChange: function (value) { patch({ showFloatingButton: value === 'on' }) }
          })
        )
      ))

      // ---- 底部
      children.push(h('div', { key: 'footer', className: 'dshbg-set-row' },
        h('button', {
          type: 'button',
          className: 'dshbg-set-btn',
          onClick: function () {
            state = normalizeState(DEFAULTS)
            saveState()
            render()
            syncControls()
            notify()
            setStatusState({ text: TEXT.reset_done, error: false })
          }
        }, TEXT.reset),
        layoutHandle && typeof layoutHandle.selectPanel === 'function'
          ? h('button', {
            type: 'button',
            className: 'dshbg-set-btn',
            onClick: function () {
              try {
                layoutHandle.selectPanel(PLUGINS_PANEL_ID)
                layoutHandle.selectPanel(null)
              } catch (e) { /* 忽略：宿主布局不支持时保持原样 */ }
            }
          }, TEXT.backToChat)
          : null
      ))

      if (status.text) {
        children.push(h('p', { key: 'status', className: 'dshbg-set-status', 'data-err': status.error ? 'true' : 'false' }, status.text))
      }
      children.push(h('p', { key: 'hint', className: 'dshbg-set-hint' }, TEXT.settingsHint))

      return h('div', { className: 'dshbg-set', 'data-dsh-bg': 'settings-form' }, children)
    }

    // ---------------------------------------------------------------- apply

    function apply(ctx) {
      loadState()
      ensureStyleTag()
      render()
      syncFloatingButton()
      installKeyboard()
      installPictureDrag()
      if (state.panelOpen) openPanel()
      // 宿主是 React 应用：重渲染可能摘掉我们注入的节点，随时补回。
      var schedule = null
      var repair = function () {
        schedule = null
        if (!document.body) return
        if (state.showFloatingButton && !document.getElementById(BTN_ID)) ensureButton()
        if (!document.getElementById(LAYER_ID)) {
          layer = null
          imageFace = null
          scrim = null
          render()
        }
        if (state.panelOpen && !document.getElementById(PANEL_ID)) openPanel()
      }
      try {
        observer = new window.MutationObserver(function () {
          if (schedule) return
          schedule = window.setTimeout(repair, 120)
        })
        observer.observe(document.body, { childList: true })
      } catch (e) { /* 无 MutationObserver 时静默降级 */ }

      window.addEventListener('pagehide', function () {
        if (observer) observer.disconnect()
        applyGlass(0)
      })

      registerSettingsSlots(ctx)

      // 暴露一个极小的调试面：控制台里 __dshBg.set({opacity:0.4}) 即可改设置。
      window.__dshBg = {
        get state() { return mergeState(state, {}) },
        set: function (patch) { return setState(patch || {}) },
        subscribe: subscribe,
        reset: function () {
          state = normalizeState(DEFAULTS)
          saveState()
          render()
          syncControls()
          refreshThumb()
          notify()
          return state
        },
        open: openPanel,
        close: closePanel,
        toggle: togglePanel,
        /** 设置页注册状态（排障用）。 */
        settingsDebug: function () {
          return {
            react: React ? typeof React.createElement : 'none',
            slots: slotsApi ? typeof slotsApi.inject : 'none',
            layout: layoutHandle ? typeof layoutHandle.selectPanel : 'none',
            bundleConfigRegistered: registeredBundleConfig,
            settingsSectionRegistered: registeredSettingsSection
          }
        },
        /** 打开「插件」面板（设置里配置背景图的路径）。 */
        openSettings: function () {
          if (layoutHandle && typeof layoutHandle.selectPanel === 'function') layoutHandle.selectPanel(PLUGINS_PANEL_ID)
        }
      }
    }

    /**
     * 把配置页注册进宿主的官方 Slot：
     *   - plugins.bundle.config（key = 包名）→ 侧栏「插件」→ 本插件详情页；
     *   - settings.section → 宿主启用 settings 界面时的「背景图」分区。
     *
     * 这里刻意不用插件级 inject（那会让插件在宿主没有 slot 服务时整条挂起），
     * 而是用 ctx.inject(['slots'], …)：服务可用时才注册设置页，缺服务时背景图功能
     * 照常工作（只是没有图形入口）。
     */
    function registerSettingsSlots(ctx) {
      if (!ctx || typeof ctx.inject !== 'function') return
      try {
        ctx.inject(['slots'], function (serviceCtx) {
          try {
            return setupSettingsPage(serviceCtx)
          } catch (e) {
            if (window.console && window.console.warn) window.console.warn('[dsh-bg-image] 设置页注册异常', e)
            return function () {}
          }
        }, 'dsh-bg-image: settings slots')
      } catch (e) {
        if (window.console && window.console.warn) window.console.warn('[dsh-bg-image] 设置页注册失败（可忽略，Ctrl+Shift+B 仍可用）', e && e.message)
      }
    }

    /** 在 slots 服务就绪后注册两个设置页入口（异常由调用方兜住）。 */
    function setupSettingsPage(serviceCtx) {
      var api = resolveSlotsApi(serviceCtx)
      if (!api) {
        if (window.console && window.console.warn) window.console.warn('[dsh-bg-image] slots 服务形状不认识，跳过设置页注册')
        return function () {}
      }
      React = resolveReact(serviceCtx)
      try {
        layoutHandle = serviceCtx && typeof serviceCtx.get === 'function' ? serviceCtx.get('layout') : null
      } catch (e) {
        layoutHandle = null
      }
      if (!React || typeof React.createElement !== 'function') {
        if (window.console && window.console.warn) window.console.warn('[dsh-bg-image] 拿不到 react，跳过设置页注册')
        return function () {}
      }
      var disposers = []
      disposers.push(registerBundleConfig(api))
      disposers.push(registerSettingsSection(api))
      return function () {
        for (var i = 0; i < disposers.length; i++) {
          try { if (typeof disposers[i] === 'function') disposers[i]() } catch (e) { /* 忽略 */ }
        }
        registeredBundleConfig = false
        registeredSettingsSection = false
      }
    }

    /**
     * 找到真正带 inject/register 的 slot 服务实例。
     *
     * 关键坑（cordis 行为）：服务在上下文里是「惰性代理」，未 inject 的属性一旦被读取
     * 就直接抛错（cannot get property "x" without inject）。因此这里**只能**通过
     * ctx.get(name) 取服务，绝不能先去探测 ctx.slots / ctx.register。
     */
    function resolveSlotsApi(serviceCtx) {
      if (!serviceCtx) return null
      var candidate = null
      try {
        candidate = typeof serviceCtx.get === 'function' ? serviceCtx.get('slots') : null
      } catch (e) {
        candidate = null
      }
      if (!candidate) return null
      var hasInject = false
      var hasRegister = false
      try {
        hasInject = typeof candidate.inject === 'function'
        hasRegister = typeof candidate.register === 'function'
      } catch (e) {
        return null
      }
      return hasInject && hasRegister ? candidate : null
    }

    /** react 优先从服务上下文取（同样只能走 get），其次退回平台 seed 表。 */
    function resolveReact(serviceCtx) {
      var viaContext = null
      try {
        viaContext = serviceCtx && typeof serviceCtx.get === 'function' ? serviceCtx.get('react') : null
      } catch (e) {
        viaContext = null
      }
      return viaContext || requireOptional('react') || null
    }

    function registerBundleConfig(api) {
      if (registeredBundleConfig) return null
      registeredBundleConfig = true
      try {
        return api.inject(BUNDLE_CONFIG_SLOT, function () {
          return api.register({
            name: BUNDLE_CONFIG_SLOT,
            key: 'dsh-bg-image'
          }, BackgroundSettingsForm)
        })
      } catch (e) {
        registeredBundleConfig = false
        warn(e)
        return null
      }
    }

    function registerSettingsSection(api) {
      if (registeredSettingsSection) return null
      registeredSettingsSection = true
      try {
        return api.inject(SETTINGS_SECTION_SLOT, function () {
          return api.register({
            name: SETTINGS_SECTION_SLOT,
            id: 'bg-image',
            order: 40,
            label: function () { return TEXT.title }
          }, BackgroundSettingsForm)
        })
      } catch (e) {
        registeredSettingsSection = false
        warn(e)
        return null
      }
    }

    function warn(error) {
      if (window.console && window.console.warn) window.console.warn('[dsh-bg-image] slot 注册失败', error && error.message)
    }

    exports.apply = apply
    exports.name = 'dsh-bg-image'

    /**
     * 离线测试面：只暴露纯函数/状态矫正，不改变运行时行为。
     * dev-tools/test/run-tests.mjs 直接读它做单元测试。
     */
    exports.__test = {
      DEFAULTS: DEFAULTS,
      normalizeState: normalizeState,
      mergeState: mergeState,
      alignToPosition: alignToPosition,
      sizeFor: sizeFor,
      buildLayerStyle: buildLayerStyle,
      buildFilter: buildFilter,
      hexToRgba: hexToRgba,
      parseColor: parseColor,
      isUsableImage: isUsableImage
    }

    return module.exports
  }
})
