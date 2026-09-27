/**
 * 通过 GitHub REST API 建仓 + 推送（本机到 github.com:443 不通，只有 api.github.com 可达，
 * 所以不能用 git push，改走 Git Data API —— 它同样能保真地保留提交历史）。
 *
 * 用法：
 *   node dev-tools/push-to-github.mjs --owner <用户名> --repo <仓库名> [--private] [--token-file <路径>]
 * 令牌优先级：--token-file > GITHUB_TOKEN 环境变量 > ~/.dsh/plugin-backups/dsh-bg-image-install/github-token.txt
 *
 * 行为：
 *   1. GET /user 校验令牌，打印登录名与权限范围；
 *   2. 仓库不存在则 POST /user/repos 创建（默认 public）；
 *   3. 用 Git Data API 按本地提交顺序重放：blob → tree → commit → 更新 refs；
 *   4. 打印仓库地址与最终提交。
 *
 * 只会新建仓库（若已存在同名仓库且非空，会在推送前停下来，不会强推覆盖）。
 */

import { readFileSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(here, '..')

const GIT = 'C:/Program Files/Microsoft Visual Studio/2022/Community/Common7/IDE/CommonExtensions/Microsoft/TeamFoundation/Team Explorer/Git/cmd/git.exe'
const API = 'https://api.github.com'
const DEFAULT_TOKEN_FILE = 'C:/Users/赵祉豪/.dsh/plugin-backups/dsh-bg-image-install/github-token.txt'

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback
}

const owner = arg('owner')
const repo = arg('repo')
const isPrivate = process.argv.includes('--private')
const tokenFile = arg('token-file', DEFAULT_TOKEN_FILE)

if (!owner || !repo) {
  console.error('usage: node dev-tools/push-to-github.mjs --owner <user> --repo <name> [--private] [--token-file <path>]')
  process.exit(2)
}

const token = (() => {
  if (existsSync(tokenFile)) {
    const raw = readFileSync(tokenFile, 'utf8').trim()
    if (raw) return raw
  }
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN.trim()
  return ''
})()
if (!token) {
  console.error(`no token found (looked at ${tokenFile} and GITHUB_TOKEN)`)
  process.exit(2)
}

async function api(method, path, body) {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'dsh-bg-image-push',
      ...(body ? { 'Content-Type': 'application/json' } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  })
  const text = await response.text()
  const data = text ? JSON.parse(text) : null
  if (!response.ok) {
    const message = data && data.message ? data.message : text
    const error = new Error(`${method} ${path} → ${response.status}: ${message}`)
    error.status = response.status
    error.data = data
    throw error
  }
  return { data, headers: response.headers }
}

function git(...args) {
  return execFileSync(GIT, args, { cwd: repoRoot, encoding: 'utf8' }).trim()
}

/** 本地提交（旧→新），带作者/时间，保证历史与本地一致。 */
function localCommits() {
  const raw = execFileSync(
    GIT,
    ['log', '--reverse', '--format=%H%x00%an%x00%ae%x00%aI%x00%s', 'main'],
    { cwd: repoRoot, encoding: 'utf8' }
  )
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [sha, authorName, authorEmail, date, subject] = line.split('\u0000')
      return { sha, authorName, authorEmail, date, subject }
    })
}

function filesOf(sha) {
  const raw = execFileSync(GIT, ['-c', 'core.quotepath=false', 'ls-tree', '-r', '-z', sha], {
    cwd: repoRoot,
    encoding: 'utf8'
  })
  const entries = []
  for (const record of raw.split('\u0000')) {
    if (!record) continue
    const tab = record.indexOf('\t')
    const meta = record.slice(0, tab).split(/\s+/)
    const path = record.slice(tab + 1)
    entries.push({ mode: meta[0], type: meta[1], sha: meta[2], path })
  }
  return entries
}

async function main() {
  const me = await api('GET', '/user')
  console.log(`authenticated as: ${me.data.login}`)
  console.log(`token scopes: ${me.headers.get('x-oauth-scopes') || '(none reported)'}`)

  const full = `${owner}/${repo}`
  let repoInfo = null
  try {
    repoInfo = (await api('GET', `/repos/${full}`)).data
    console.log(`repository exists: ${repoInfo.html_url} (default branch: ${repoInfo.default_branch})`)
    const branches = await api('GET', `/repos/${full}/branches`)
    if (Array.isArray(branches.data) && branches.data.length > 0) {
      console.error('repository already has branches — refusing to overwrite. Delete/rename it first.')
      process.exit(3)
    }
  } catch (error) {
    if (error.status !== 404) throw error
    repoInfo = (await api('POST', '/user/repos', {
      name: repo,
      description: 'DSH（DeepSeek Harness）自定义背景图插件：自定义图片文件/URL，可调大小、位置、透明度；入口在设置/插件页',
      homepage: 'https://github.com/deepseek-ai/deepseek-harness',
      private: isPrivate,
      has_issues: true,
      has_wiki: false,
      auto_init: false
    })).data
    console.log(`repository created: ${repoInfo.html_url}`)
  }

  const commits = localCommits()
  console.log(`replaying ${commits.length} local commit(s)…`)
  let parent = null
  let head = null

  for (const commit of commits) {
    const entries = filesOf(commit.sha)
    const tree = []
    for (const entry of entries) {
      const blob = execFileSync(GIT, ['cat-file', 'blob', entry.sha], { cwd: repoRoot, maxBuffer: 64 * 1024 * 1024 })
      const created = await api('POST', `/repos/${full}/git/blobs`, {
        content: blob.toString('base64'),
        encoding: 'base64'
      })
      tree.push({ path: entry.path, mode: entry.mode === '100755' ? '100755' : '100644', type: 'blob', sha: created.data.sha })
    }
    const treeResult = await api('POST', `/repos/${full}/git/trees`, { tree })
    const commitBody = {
      message: commit.subject,
      tree: treeResult.data.sha,
      author: { name: commit.authorName, email: commit.authorEmail, date: commit.date },
      committer: { name: commit.authorName, email: commit.authorEmail, date: commit.date }
    }
    if (parent) commitBody.parents = [parent]
    const created = await api('POST', `/repos/${full}/git/commits`, commitBody)
    parent = created.data.sha
    head = created.data
    console.log(`  ${commit.sha.slice(0, 7)} → ${created.data.sha.slice(0, 7)}  ${commit.subject}  (${entries.length} files)`)
  }

  await api('POST', `/repos/${full}/git/refs`, { ref: 'refs/heads/main', sha: head.sha })
  if (repoInfo.default_branch && repoInfo.default_branch !== 'main') {
    await api('PATCH', `/repos/${full}`, { default_branch: 'main' }).catch(() => {})
  }

  console.log('')
  console.log(`done: ${repoInfo.html_url}`)
  console.log(`head: ${head.sha}`)
}

main().catch((error) => {
  console.error(`FAILED: ${error.message}`)
  process.exit(1)
})
