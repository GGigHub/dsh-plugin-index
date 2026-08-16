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
const BODY_MAX = 64 * 1024
const LOG_MAX = 200 * 1024
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

function isRecordedLink(spec, specs) {
  if (!/^(?:link|file):/i.test(spec)) return false
  return Object.values(specs).includes(spec)
}

function matchInstalled(item, installed, specs) {
  const id = item.id || ''
  const spec = item.spec || ''
  return installed.find((row) => (
    row.name === item.packageName
    || row.name === item.name
    || row.spec === spec
    || (id && String(row.spec).includes(id))
    || specs[row.name] === spec
  ))
}

function resolvePackageName({ spec, name }, installed, specs) {
  if (name && PACKAGE_NAME.test(name) && installed.some((row) => row.name === name)) return name
  const hit = matchInstalled({ spec, name, id: spec.replace(/^github:/, '') }, installed, specs)
  if (hit) return hit.name
  if (spec) {
    const remembered = Object.entries(specs).find(([, value]) => value === spec)
    if (remembered) return remembered[0]
  }
  return ''
}

function rememberAfterAdd(spec) {
  const installed = installedBundles()
  const specs = specMap()
  const hit = matchInstalled({ spec, id: spec.replace(/^github:/, '') }, installed, specs)
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

function cacheUsable(cached) {
  return Boolean(
    cached
    && Array.isArray(cached.items)
    && !cached.incomplete
    && Date.now() - cached.at < CACHE_MS,
  )
}

function catalogCachePath() {
  return join(storeDir(), 'catalog.json')
}

function readCatalogCache() {
  return readJson(catalogCachePath(), null)
}

function writeCatalogCache(items, githubTotal) {
  writeJson(catalogCachePath(), { at: Date.now(), items, githubTotal })
}

/** @type {{ generation: number, items: any[], githubTotal: number, complete: boolean, settled: boolean, error: Error | null, firstPage: Promise<void>, promise: Promise<void> } | null} */
let catalogJob = null

function beginCatalogJob() {
  const generation = (catalogJob?.generation || 0) + 1
  let resolveFirst = () => {}
  let firstSignaled = false
  const firstPage = new Promise((resolve) => { resolveFirst = resolve })
  const signalFirst = () => {
    if (firstSignaled) return
    firstSignaled = true
    resolveFirst()
  }
  const job = {
    generation,
    items: [],
    githubTotal: 0,
    complete: false,
    settled: false,
    error: null,
    firstPage,
    promise: Promise.resolve(),
  }
  catalogJob = job
  job.promise = (async () => {
    try {
      const first = await fetchCatalogPage(1)
      if (catalogJob !== job) return
      const githubTotal = Number(first.total_count) || 0
      const pageCount = Math.min(
        CATALOG_MAX_PAGES,
        Math.max(1, Math.ceil(Math.min(githubTotal, CATALOG_MAX_ITEMS) / CATALOG_PER_PAGE)),
      )
      let collected = [...mapRepos(first.items)]
      job.items = dedupeCatalog(collected)
      job.githubTotal = githubTotal
      signalFirst()

      for (let page = 2; page <= pageCount; page++) {
        if (catalogJob !== job) return
        try {
          const body = await fetchCatalogPage(page)
          const batch = mapRepos(body.items)
          collected.push(...batch)
          job.items = dedupeCatalog(collected)
          if (batch.length < CATALOG_PER_PAGE) break
        } catch {
          // 后续页失败：保留已拉取结果，不写完整缓存
          return
        }
      }

      if (catalogJob !== job) return
      job.items = dedupeCatalog(collected)
      job.complete = true
      writeCatalogCache(job.items, githubTotal)
    } catch (error) {
      if (catalogJob !== job) return
      job.error = error instanceof Error ? error : new Error(String(error))
      signalFirst()
    } finally {
      job.settled = true
    }
  })()
  return job
}

function filterCatalogItems(items, query) {
  const q = (query || '').trim().toLowerCase()
  if (!q) return items
  return items.filter((item) =>
    `${item.id} ${item.description} ${item.name}`.toLowerCase().includes(q),
  )
}

function catalogResult(items, githubTotal, partial) {
  return {
    items,
    githubTotal: githubTotal || items.length,
    partial: Boolean(partial),
  }
}

async function fetchCatalog(query, fresh) {
  const cached = readCatalogCache()
  const wrap = (items, githubTotal, partial) =>
    catalogResult(filterCatalogItems(items, query), githubTotal, partial)

  if (!fresh && cacheUsable(cached)) {
    return wrap(cached.items, cached.githubTotal || cached.items.length, false)
  }

  // 后台补全进行中
  if (!fresh && catalogJob && !catalogJob.settled) {
    await catalogJob.firstPage
    if (catalogJob.items.length) {
      const cachedLen = cached?.items?.length || 0
      if (cachedLen > catalogJob.items.length) {
        return wrap(cached.items, cached.githubTotal || cachedLen, true)
      }
      return wrap(catalogJob.items, catalogJob.githubTotal, !catalogJob.complete)
    }
    if (cached?.items?.length) {
      return wrap(cached.items, cached.githubTotal || cached.items.length, true)
    }
    if (catalogJob.error) throw catalogJob.error
  }

  // 过期缓存：先返回；完整成功过的任务在缓存过期后可再后台刷新；中途失败不自动死循环
  if (!fresh && cached?.items?.length) {
    if (catalogJob && !catalogJob.settled) {
      return wrap(cached.items, cached.githubTotal || cached.items.length, true)
    }
    const shouldRefresh = !catalogJob || (catalogJob.complete && !cacheUsable(cached))
    if (shouldRefresh) {
      beginCatalogJob()
      return wrap(cached.items, cached.githubTotal || cached.items.length, true)
    }
    return wrap(cached.items, cached.githubTotal || cached.items.length, false)
  }

  // 最近一次任务已结束但未写完整缓存：直接返回已有片段，避免轮询打爆 API
  if (!fresh && catalogJob?.settled && catalogJob.items.length) {
    return wrap(catalogJob.items, catalogJob.githubTotal, false)
  }

  // 冷启动或强制刷新：至少等到第 1 页
  const job = beginCatalogJob()
  await job.firstPage
  if (job.items.length) {
    return wrap(job.items, job.githubTotal, !job.settled && !job.complete)
  }
  if (cached?.items?.length) {
    return wrap(cached.items, cached.githubTotal || cached.items.length, false)
  }
  if (job.error) throw job.error
  return wrap([], 0, false)
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

function appendLog(out, chunk) {
  if (out.length >= LOG_MAX) return out
  const text = String(chunk)
  if (out.length + text.length <= LOG_MAX) return out + text
  return out + text.slice(0, LOG_MAX - out.length)
}

function killChild(child) {
  if (!child || child.killed || child.pid == null) return
  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
    } else {
      child.kill('SIGTERM')
    }
  } catch {
    try { child.kill('SIGKILL') } catch { /* ignore */ }
  }
}

function spawnPlugin(args, onChunk) {
  const launcher = resolveLauncher()
  if (launcher.error) {
    return {
      promise: Promise.resolve({ ok: false, code: 127, log: launcher.error }),
      kill() {},
    }
  }
  const command = [launcher.cmd, ...launcher.args, ...args]
  const needsShell = process.platform === 'win32' && /\.(cmd|bat)$/i.test(launcher.cmd)
  let child = null
  const promise = new Promise((resolve) => {
    child = spawn(command[0], command.slice(1), {
      cwd: launcher.cwd,
      shell: needsShell,
      env: process.env,
    })
    let out = ''
    const take = (chunk) => {
      out = appendLog(out, chunk)
      if (onChunk) onChunk(chunk)
    }
    child.stdout?.on('data', take)
    child.stderr?.on('data', take)
    child.on('error', (error) => {
      resolve({ ok: false, code: 127, log: String(error.message) })
    })
    child.on('close', (code) => {
      resolve({ ok: code === 0, code: code ?? 1, log: out.trim() })
    })
  })
  return {
    promise,
    kill() { killChild(child) },
  }
}

function runPlugin(args) {
  return spawnPlugin(args).promise
}

const installJobMap = new Map()
let installJobSeq = 0
let installPumpBusy = false

function serializeInstallJob(job) {
  return {
    id: job.id,
    spec: job.spec,
    title: job.title,
    status: job.status,
    log: job.log,
    error: job.error,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    needRestart: Boolean(job.needRestart),
  }
}

function listInstallJobs() {
  return [...installJobMap.values()].map(serializeInstallJob)
}

function enqueueInstallJob(spec, title) {
  const id = String(++installJobSeq)
  const job = {
    id,
    spec,
    title: title || spec.replace(/^github:/, ''),
    status: 'installing',
    log: '排队中…',
    error: '',
    startedAt: Date.now(),
    finishedAt: null,
    needRestart: false,
    cancelled: false,
    started: false,
    kill: null,
  }
  installJobMap.set(id, job)
  void pumpInstallQueue()
  return job
}

async function pumpInstallQueue() {
  if (installPumpBusy) return
  const next = [...installJobMap.values()].find((job) => job.status === 'installing' && !job.started && !job.cancelled)
  if (!next) return
  installPumpBusy = true
  next.started = true
  next.log = '正在安装…\n'
  const { promise, kill } = spawnPlugin(['add', next.spec], (chunk) => {
    if (next.cancelled) return
    if (next.log === '正在安装…\n' || next.log === '排队中…') next.log = ''
    next.log = appendLog(next.log, chunk)
  })
  next.kill = kill
  let result
  try {
    result = await promise
  } catch (error) {
    result = { ok: false, code: 1, log: error instanceof Error ? error.message : String(error) }
  }
  next.kill = null
  if (next.cancelled) {
    installJobMap.delete(next.id)
  } else if (result.ok) {
    rememberAfterAdd(next.spec)
    next.status = 'success'
    next.log = result.log || next.log.trim() || '安装完成'
    next.finishedAt = Date.now()
    next.needRestart = true
  } else {
    next.status = 'failed'
    next.error = result.log || '安装失败'
    next.log = result.log || next.log
    next.finishedAt = Date.now()
  }
  installPumpBusy = false
  void pumpInstallQueue()
}

function cancelInstallJob(id) {
  const job = installJobMap.get(id)
  if (!job) return { ok: false, error: '任务不存在' }
  if (job.status === 'success') return { ok: false, error: '已成功的任务不能取消' }
  if (job.status === 'failed') {
    installJobMap.delete(id)
    return { ok: true }
  }
  job.cancelled = true
  if (job.kill) job.kill()
  if (!job.started) {
    installJobMap.delete(id)
  }
  return { ok: true }
}

function dismissInstallJob(id) {
  const job = installJobMap.get(id)
  if (!job) return { ok: true }
  if (job.status !== 'success') return { ok: false, error: '只能清除成功的任务' }
  installJobMap.delete(id)
  return { ok: true }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    let settled = false
    const fail = (error) => {
      if (settled) return
      settled = true
      reject(error)
      req.destroy()
    }
    req.on('data', (c) => {
      size += c.length
      if (size > BODY_MAX) {
        const error = new Error('request body too large')
        error.statusCode = 413
        fail(error)
        return
      }
      chunks.push(c)
    })
    req.on('end', () => {
      if (settled) return
      settled = true
      resolve(Buffer.concat(chunks).toString('utf8'))
    })
    req.on('error', (error) => {
      if (settled) return
      settled = true
      reject(error)
    })
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
          const specs = specMap()
          return send(200, {
            ok: true,
            indexed: catalog.items.length,
            githubTotal: catalog.githubTotal,
            cap: CATALOG_MAX_ITEMS,
            partial: Boolean(catalog.partial),
            items: catalog.items.map((item) => {
              const row = matchInstalled(item, installed, specs)
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

        if (req.method === 'GET' && path === '/jobs') {
          return send(200, { ok: true, items: listInstallJobs() })
        }

        const jobCancel = path.match(/^\/jobs\/([^/]+)\/cancel$/)
        if (req.method === 'POST' && jobCancel) {
          return send(200, cancelInstallJob(decodeURIComponent(jobCancel[1])))
        }

        const jobDismiss = path.match(/^\/jobs\/([^/]+)\/dismiss$/)
        if (req.method === 'POST' && jobDismiss) {
          return send(200, dismissInstallJob(decodeURIComponent(jobDismiss[1])))
        }

        if (req.method === 'POST' && path === '/jobs/install') {
          let raw
          try {
            raw = await readBody(req)
          } catch (error) {
            if (error?.statusCode === 413) {
              return send(413, { ok: false, error: '请求体过大' })
            }
            throw error
          }
          const body = JSON.parse(raw || '{}')
          const spec = String(body.spec || '').trim()
          const title = String(body.title || body.id || body.name || '').trim()
          if (!isGithubSpec(spec)) {
            return send(400, { ok: false, error: '安装只接受 github:owner/repo' })
          }
          const existing = [...installJobMap.values()].find((job) => (
            job.spec === spec && (job.status === 'installing' || job.status === 'failed')
          ))
          if (existing && existing.status === 'installing') {
            return send(200, { ok: true, jobId: existing.id, deduped: true })
          }
          const job = enqueueInstallJob(spec, title || spec.replace(/^github:/, ''))
          return send(200, { ok: true, jobId: job.id })
        }

        if (req.method === 'POST' && (path === '/install' || path === '/update' || path === '/repair' || path === '/uninstall')) {
          let raw
          try {
            raw = await readBody(req)
          } catch (error) {
            if (error?.statusCode === 413) {
              return send(413, { ok: false, error: '请求体过大' })
            }
            throw error
          }
          const body = JSON.parse(raw || '{}')
          const spec = String(body.spec || '').trim()
          const pkg = String(body.name || '').trim()
          const installed = installedBundles()
          const specs = specMap()

          if (path === '/uninstall') {
            const resolved = resolvePackageName({ spec, name: pkg }, installed, specs)
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
            const resolved = resolvePackageName({ spec, name: pkg }, installed, specs)
            if (!resolved) {
              return send(400, { ok: false, error: '无法解析已安装的包名，更新中止。' })
            }
            const result = await runPlugin(['update', resolved])
            return send(200, { ...result, needRestart: result.ok })
          }

          if (path === '/repair') {
            const resolved = resolvePackageName({ spec, name: pkg }, installed, specs)
            const target = (isGithubSpec(spec) && spec)
              || (resolved && (installed.find((row) => row.name === resolved)?.spec || specs[resolved]))
              || ''
            if (!target || !(isGithubSpec(target) || isRecordedLink(target, specs))) {
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
