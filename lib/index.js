/**
 * dsh-bg-image —— Host 半侧（占位）
 *
 * 本插件的全部功能都在浏览器半侧（./client.js）：背景层、控制面板、状态持久化
 * 都是页面内的事，不需要 Host 服务、RPC、settings 命名空间或 systemPrompt 注入。
 *
 * 这个模块存在的意义只是让 Loader 有一条具备真实名称的插件行；bundle patch 会
 * 插入 `id: dsh-bg-image / name: dsh-bg-image` 这一行，客户端模块系统随后按
 * package.json 的 `dsh.client` 把 ./client.js 作为浏览器 bundle 装载。
 */

/** 稳定的 Cordis 插件名。 */
export const name = 'dsh-bg-image'

/** 不依赖任何宿主服务。 */
export const inject = []

/**
 * 无副作用：激活与停用都只影响 Loader 行本身，
 * 浏览器半侧由客户端模块系统按行生命周期挂载/回收。
 */
export function apply() {}
