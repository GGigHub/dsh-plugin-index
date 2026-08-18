/**
 * dsh-plugin-index — 社区插件索引与生命周期（安装/卸载/更新/修复）。
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import net from 'node:net'
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
/** 按本地缓存里实际出现的功能簇；一条插件可同时属于多类。 */
const CATEGORY_LABELS = {
  ui: '界面',
  desktop: '桌面',
  theme: '主题',
  skill: '技能',
  usage: '用量',
  vision: '视觉',
  browser: '浏览器',
  mcp: 'MCP',
  tool: '工具',
  channel: '渠道',
  memory: '记忆',
  session: '会话',
  security: '安全',
  provider: '模型',
  market: '市场',
  other: '其他',
}
const CATEGORY_ORDER = Object.keys(CATEGORY_LABELS).filter((id) => id !== 'other')
const CATEGORY_IDS = new Set(CATEGORY_ORDER)
const CATEGORY_TOPIC_RE = /^dsh-category-(theme|memory|usage|skill|security|channel|ui|tool|provider|vision|browser|desktop|mcp|market|session|skin)$/i
const GENERIC_TOPICS = new Set([
  'dsh-plugin', 'dsh', 'deepseek-harness', 'deepseek', 'cordis',
  'plugin', 'plugins', 'javascript', 'typescript', 'js', 'ts',
])
const NAME_CATEGORY_HINT = {
  theme: 'theme', skin: 'theme', skins: 'theme', wallpaper: 'theme', pet: 'theme', whale: 'theme',
  memory: 'memory', memories: 'memory',
  usage: 'usage', billing: 'usage', quota: 'usage', balance: 'usage',
  skill: 'skill', skills: 'skill',
  security: 'security', sandbox: 'security', guard: 'security', audit: 'security',
  channel: 'channel', notify: 'channel', notification: 'channel',
  telegram: 'channel', discord: 'channel', slack: 'channel', feishu: 'channel', lark: 'channel',
  dingtalk: 'channel', wechat: 'channel',
  ui: 'ui', tui: 'ui', sidebar: 'ui', overlay: 'ui', webui: 'ui',
  desktop: 'desktop', electron: 'desktop',
  vision: 'vision',
  browser: 'browser',
  mcp: 'mcp',
  tool: 'tool', tools: 'tool', toolkit: 'tool',
  provider: 'provider', adapter: 'provider', llm: 'provider',
  market: 'market', marketplace: 'market', awesome: 'market',
  session: 'session',
}
const TOPIC_ALIAS = { skin: 'theme' }
/** 全部可命中，互不抢占；规则比名称 token 更严，减少描述里的泛词误伤。 */
const CATEGORY_RULES = [
  { id: 'theme', re: /\b(themes?|skins?|wallpapers?)\b/i, cjk: ['主题', '皮肤', '外观', '配色', '桌宠', '鲸鱼娘'] },
  { id: 'memory', re: /\b(memor(?:y|ies)|long[-_ ]term[-_ ]memory)\b/i, cjk: ['记忆', '上下文压缩', '长期记忆'] },
  { id: 'usage', re: /\b(usage|billing|quotas?|token[-_ ]?(stats?|usage|heatmap)|cost[-_ ]?(meter|track(?:ing)?)|balances?)\b/i, cjk: ['用量', '计费', '额度', '余额', 'token统计'] },
  { id: 'skill', re: /\b(skills?|slash[-_ ]?commands?)\b/i, cjk: ['技能'] },
  { id: 'security', re: /\b(sandboxes?|permissions?|audits?|guards?|security)\b/i, cjk: ['安全', '沙箱', '权限', '审计'] },
  { id: 'channel', re: /\b(telegram|discord|slack|wechat|feishu|lark|dingtalk|notifications?|notify|im[-_ ]bridges?)\b/i, cjk: ['渠道', '通知', '飞书', '微信', '钉钉', '企业微信'] },
  { id: 'ui', re: /\b(tui|sidebars?|overlays?|webui|web[-_ ]ui)\b/i, cjk: ['界面', '侧栏', '面板'] },
  { id: 'desktop', re: /\b(desktop[-_ ]?(apps?|clients?|shells?|plugins?)|electron)\b/i, cjk: ['桌面端', '桌面客户端'] },
  { id: 'vision', re: /\b(visions?|ocr)\b/i, cjk: ['视觉', '看图'] },
  { id: 'browser', re: /\b(browser[-_ ]?(automation|use|plugin)s?|chrome[-_ ]extensions?)\b/i, cjk: ['浏览器'] },
  { id: 'mcp', re: /\bmcp\b/i, cjk: ['MCP'] },
  { id: 'tool', re: /\btoolkits?\b/i, cjk: ['工具箱', '工具'] },
  { id: 'provider', re: /\b(llm[-_ ]?(adapters?|providers?)|model[-_ ]providers?)\b/i, cjk: ['模型提供', '模型适配'] },
  { id: 'market', re: /\b(marketplaces?|plugin[-_ ](?:market|index|catalog))\b/i, cjk: ['插件市场', '插件索引', '精选列表'] },
  { id: 'session', re: /\b(session[-_ ](?:manager|plugin|memory))\b/i, cjk: ['跨会话', '会话管理'] },
]
const GITHUB_SPEC = /^github:[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/
const PACKAGE_NAME = /^(?:@[A-Za-z0-9._-]+\/)?[A-Za-z0-9._-]+$/
/** Clash / V2 常见本地 HTTP 代理端口（不含泛用 8080，降低误注入风险） */
const LOCAL_PROXY_PORTS = [7890, 7897, 10809, 10808]
const PROXY_PROBE_MS = 250
const GITHUB_PROBE_MS = 6000
const INSTALL_NETWORK_RETRIES = 2
const INSTALL_RETRY_DELAY_MS = 8000
const NPMRC_DEFAULTS = {
  'fetch-timeout': '300000',
  'fetch-retries': '5',
  'fetch-retry-mintimeout': '20000',
  'fetch-retry-maxtimeout': '120000',
}

/** 已知「根仓不可装、需装子目录」的仓库；key 为 owner/repo（小写）。 */
const MANUAL_INSTALL = {
  'small-tailqwq/dsh-deep-whale': {
    path: '/maid-atelier',
    note: '这是皮肤系列仓：根目录没有 dsh.bundle，市场一键安装不会加载。请按命令安装 maid-atelier 子目录，然后重启 DSH。',
    noteInstalled: '根目录已被装成普通依赖，不会加载。请先卸载，再按命令安装 maid-atelier 子目录，然后重启 DSH。',
  },
}

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

function githubRepoFromSpec(spec) {
  const match = /^github:([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)/i.exec(String(spec || ''))
  return match ? match[1] : ''
}

function githubHtmlUrl(spec) {
  const repo = githubRepoFromSpec(spec)
  return repo ? `https://github.com/${repo}` : ''
}

/** 普通依赖（未入 bundles）时的说明文案与可复制命令。 */
function plainDependencyGuide(spec, { installed = false } = {}) {
  const repo = githubRepoFromSpec(spec)
  if (!repo) {
    return {
      guideText: '已安装为普通依赖（未声明 dsh.bundle），不会进入 profile bundles；重启后通常不会作为插件层加载。请打开仓库 README，按作者说明安装可加载子包。',
      installCommand: '',
      readmeUrl: '',
      url: '',
    }
  }
  const override = MANUAL_INSTALL[repo.toLowerCase()]
  const url = `https://github.com/${repo}`
  const readmeUrl = `${url}#readme`
  const dir = repo.split('/')[1]
  if (override?.path) {
    const sub = String(override.path).replace(/^\//, '')
    const steps = installed
      ? [
        `# 1) 面板「已安装」里先卸载误装的根包`,
        `# 2) 安装可加载子包：`,
        `git clone https://github.com/${repo}`,
        `dsh plugin --profile ${profileName()} add ./${dir}/${sub}`,
        `# 3) 重启 DSH`,
      ]
      : [
        `# 不要点市场「安装」根仓；直接装子目录：`,
        `git clone https://github.com/${repo}`,
        `dsh plugin --profile ${profileName()} add ./${dir}/${sub}`,
        `# 然后重启 DSH`,
      ]
    return {
      url,
      readmeUrl,
      guideText: (installed && override.noteInstalled) || override.note
        || `仓库根目录无 dsh.bundle；请按 README 安装子目录 ${sub}，再重启 DSH。`,
      installCommand: steps.join('\n'),
    }
  }
  return {
    url,
    readmeUrl,
    guideText: installed
      ? '已安装为普通依赖（根目录未声明 dsh.bundle），通常不会作为插件加载。请打开 README 确认可装子目录后手动安装，再重启 DSH。'
      : '该仓库根目录可能没有 dsh.bundle。若安装后显示「未入 bundles」，请打开 README 按子包手动安装。',
    installCommand: [
      `# 请先阅读 README，确认可装子目录后再替换 <子目录>`,
      `git clone https://github.com/${repo}`,
      `dsh plugin --profile ${profileName()} add ./${dir}/<子目录>`,
      `# 然后重启 DSH`,
    ].join('\n'),
  }
}

function withInstalledMeta(row) {
  const url = githubHtmlUrl(row.spec)
  if (row.bundled) {
    return url ? { ...row, url } : row
  }
  const guide = plainDependencyGuide(row.spec, { installed: true })
  return {
    ...row,
    url: guide.url || url || undefined,
    readmeUrl: guide.readmeUrl || undefined,
    guideText: guide.guideText,
    installCommand: guide.installCommand || undefined,
    needsManualInstall: true,
  }
}

function installedBundles() {
  const manifest = readProfileManifest()
  const bundles = manifest.dsh?.profile?.bundles ?? []
  const deps = manifest.dependencies ?? {}
  return Object.entries(deps).map(([pkg, spec]) => withInstalledMeta({
    name: pkg,
    packageName: pkg,
    spec: String(spec),
    installed: true,
    bundled: bundles.includes(pkg),
    present: existsSync(join(profileDir(), 'node_modules', ...pkg.split('/'))),
    removable: pkg !== SELF_NAME,
  }))
}

function plainDependencyPayload(spec) {
  const installed = installedBundles()
  const specs = specMap()
  const hit = matchInstalled({ spec, id: spec.replace(/^github:/i, '') }, installed, specs)
  if (!hit || hit.bundled) return { plainDependency: false }
  return {
    plainDependency: true,
    hint: hit.guideText || '',
    guideText: hit.guideText || '',
    installCommand: hit.installCommand || '',
    readmeUrl: hit.readmeUrl || hit.url || '',
    url: hit.url || '',
  }
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

function classifyCategories(item) {
  const found = new Set()
  const topics = Array.isArray(item.topics) ? item.topics.map((t) => String(t).toLowerCase()) : []
  for (const topic of topics) {
    const match = CATEGORY_TOPIC_RE.exec(topic)
    if (match) found.add(TOPIC_ALIAS[match[1].toLowerCase()] || match[1].toLowerCase())
    if (CATEGORY_IDS.has(topic)) found.add(topic)
    const hinted = NAME_CATEGORY_HINT[topic]
    if (hinted && !GENERIC_TOPICS.has(topic)) found.add(hinted)
  }

  const nameParts = String(item.name || '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
  for (const part of nameParts) {
    if (NAME_CATEGORY_HINT[part]) found.add(NAME_CATEGORY_HINT[part])
  }

  const text = `${item.name || ''} ${item.description || ''} ${topics.join(' ')}`
  for (const rule of CATEGORY_RULES) {
    if (rule.re.test(text) || rule.cjk.some((term) => text.includes(term))) found.add(rule.id)
  }

  const ordered = CATEGORY_ORDER.filter((id) => found.has(id))
  return ordered.length ? ordered : ['other']
}

function publicCatalogItem(item) {
  const categories = classifyCategories(item)
  const categoryLabels = categories.map((id) => CATEGORY_LABELS[id] || CATEGORY_LABELS.other)
  const out = {
    ...item,
    categories,
    categoryLabels,
    category: categories[0],
    categoryLabel: categoryLabels.join(' · '),
  }
  delete out.topics
  return out
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
      topics: Array.isArray(repo.topics) ? repo.topics.map(String) : [],
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
    `${item.id} ${item.description} ${item.name} ${(item.categories || []).join(' ')} ${(item.categoryLabels || []).join(' ')} ${item.category || ''} ${item.categoryLabel || ''}`.toLowerCase().includes(q),
  )
}

function catalogResult(items, githubTotal, partial) {
  const decorated = (items || []).map(publicCatalogItem)
  return {
    items: decorated,
    githubTotal: githubTotal || decorated.length,
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function readEnvProxy(env = process.env) {
  const candidates = [
    env.DSH_HTTPS_PROXY,
    env.DSH_HTTP_PROXY,
    env.HTTPS_PROXY,
    env.https_proxy,
    env.HTTP_PROXY,
    env.http_proxy,
  ]
  let skippedSocks = ''
  for (const raw of candidates) {
    const value = String(raw || '').trim()
    if (!value) continue
    // socks 不适合直接塞进 npm_config_https_proxy / HTTP_PROXY
    if (/^socks/i.test(value)) {
      if (!skippedSocks) skippedSocks = value
      continue
    }
    return { proxy: value, skippedSocks }
  }
  return { proxy: '', skippedSocks }
}

function probeLocalPort(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port })
    let done = false
    const finish = (ok) => {
      if (done) return
      done = true
      try { socket.destroy() } catch { /* ignore */ }
      resolve(ok)
    }
    socket.setTimeout(PROXY_PROBE_MS)
    socket.on('connect', () => finish(true))
    socket.on('timeout', () => finish(false))
    socket.on('error', () => finish(false))
  })
}

async function detectLocalProxyUrl() {
  for (const port of LOCAL_PROXY_PORTS) {
    if (await probeLocalPort(port)) return `http://127.0.0.1:${port}`
  }
  return ''
}

/**
 * 为 pnpm/Node 准备安装环境：透传已有代理，必要时探测本机常见代理端口，
 * 并补齐 NODE_USE_ENV_PROXY / npm_config_*。
 */
async function buildInstallEnv() {
  const env = { ...process.env }
  const found = readEnvProxy(env)
  let proxy = found.proxy
  let detected = false
  if (!proxy) {
    proxy = await detectLocalProxyUrl()
    detected = Boolean(proxy)
  }
  if (proxy) {
    env.HTTP_PROXY = env.HTTP_PROXY || proxy
    env.HTTPS_PROXY = env.HTTPS_PROXY || proxy
    env.http_proxy = env.http_proxy || proxy
    env.https_proxy = env.https_proxy || proxy
    env.NODE_USE_ENV_PROXY = env.NODE_USE_ENV_PROXY || '1'
    env.npm_config_proxy = env.npm_config_proxy || proxy
    env.npm_config_https_proxy = env.npm_config_https_proxy || proxy
  }
  return { env, proxy, detected, skippedSocks: found.skippedSocks || '' }
}

/** 仅补缺失键，不覆盖用户已有 .npmrc 设置。写失败时软忽略，避免拖垮安装队列。 */
function ensureProfileNpmrc() {
  try {
    const path = join(profileDir(), '.npmrc')
    let text = ''
    try {
      if (existsSync(path)) text = readFileSync(path, 'utf8')
    } catch {
      text = ''
    }
    const lines = text ? text.split(/\r?\n/) : []
    const keys = new Set()
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith(';')) continue
      const idx = trimmed.indexOf('=')
      if (idx > 0) keys.add(trimmed.slice(0, idx).trim().toLowerCase())
    }
    const additions = []
    for (const [key, value] of Object.entries(NPMRC_DEFAULTS)) {
      if (!keys.has(key.toLowerCase())) additions.push(`${key}=${value}`)
    }
    if (!additions.length) return false
    const next = (text && !text.endsWith('\n') ? `${text}\n` : text) + additions.join('\n') + '\n'
    writeFileSync(path, next, 'utf8')
    return true
  } catch {
    return false
  }
}

function isNetworkTimeoutLog(log) {
  const text = String(log || '')
  // 要求超时/连接失败类信号，避免仅因日志里出现 codeload URL 就误判 allowBuilds 失败
  return /TimeoutError|operation was aborted due to timeout|error\s*\(23\)|ENOTFOUND|ECONNRESET|ECONNREFUSED|EAI_AGAIN|network\s*socket\s*disconnected|ERR_SOCKET|getaddrinfo\s+ENOTFOUND/i.test(text)
    || (/timed?\s*out/i.test(text) && /codeload\.github\.com|github\.com|fetch|download|GET\s+https?:/i.test(text))
}

function formatInstallFailure(log, { proxy } = {}) {
  const raw = String(log || '').trim() || '安装失败'
  if (!isNetworkTimeoutLog(raw)) return raw
  const tips = [
    '安装失败：从 GitHub（codeload）下载超时或网络中断。',
    proxy
      ? `已尝试经代理 ${proxy} 安装，仍失败。请确认代理可访问 GitHub，或在已配置代理的终端用 CLI 重试。`
      : '未检测到可用代理。请为 DSH 设置 HTTP(S)_PROXY（或 DSH_HTTPS_PROXY），并确保 NODE_USE_ENV_PROXY=1，然后重试。',
    '本次是网络问题，不要按 allowBuilds / prepare 去改 pnpm-workspace.yaml。',
    '',
    '原始日志：',
    raw,
  ]
  return tips.join('\n')
}

async function fetchWithOptionalProxy(url, init, proxy) {
  const options = { ...init }
  if (proxy) {
    try {
      const { ProxyAgent } = await import('node:undici')
      options.dispatcher = new ProxyAgent(proxy)
    } catch {
      // 无 undici 时退回默认 fetch，不阻断安装
    }
  }
  return fetch(url, options)
}

/** 软探测：不通只警告，不阻断安装（避免误杀可达但 HEAD 受限的环境）。 */
async function probeGithubReachable(spec, { proxy } = {}) {
  const repo = githubRepoFromSpec(spec)
  if (!repo) return { ok: true, note: '' }
  const url = `https://github.com/${repo}`
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), GITHUB_PROBE_MS)
    try {
      const res = await fetchWithOptionalProxy(url, {
        method: 'HEAD',
        signal: controller.signal,
        redirect: 'follow',
        headers: { 'User-Agent': 'dsh-plugin-index' },
      }, proxy)
      // 2xx/3xx/404 都说明 GitHub 侧可达
      if (res.ok || res.status === 404 || (res.status >= 300 && res.status < 500)) {
        return { ok: true, note: '' }
      }
      return { ok: false, note: `GitHub 探测返回 HTTP ${res.status}。仍将继续安装。` }
    } finally {
      clearTimeout(timer)
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    return {
      ok: false,
      note: proxy
        ? `探测未成功（${msg}）。已配置代理 ${proxy}，仍将继续安装。`
        : `探测未成功（${msg}）。若本机需要代理，请设置 DSH_HTTPS_PROXY。仍将继续安装。`,
    }
  }
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

function spawnPlugin(args, onChunk, envOverride) {
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
      env: envOverride || process.env,
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

async function runPlugin(args, options = {}) {
  const network = options.network !== false && args.some((a) => a === 'add' || a === 'update')
  let env = process.env
  let proxy = ''
  if (network) {
    ensureProfileNpmrc()
    const built = await buildInstallEnv()
    env = built.env
    proxy = built.proxy
  }
  const result = await spawnPlugin(args, undefined, env).promise
  if (!result.ok && network) {
    return { ...result, log: formatInstallFailure(result.log, { proxy }), proxy }
  }
  return { ...result, proxy }
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
    plainDependency: Boolean(job.plainDependency),
    hint: job.hint || '',
    attempts: job.attempts || 0,
    networkHint: job.networkHint || '',
  }
}

function listInstallJobs() {
  return [...installJobMap.values()].map(serializeInstallJob)
}

function hasActiveInstall() {
  return [...installJobMap.values()].some((job) => job.status === 'installing')
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
    startedAt: null,
    finishedAt: null,
    needRestart: false,
    plainDependency: false,
    hint: '',
    attempts: 0,
    networkHint: '',
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
  next.startedAt = Date.now()
  next.log = '正在准备安装…\n'

  let proxy = ''
  try {
    ensureProfileNpmrc()
    const built = await buildInstallEnv()
    const env = built.env
    proxy = built.proxy
    const detected = built.detected
    if (next.cancelled) {
      installJobMap.delete(next.id)
      return
    }

    if (proxy) {
      next.networkHint = detected ? `已自动使用本机代理 ${proxy}` : `使用代理 ${proxy}`
      next.log = appendLog(next.log, `${next.networkHint}\n`)
    } else if (built.skippedSocks) {
      next.networkHint = '已忽略 SOCKS 代理（npm/pnpm 无法使用），请改用 HTTP(S) 代理或设置 DSH_HTTPS_PROXY'
      next.log = appendLog(next.log, `${next.networkHint}\n`)
    } else {
      next.networkHint = '未检测到代理；若 GitHub 较慢，安装可能超时'
      next.log = appendLog(next.log, `${next.networkHint}\n`)
    }

    const probe = await probeGithubReachable(next.spec, { proxy })
    if (next.cancelled) {
      installJobMap.delete(next.id)
      return
    }
    if (!probe.ok && probe.note) {
      next.log = appendLog(next.log, `${probe.note}\n`)
    }

    let result = { ok: false, code: 1, log: '' }
    const maxAttempts = 1 + INSTALL_NETWORK_RETRIES
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      if (next.cancelled) break
      next.attempts = attempt
      if (attempt > 1) {
        next.log = appendLog(next.log, `\n网络超时，正在重试（${attempt}/${maxAttempts}）…\n`)
        await sleep(INSTALL_RETRY_DELAY_MS)
        if (next.cancelled) break
      } else {
        next.log = appendLog(next.log, '正在安装…\n')
      }

      const attemptLogStart = next.log.length
      const { promise, kill } = spawnPlugin(['add', next.spec], (chunk) => {
        if (next.cancelled) return
        next.log = appendLog(next.log, chunk)
      }, env)
      next.kill = kill
      try {
        result = await promise
      } catch (error) {
        result = { ok: false, code: 1, log: error instanceof Error ? error.message : String(error) }
      }
      next.kill = null

      if (next.cancelled || result.ok) break
      const attemptLog = next.log.slice(attemptLogStart) || result.log
      if (!isNetworkTimeoutLog(attemptLog) && !isNetworkTimeoutLog(result.log)) break
    }

    if (next.cancelled) {
      installJobMap.delete(next.id)
    } else if (result.ok) {
      rememberAfterAdd(next.spec)
      const plain = plainDependencyPayload(next.spec)
      const hint = plain.hint || ''
      const cmd = plain.installCommand ? `\n\n手动安装命令：\n${plain.installCommand}` : ''
      next.status = 'success'
      next.hint = hint
      next.plainDependency = Boolean(plain.plainDependency)
      next.log = (next.log.trim() || result.log || '安装完成') + (hint ? `\n${hint}` : '') + cmd
      next.finishedAt = Date.now()
      next.needRestart = true
    } else {
      const raw = next.log.trim() || result.log || '安装失败'
      next.status = 'failed'
      next.error = formatInstallFailure(raw, { proxy })
      next.log = next.error
      next.finishedAt = Date.now()
    }
  } catch (error) {
    if (next.cancelled) {
      installJobMap.delete(next.id)
    } else {
      const msg = error instanceof Error ? error.message : String(error)
      next.status = 'failed'
      next.error = msg
      next.log = appendLog(next.log || '', `\n${msg}`)
      next.finishedAt = Date.now()
    }
  } finally {
    next.kill = null
    installPumpBusy = false
    void pumpInstallQueue()
  }
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

function retryInstallJob(id) {
  const job = installJobMap.get(id)
  if (!job) return { ok: false, error: '任务不存在' }
  if (job.status !== 'failed') return { ok: false, error: '只能重试失败的任务' }
  const spec = job.spec
  const title = job.title
  installJobMap.delete(id)
  const next = enqueueInstallJob(spec, title)
  return { ok: true, jobId: next.id }
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
              const guide = (!row || !row.bundled)
                ? plainDependencyGuide(item.spec || (item.id ? `github:${item.id}` : ''), {
                  installed: Boolean(row && !row.bundled),
                })
                : null
              const knownManual = Boolean(MANUAL_INSTALL[String(item.id || '').toLowerCase()])
              const showGuide = Boolean((row && !row.bundled) || knownManual)
              return {
                ...item,
                installed: Boolean(row),
                packageName: row?.name || '',
                removable: Boolean(row && row.name !== SELF_NAME),
                bundled: row ? row.bundled : undefined,
                ...(showGuide ? {
                  guideText: (row && row.guideText) || guide?.guideText || '',
                  installCommand: (row && row.installCommand) || guide?.installCommand || '',
                  readmeUrl: (row && row.readmeUrl) || guide?.readmeUrl || item.url || '',
                  needsManualInstall: knownManual || Boolean(row && !row.bundled),
                } : {}),
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

        const jobRetry = path.match(/^\/jobs\/([^/]+)\/retry$/)
        if (req.method === 'POST' && jobRetry) {
          return send(200, retryInstallJob(decodeURIComponent(jobRetry[1])))
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
          if (existing && existing.status === 'failed') {
            return send(200, retryInstallJob(existing.id))
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

          if (path === '/uninstall' || path === '/update' || path === '/repair' || path === '/install') {
            if (hasActiveInstall()) {
              return send(409, { ok: false, error: '安装队列进行中，请等待完成或取消后再操作。' })
            }
          }

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
            if (result.ok) {
              rememberAfterAdd(spec)
              const plain = plainDependencyPayload(spec)
              const hint = plain.hint ? `\n${plain.hint}` : ''
              const cmd = plain.installCommand ? `\n\n手动安装命令：\n${plain.installCommand}` : ''
              return send(200, {
                ...result,
                needRestart: true,
                ...plain,
                log: (result.log || '') + hint + cmd,
              })
            }
            return send(200, { ...result, needRestart: false })
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
            if (result.ok) {
              rememberAfterAdd(target)
              const plain = plainDependencyPayload(target)
              const hint = plain.hint ? `\n${plain.hint}` : ''
              const cmd = plain.installCommand ? `\n\n手动安装命令：\n${plain.installCommand}` : ''
              return send(200, {
                ...result,
                needRestart: true,
                ...plain,
                log: (result.log || '') + hint + cmd,
              })
            }
            return send(200, { ...result, needRestart: false })
          }
        }

        return send(404, { ok: false, error: 'not found: ' + path })
      } catch (error) {
        return send(500, { ok: false, error: error instanceof Error ? error.message : String(error) })
      }
    },
  }), 'plugin-index: api')
}
