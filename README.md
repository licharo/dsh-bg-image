# dsh-bg-image · DSH 自定义背景图插件

给 DeepSeek Harness 的 Web / 桌面 GUI 换一张自己的背景图：**任意本地图片文件**（或图片 URL），
**大小**（覆盖 / 包含 / 拉伸 / 自定义百分比 / 平铺）、**位置**（九宫格对齐 + 水平/垂直像素偏移）、
**透明度**（图片透明度、模糊、亮度、蒙层、界面半透明）都可以实时调整，设置自动记住。

```
┌─ 背景层（body 之下，pointer-events:none）──────────────┐
│  image face  ← background-image / size / position / 片透明度 / 模糊 │
│  scrim face  ← 蒙层（颜色 + 浓度）                       │
└──────────────────────────────────────────────────────┘
        ↑ 之上是 DSH 自己的界面；开启「界面半透明」后
          宿主容器的底色会按比例变透明，壁纸从底下透出来
```

- **不占主界面**：没有常驻悬浮按钮、没有角落图标；入口在**侧栏「插件」→ dsh-bg-image 详情页的配置页**里。
- **纯浏览器半侧插件**：不需要 Host 服务、不动任何 bundle 补丁（除插入自己这一行）、不注入 system prompt。
- **零构建**：`lib/client.js` 是手写 bundle（`window.__ModuleLoader__.load({ id, factory })`），与 DSH 官方客户端 bundle 同形。
- 背景层本身是原生 DOM（被 React 重渲染摘掉后由 MutationObserver 自动补回）；设置页是注册进官方 Slot 的 React 组件。

---

## 0. 入口在哪

| 入口 | 位置 | 说明 |
| --- | --- | --- |
| **插件配置页（主入口）** | 侧栏 **插件** → 点 `dsh-bg-image` 卡片 → 页面里的「背景图」配置区 | 官方 Slot `plugins.bundle.config`（key = 包名），跟随宿主主题 |
| 设置分区（备用） | Settings 面板 → 「背景图」 | 官方 Slot `settings.section`；宿主启用 settings 界面时才出现 |
| 快捷面板（隐藏） | 按 **Ctrl+Shift+B** | 不渲染任何常驻 UI，仅键盘唤起紧凑面板 |
| 调试接口 | 控制台 `__dshBg.set({...})` / `__dshBg.open()` | 排障用 |

> 想恢复以前那种右下角悬浮按钮，在配置页把 **常驻悬浮按钮** 切成「显示」即可（默认隐藏）。

---

## 1. 安装

仓库地址：<https://github.com/licharo/dsh-bg-image>

### 方式 A：从 GitHub 装（给别人用）

1. 打开仓库 → **Code → Download ZIP**（或 `git clone https://github.com/licharo/dsh-bg-image.git`）并解压。
2. DSH 左侧边栏点 **插件 / Plugins** → **添加插件 / Add plugin**。
3. 粘贴**解压出来的目录路径**（本插件无构建步骤，源码目录可直接当插件装）：

   ```
   D:\你的路径\dsh-bg-image
   ```

4. 点 **安装**（本插件没有依赖，几秒完成），然后**启用**它。
5. **重启 DeepSeek Harness**，重启后刷新页面。

> 也可以粘贴仓库里的压缩包路径 `dsh-bg-image-1.1.0.tgz`（仓库自带，离线可用）。

### 方式 B：本机已装好的路径

如果插件已经装在这台机器上，直接填本地 tarball：

```
C:\Users\赵祉豪\.dsh\plugin-backups\dsh-bg-image-1.1.0.tgz
```

### 方式 C：手工改 profile（等价于安装器做的事）

改 `C:\Users\赵祉豪\.dsh\profiles\desktop\package.json`：

```json
{
  "name": "dsh-profile-desktop",
  "private": true,
  "dependencies": {
    "dsh-bg-image": "file:C:/Users/赵祉豪/.dsh/plugin-backups/dsh-bg-image-1.1.0.tgz"
  },
  "dsh": {
    "profile": {
      "bundles": [
        "@deepseek-ai/dsh-base",
        "@deepseek-ai/dsh-web-app",
        "dsh-bg-image"
      ]
    }
  }
}
```

然后在 profile 目录里跑一次 pnpm（DSH 自带的即可），再重启应用：

```powershell
& 'C:\Users\赵祉豪\AppData\Local\Programs\DeepSeek Harness\resources\runtime\primary-runtime\dependencies\node\bin\node.exe' `
  'C:\Users\赵祉豪\AppData\Local\Programs\DeepSeek Harness\resources\runtime\pnpm\bin\pnpm.cjs' `
  install --dir 'C:\Users\赵祉豪\.dsh\profiles\desktop'
```

### 卸载 / 回滚

- GUI：插件页里关掉或卸载 `dsh-bg-image`，重启。
- 手工：把 `bundles` 里那行删掉并 `pnpm remove dsh-bg-image`（或直接从 profile 里删掉依赖），重启。
- 页面内自净：关闭扩展面板里的「界面半透明」或点「恢复默认」会把宿主表面还原；
  插件被停用时 `pagehide` 也会还原，不留痕迹。

---

## 2. 打开设置

设置页就是插件详情页里的那个配置区（`plugins.bundle.config`），**和宿主同一套设计令牌**，跟随亮/暗主题。

| 入口 | 说明 |
| --- | --- |
| 侧栏 **插件** → `dsh-bg-image` 卡片 | 主入口，配置页渲染在插件详情的描述与组件列表之间 |
| Settings 面板 → 「背景图」分区 | 备用入口（`settings.section`），宿主启用 settings 界面时出现 |
| 快捷键 **Ctrl + Shift + B** | 唤起居中的紧凑面板（原生 DOM，不占主界面） |
| 控制台 `__dshBg.open()` / `__dshBg.openSettings()` | 兜底：打开紧凑面板 / 跳到「插件」页 |
| 控制台 `__dshBg.set({...})` | 脚本化改设置，例如 `__dshBg.set({ opacity: 0.4 })` |

配置页里还有一条 **常驻悬浮按钮** 开关（默认「隐藏」）；切成「显示」会在右下角加回 `🖼 背景图` 按钮。
紧凑面板本身：拖标题栏移动（位置会记住）、`✕` 或 `Esc` 关闭、把图片文件**拖进面板**等同于点「选择图片文件…」。

---

## 3. 每项设置

### 图片

| 控件 | 作用 |
| --- | --- |
| 选择图片文件… | 打开系统文件选择器，读入任意 `image/*` 文件 |
| 清空图片 | 移除背景图（其它设置保留） |
| 粘贴图片 URL | 支持 `https://…` 与 `data:image/…`，回车或点「应用 URL」 |
| 拖放 | 把图片文件拖到面板上 |

图片以 data URL 存在 `localStorage['dsh.bgImage.v1']`。浏览器给单个源约 5–10 MB 配额，
**大图（>3 MB）可能写不进去**：这时会提示「图片过大」，设置只在本页内存里生效。
建议用 2 MB 以内的图，或者改用图片 URL。

### 透明度

| 设置 | 范围 | 说明 |
| --- | --- | --- |
| 图片透明度 | 0–100% | 直接作用于图片层 |
| 模糊 | 0–40px | 让壁纸退到内容后面，文字更好读 |
| 亮度 | 20–200% | 暗色/亮色壁纸适配 |
| 蒙层颜色 / 蒙层浓度 | 任意色 / 0–100% | 在图片与界面之间压一层色，压暗或染色 |
| 界面半透明 | 0–100% | 把宿主容器的**不透明底色按比例透出壁纸**；0 = 完全不改宿主样式 |

> 「界面半透明」是唯一会改动宿主样式的开关：它先取 `body → #root`，再沿「唯一宿主子节点」
> 向里最多 4 层，另加一次从 `#root` 起的宽度优先遍历（深度 ≤4、节点 ≤120），只收
> **至少 160×360 像素且覆盖视口 ≥15% 宽 / ≥50% 高**的大面板（侧栏、主区、整屏容器），
> 并且只处理**本来就带非透明底色**的元素，逐个记忆原值。
> 关闭滑块或卸载插件时全部还原。

### 大小

| 模式 | CSS | 适用 |
| --- | --- | --- |
| 覆盖 cover | `background-size: cover` | 铺满窗口、等比裁切（默认） |
| 包含 contain | `contain` | 完整显示整张图，可能留白 |
| 拉伸 fill | `100% 100%` | 强制铺满，会变形 |
| 自定义 % | `<宽>% <高>%` | 相对窗口的百分比尺寸（例如 40% × 75%） |
| 平铺 | `auto auto` + 平铺方式 | 原图像素重复，可选双向/横向/纵向/不平铺 |

### 位置

- **对齐**：九宫格（左上 / 上中 / 右上 / 左中 / 居中 / 右中 / 左下 / 下中 / 右下）→ `background-position`
- **水平 / 垂直偏移**：像素级 `translate()`，范围 ±4000px
- **面板打开时**：在页面上按住拖动可直接微调偏移；方向键微调 1px，`Shift` + 方向键 10px

---

## 4. 数据与副作用

| 项目 | 说明 |
| --- | --- |
| 存储键 | `localStorage['dsh.bgImage.v1']`（JSON；图片为 data URL） |
| 注入节点 | `#dshbg-layer`（图片层 + 蒙层）、`#dshbg-style`（私有样式）；紧凑面板打开时才有 `#dshbg-panel`，悬浮按钮开启时才有 `#dshbg-toggle`；配置页的预览/文件框都在 React 树里 |
| 类名前缀 | 全部 `dshbg-` / `dshbg-set-`，不覆盖宿主任何选择器 |
| 注册的 Slot | `plugins.bundle.config`（key `dsh-bg-image`）、`settings.section`（id `bg-image`）——都在 effect 作用域内，卸载时自动回收 |
| 网络 | 没有任何网络请求（图片 URL 由浏览器直接加载） |
| 剪贴板 / 文件 | 只在用户点「选择图片文件…」或拖放时读取本地文件 |
| 卸载 | `pagehide` 还原宿主表面；节点随页面卸载消失；再次启用重新创建 |

## 5. 已知限制

- 壁纸只在**图片层与界面之间**起作用：宿主若把内容画在不透明画布（canvas）上，那部分不会被覆盖。
- 「界面半透明」是启发式的：只覆盖 `body → #root` 单链、深度 ≤4 的大容器与
  达到面积阈值的浅层面板。某些深层的、自带不透明底色的卡片不会变透明（这是刻意的，
  避免整页花掉）。
- 平铺模式使用**原图像素**尺寸，不支持放大平铺；需要放大平铺时用「自定义 %」+ 偏移。
- 图片存在 `localStorage` 里，配额约 5–10 MB；超大图请用 URL。
- 换浏览器 / 换设备不会同步设置（那是 Host 侧 settings 命名空间的事，本插件刻意不依赖它）。
- 配置页只在**宿主启用「插件」面板**时可见；面板被关掉时仍可用 `Ctrl+Shift+B`。

## 6. 开发与自检

源码目录 `D:\zhuomian\deepseek\dsh-bg-image`：

| 路径 | 作用 |
| --- | --- |
| `lib/client.js` | 唯一的功能实现（手写 bundle，无构建步骤；背景层 + 紧凑面板 + React 配置页） |
| `lib/index.js` | Host 半侧占位（只为让 Loader 有一条命名正确的插件行） |
| `cordis.patch.yml` | bundle patch：插入 `dsh-bg-image` 这一行 |
| `dev-tools/test/run-tests.mjs` | Node + jsdom + React：32 项断言（状态矫正、DOM 注入、配置页渲染与联动） |
| `dev-tools/browser-check.mjs` | 真实 Edge 无头 + CDP：6 个场景 × 24 项断言 + 截图 |
| `dev-tools/e2e-check.mjs` | **真机端到端**：起一个真实 DSH 实例，走「插件」UI 打开配置页并校验 |
| `dev-tools/verify-install.mjs` | 校验已安装副本：清单声明、patch 行、bundle 可物化并渲染 |
| `dev-tools/make-test-image.mjs` | 手写 PNG 编码器，生成测试图 |
| `dev-tools/embed-test-images.mjs` | 把测试图打成 data URL 脚本供测试台使用 |
| `dev-tools/test/browser-harness.html` | 模拟 DSH 布局的浏览器测试台 |

```powershell
$node = 'C:\Users\AppData\Local\Programs\DeepSeek Harness\resources\runtime\primary-runtime\dependencies\node\bin\node.exe'
cd D:\zhuomian\deepseek\dsh-bg-image
& $node --check lib/client.js           # 语法
& $node dev-tools/test/run-tests.mjs    # 单元 + jsdom + React 配置页
& $node dev-tools/browser-check.mjs     # 真实浏览器（产物在 dev-tools/test/out）
& $node dev-tools/verify-install.mjs    # 校验已安装到 profile 的副本
& $node dev-tools/e2e-check.mjs --url 'http://127.0.0.1:<port>/?token=<token>'
```

端到端那条需要一个真实 DSH 实例（详见 `dev-tools/e2e-check.mjs` 顶部注释）：
用临时 `DSH_HOME` + 临时 profile 装本插件，`dsh --profile <p> --no-open --port <p>` 起服务，
把日志里 `dsh web: <url>` 的地址交给脚本即可；脚本会验证启动图、bundle 路由字节一致、
真实页面「插件」页里的配置表单、以及截图。

## 7. 踩过的坑（写给以后的自己）

在 DSH 客户端里注册官方 Slot，有两条硬规则：

1. **服务只能通过注入拿到，不能嗅探**。cordis 的服务在上下文里是惰性代理，未 `inject` 的属性
   一读就抛 `cannot get property "x" without inject` —— 所以既不能写 `if (ctx.slots)`，
   也不能在 `typeof value.register` 里用 try 兜（读属性本身就会抛）。
   正确姿势：插件级 `inject: ['slots']`，或 `ctx.inject(['slots'], cb)` 后在回调里
   **只走 `serviceCtx.get('slots')`** 取服务。
2. **`plugins.bundle.config` 是 keyed slot，key 必须是包名**（`entryKey: pkg.name`），
   并且页面只在「该 key 已注册」时才渲染配置区 —— 注册晚一点没关系，账本会订阅变化。

