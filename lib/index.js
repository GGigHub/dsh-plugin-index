/**
 * dsh-plugin-index — 社区插件索引与生命周期（安装/卸载/更新/修复）。
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, dirname, join } from 'node:path'

export const name = 'dsh-plugin-index'
export const inject = ['webServer']

const SELF_NAME = '@dsh-external/dsh-plugin-index'
const API = '/plugin-index/api'
const CACHE_MS = 15 * 60 * 1000
const CATALOG_PER_PAGE = 100
const CATALOG_MAX_ITEMS = 1000
const CATALOG_MAX_PAGES = 10
const EXCLUDE = new Set(['deepseek-ai/deepseek-harness'])
const GITHUB_SPEC = /^github:[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/
const PACKAGE_NAME = /^(?:@[A-Za-z0-9._-]+\/)?[A-Za-z0-9._-]+$/

function profileName() {
  const raw = (process.env.DSH_PROFILE || 'web').trim()
  return /^[A-Za-z0-9._-]+$/.test(raw) ? raw : 'web'
}

function homeDir() {
  return process.env.DSH_HOME || join(homedir(), '.dsh')
}

function profileDir() {
  return join(homeDir(), 'profiles', profileName())
}

function storeDir() {
  const dir = join(homeDir(), 'plugin-index')
  mkdirSync(dir, { recursive: true })
  return dir
}

function readJson(path, fallback) {
  try {
    if (!existsSync(path)) return fallback
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return fallback
  }
}

function writeJson(path, value) {
  writeFileSync(path, JSON.stringify(value, null, 2), 'utf8')
}

function readProfileManifest() {
  return readJson(join(profileDir(), 'package.json'), {})
}

function installedBundles() {
  const manifest = readProfileManifest()
  const bundles = manifest.dsh?.profile?.bundles ?? []
  const deps = manifest.dependencies ?? {}
  return Object.entries(deps).map(([pkg, spec]) => ({
    name: pkg,
    packageName: pkg,
    spec: String(spec),
    installed: true,
    bundled: bundles.includes(pkg),
    present: existsSync(join(profileDir(), 'node_modules', ...pkg.split('/'))),
    removable: pkg !== SELF_NAME,
  }))
}

function rememberSpec(pkgName, spec) {
  const path = join(storeDir(), 'specs.json')
  const map = readJson(path, {})
  map[pkgName] = spec
  writeJson(path, map)
}

function specMap() {
  return readJson(join(storeDir(), 'specs.json'), {})
}

function isGithubSpec(spec) {
  return GITHUB_SPEC.test(spec)
}

function isRecordedLink(spec) {
  if (!/^(?:link|file):/i.test(spec)) return false
  return Object.values(specMap()).includes(spec)
}

function matchInstalled(item, installed) {
  const id = item.id || ''
  const spec = item.spec || ''
  return installed.find((row) => (
    row.name === item.packageName
    || row.name === item.name
    || row.spec === spec
    || (id && String(row.spec).includes(id))
    || specMap()[row.name] === spec
  ))
}

function resolvePackageName({ spec, name }) {
  const installed = installedBundles()
  if (name && PACKAGE_NAME.test(name) && installed.some((row) => row.name === name)) return name
  const hit = matchInstalled({ spec, name, id: spec.replace(/^github:/, '') }, installed)
  if (hit) return hit.name
  if (spec) {
    const remembered = Object.entries(specMap()).find(([, value]) => value === spec)
    if (remembered) return remembered[0]
  }
  return ''
}

function rememberAfterAdd(spec) {
  const hit = matchInstalled({ spec, id: spec.replace(/^github:/, '') }, installedBundles())
  if (hit) rememberSpec(hit.name, spec)
}

function githubHeaders() {
  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'dsh-plugin-index',
  }
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN
  if (token) headers.Authorization = `Bearer ${token}`
  return headers
}

function mapRepos(repos) {
  return (repos || [])
    .filter((repo) => repo?.full_name && !EXCLUDE.has(repo.full_name))
    .map((repo) => ({
      id: repo.full_name,
      name: repo.name,
      owner: repo.owner?.login,
      description: repo.description || '',
      stars: repo.stargazers_count || 0,
      forks: repo.forks_count || 0,
      updatedAt: repo.updated_at,
      url: repo.html_url,
      spec: `github:${repo.full_name}`,
      language: repo.language || '',
    }))
}

function dedupeCatalog(items) {
  const seen = new Set()
  const out = []
  for (const item of items) {
    if (seen.has(item.id)) continue
    seen.add(item.id)
    out.push(item)
  }
  return out.sort((a, b) => b.stars - a.stars).slice(0, CATALOG_MAX_ITEMS)
}

async function fetchCatalogPage(page) {
  const url = `https://api.github.com/search/repositories?q=topic:dsh-plugin&sort=stars&order=desc&per_page=${CATALOG_PER_PAGE}&page=${page}`
  const res = await fetch(url, { headers: githubHeaders() })
  const text = await res.text()
  if (!res.ok) {
    throw new Error(`GitHub 索引失败 ${res.status}（第 ${page} 页）: ${text.slice(0, 200)}`)
  }
  return JSON.parse(text)
}

async function fetchCatalog(query, fresh) {
  const cachePath = join(storeDir(), 'catalog.json')
  const cached = readJson(cachePath, null)
  const q = (query || '').trim().toLowerCase()
  const filterItems = (items) => {
    if (!q) return items
    return items.filter((item) =>
      `${item.id} ${item.description} ${item.name}`.toLowerCase().includes(q),
    )
  }
  if (!fresh && cached && Date.now() - cached.at < CACHE_MS) {
    return { items: filterItems(cached.items), githubTotal: cached.githubTotal || cached.items.length }
  }

  let first
  try {
    first = await fetchCatalogPage(1)
  } catch (error) {
    if (cached?.items) return { items: filterItems(cached.items), githubTotal: cached.githubTotal || cached.items.length }
    throw error
  }

  const githubTotal = Number(first.total_count) || 0
  const pageCount = Math.min(
    CATALOG_MAX_PAGES,
    Math.max(1, Math.ceil(Math.min(githubTotal, CATALOG_MAX_ITEMS) / CATALOG_PER_PAGE)),
  )
  const collected = [...mapRepos(first.items)]
  for (let page = 2; page <= pageCount; page++) {
    try {
      const body = await fetchCatalogPage(page)
      const batch = mapRepos(body.items)
      collected.push(...batch)
      if (batch.length < CATALOG_PER_PAGE) break
    } catch {
      break
    }
  }

  const items = dedupeCatalog(collected)
  writeJson(cachePath, { at: Date.now(), items, githubTotal })
  return { items: filterItems(items), githubTotal }
}

function findOnPath(names) {
  const dirs = (process.env.PATH || '').split(delimiter)
  for (const dir of dirs) {
    if (!dir) continue
    for (const bin of names) {
      const candidate = join(dir, bin)
      if (existsSync(candidate)) return candidate
    }
  }
  return ''
}

function findPnpm() {
  const extras = [
    join(process.env.APPDATA || '', 'npm', 'pnpm.cmd'),
    join(process.env.LOCALAPPDATA || '', 'pnpm', 'pnpm.exe'),
    join(process.env.LOCALAPPDATA || '', 'pnpm', 'pnpm.cmd'),
  ]
  for (const p of extras) {
    if (p && existsSync(p)) return p
  }
  return findOnPath(process.platform === 'win32' ? ['pnpm.exe', 'pnpm.cmd', 'pnpm'] : ['pnpm']) || (process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm')
}

function isCheckout(dir) {
  return Boolean(dir) && existsSync(join(dir, 'package.json')) && existsSync(join(dir, 'apps', 'cli'))
}

function walkCheckout(start) {
  let dir = start
  while (dir) {
    if (isCheckout(dir)) return dir
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return ''
}

function startDirs() {
  const starts = []
  if (process.env.DSH_CHECKOUT) starts.push(process.env.DSH_CHECKOUT)
  starts.push(process.cwd())
  for (const arg of process.argv) {
    if (!arg || arg.startsWith('-')) continue
    try {
      if (!existsSync(arg)) continue
      starts.push(statSync(arg).isDirectory() ? arg : dirname(arg))
    } catch {
      // argv 项不是本机路径
    }
  }
  return starts
}

function findCheckout() {
  for (const start of startDirs()) {
    const found = isCheckout(start) ? start : walkCheckout(start)
    if (found) return found
  }
  return ''
}

function findDsh() {
  return findOnPath(process.platform === 'win32' ? ['dsh.cmd', 'dsh.exe', 'dsh'] : ['dsh'])
}

function resolveLauncher() {
  const profile = profileName()
  const dsh = findDsh()
  if (dsh) {
    return { cmd: dsh, args: ['plugin', '--profile', profile], cwd: profileDir() }
  }
  const checkout = findCheckout()
  if (checkout) {
    return { cmd: findPnpm(), args: ['dsh', 'plugin', '--profile', profile], cwd: checkout }
  }
  return {
    error: '找不到 dsh CLI。请把 dsh 加入 PATH，或设置 DSH_CHECKOUT 指向含 apps/cli 的源码树。',
  }
}

function runPlugin(args) {
  const launcher = resolveLauncher()
  if (launcher.error) {
    return Promise.resolve({ ok: false, code: 127, log: launcher.error })
  }
  const command = [launcher.cmd, ...launcher.args, ...args]
  const needsShell = process.platform === 'win32' && /\.(cmd|bat)$/i.test(launcher.cmd)
  return new Promise((resolve) => {
    const child = spawn(command[0], command.slice(1), {
      cwd: launcher.cwd,
      shell: needsShell,
      env: process.env,
    })
    let out = ''
    child.stdout?.on('data', (chunk) => { out += chunk })
    child.stderr?.on('data', (chunk) => { out += chunk })
    child.on('error', (error) => {
      resolve({ ok: false, code: 127, log: String(error.message) })
    })
    child.on('close', (code) => {
      resolve({ ok: code === 0, code: code ?? 1, log: out.trim() })
    })
  })
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

export function apply(ctx) {
  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: API,
    handler: async (req, res) => {
      const send = (code, obj) => {
        res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify(obj))
      }
      try {
        const url = new URL(req.url ?? '/', 'http://localhost')
        const path = url.pathname.replace(new RegExp(`^${API}`), '') || '/'

        if (req.method === 'GET' && path === '/catalog') {
          const catalog = await fetchCatalog(url.searchParams.get('q') || '', url.searchParams.get('fresh') === '1')
          const installed = installedBundles()
          return send(200, {
            ok: true,
            indexed: catalog.items.length,
            githubTotal: catalog.githubTotal,
            cap: CATALOG_MAX_ITEMS,
            items: catalog.items.map((item) => {
              const row = matchInstalled(item, installed)
              return {
                ...item,
                installed: Boolean(row),
                packageName: row?.name || '',
                removable: Boolean(row && row.name !== SELF_NAME),
              }
            }),
          })
        }

        if (req.method === 'GET' && path === '/installed') {
          return send(200, { ok: true, items: installedBundles() })
        }

        if (req.method === 'POST' && (path === '/install' || path === '/update' || path === '/repair' || path === '/uninstall')) {
          const body = JSON.parse((await readBody(req)) || '{}')
          const spec = String(body.spec || '').trim()
          const pkg = String(body.name || '').trim()

          if (path === '/uninstall') {
            const resolved = resolvePackageName({ spec, name: pkg })
            if (!resolved) {
              return send(400, { ok: false, error: '无法解析已安装的包名。请到「已安装」里卸载。' })
            }
            if (resolved === SELF_NAME) {
              return send(400, { ok: false, error: '不能卸载插件索引自身。' })
            }
            const result = await runPlugin(['remove', resolved])
            return send(200, { ...result, needRestart: result.ok })
          }

          if (path === '/install') {
            if (!isGithubSpec(spec)) {
              return send(400, { ok: false, error: '安装只接受 github:owner/repo' })
            }
            const result = await runPlugin(['add', spec])
            if (result.ok) rememberAfterAdd(spec)
            return send(200, { ...result, needRestart: result.ok })
          }

          if (path === '/update') {
            const resolved = resolvePackageName({ spec, name: pkg })
            if (!resolved) {
              return send(400, { ok: false, error: '无法解析已安装的包名，更新中止。' })
            }
            const result = await runPlugin(['update', resolved])
            return send(200, { ...result, needRestart: result.ok })
          }

          if (path === '/repair') {
            const resolved = resolvePackageName({ spec, name: pkg })
            const target = (isGithubSpec(spec) && spec)
              || (resolved && (installedBundles().find((row) => row.name === resolved)?.spec || specMap()[resolved]))
              || ''
            if (!target || !(isGithubSpec(target) || isRecordedLink(target))) {
              return send(400, { ok: false, error: '修复只接受 github:owner/repo 或已记录的本地 link。' })
            }
            const result = await runPlugin(['add', target])
            if (result.ok) rememberAfterAdd(target)
            return send(200, { ...result, needRestart: result.ok })
          }
        }

        return send(404, { ok: false, error: 'not found: ' + path })
      } catch (error) {
        return send(500, { ok: false, error: error instanceof Error ? error.message : String(error) })
      }
    },
  }), 'plugin-index: api')
}
