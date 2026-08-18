window.__ModuleLoader__.load({
  id: '@dsh-external/dsh-plugin-index',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    var React = require('react')
    var ReactDOM = require('react-dom')
    var createElement = React.createElement
    var useEffect = React.useEffect
    var useState = React.useState
    var createPortal = ReactDOM.createPortal

    var API = '/plugin-index/api'

    function json(path, init) {
      return fetch(API + path, {
        headers: { 'content-type': 'application/json' },
        ...init,
      }).then(function (r) { return r.json() })
    }

    function fmtStars(n) {
      if (n >= 1000) return (n / 1000).toFixed(1) + 'k'
      return String(n)
    }

    function copyText(text) {
      var value = String(text || '')
      if (!value) return Promise.resolve(false)
      if (navigator.clipboard && navigator.clipboard.writeText) {
        return navigator.clipboard.writeText(value).then(function () { return true }).catch(function () { return false })
      }
      try {
        var area = document.createElement('textarea')
        area.value = value
        area.setAttribute('readonly', '')
        area.style.position = 'fixed'
        area.style.left = '-9999px'
        document.body.appendChild(area)
        area.select()
        var ok = document.execCommand('copy')
        document.body.removeChild(area)
        return Promise.resolve(ok)
      } catch {
        return Promise.resolve(false)
      }
    }

    function needsManualHelp(item) {
      return Boolean(item && (item.bundled === false || item.needsManualInstall || item.installCommand || item.guideText))
    }

    function fmtElapsed(job, now) {
      if (!job.startedAt) return '排队'
      var end = job.finishedAt || now
      var sec = Math.max(0, Math.round((end - job.startedAt) / 1000))
      if (sec < 60) return sec + 's'
      return Math.floor(sec / 60) + 'm ' + (sec % 60) + 's'
    }

    function statusLabel(status) {
      if (status === 'success') return '成功'
      if (status === 'failed') return '失败'
      return '安装中'
    }

    function statusTagStyle(status) {
      if (status === 'success') return overlay.tagOn
      if (status === 'failed') return overlay.tagDanger
      return overlay.tagWarn
    }

    var PAGE_SIZE = 50
    var CATEGORIES = [
      { id: 'all', label: '全部' },
      { id: 'ui', label: '界面' },
      { id: 'desktop', label: '桌面' },
      { id: 'theme', label: '主题' },
      { id: 'skill', label: '技能' },
      { id: 'usage', label: '用量' },
      { id: 'vision', label: '视觉' },
      { id: 'browser', label: '浏览器' },
      { id: 'mcp', label: 'MCP' },
      { id: 'tool', label: '工具' },
      { id: 'channel', label: '渠道' },
      { id: 'memory', label: '记忆' },
      { id: 'session', label: '会话' },
      { id: 'security', label: '安全' },
      { id: 'provider', label: '模型' },
      { id: 'market', label: '市场' },
      { id: 'other', label: '其他' },
    ]

    function itemCategories(item) {
      if (item && Array.isArray(item.categories) && item.categories.length) return item.categories
      if (item && item.category) return [item.category]
      return ['other']
    }

    function itemCategoryLabels(item) {
      if (item && Array.isArray(item.categoryLabels) && item.categoryLabels.length) return item.categoryLabels
      if (item && item.categoryLabel) return String(item.categoryLabel).split(' · ')
      return ['其他']
    }

    function categoryOf(item, lookup) {
      if (!item) return item
      if (Array.isArray(item.categories) && item.categories.length) return item
      var hit = lookup && (lookup[item.spec] || lookup[item.id] || lookup[item.name] || lookup[item.packageName])
      if (hit) {
        return Object.assign({}, item, {
          categories: itemCategories(hit),
          categoryLabels: itemCategoryLabels(hit),
          category: hit.category,
          categoryLabel: hit.categoryLabel,
        })
      }
      return Object.assign({}, item, {
        categories: ['other'],
        categoryLabels: ['其他'],
        category: 'other',
        categoryLabel: '其他',
      })
    }

    function Overlay(props) {
      var onClose = props.onClose
      var query = props.query
      var setQuery = props.setQuery
      var tab = props.tab
      var setTab = props.setTab
      var catalog = props.catalog
      var installed = props.installed
      var jobs = props.jobs
      var loading = props.loading
      var log = props.log
      var busy = props.busy
      var onSearch = props.onSearch
      var onAction = props.onAction
      var onGuide = props.onGuide
      var onCopyInstall = props.onCopyInstall
      var onCancelJob = props.onCancelJob
      var onRetryJob = props.onRetryJob
      var githubTotal = props.githubTotal
      var partial = props.partial
      var now = props.now
      var needRestartSticky = props.needRestartSticky
      var pageState = useState(1)
      var page = pageState[0]
      var setPage = pageState[1]
      var categoryState = useState('all')
      var category = categoryState[0]
      var setCategory = categoryState[1]

      useEffect(function () {
        function onKey(e) {
          if (e.key === 'Escape') onClose()
        }
        window.addEventListener('keydown', onKey)
        return function () { window.removeEventListener('keydown', onKey) }
      }, [onClose])

      var qn = (query || '').trim().toLowerCase()
      var isJobs = tab === 'jobs'
      var showCategories = tab === 'catalog' || tab === 'installed'
      var catLookup = {}
      catalog.forEach(function (item) {
        if (item.spec) catLookup[item.spec] = item
        if (item.id) catLookup[item.id] = item
        if (item.name) catLookup[item.name] = item
        if (item.packageName) catLookup[item.packageName] = item
      })
      var source = tab === 'installed'
        ? installed.map(function (item) { return categoryOf(item, catLookup) })
        : tab === 'jobs' ? jobs : catalog
      var sourceKey = (source[0] && (source[0].id || source[0].name || source[0].spec)) || ''
      var searched = !qn ? source : source.filter(function (item) {
        return ((item.id || '') + ' ' + (item.name || '') + ' ' + (item.title || '') + ' ' + (item.description || '') + ' ' + (item.spec || '') + ' ' + itemCategories(item).join(' ') + ' ' + itemCategoryLabels(item).join(' ') + ' ' + (item.error || '') + ' ' + (item.log || '')).toLowerCase().includes(qn)
      })
      var categoryCounts = {}
      CATEGORIES.forEach(function (c) { categoryCounts[c.id] = 0 })
      searched.forEach(function (item) {
        itemCategories(item).forEach(function (id) {
          categoryCounts[id] = (categoryCounts[id] || 0) + 1
        })
      })
      categoryCounts.all = searched.length
      var rows = !showCategories || category === 'all'
        ? searched
        : searched.filter(function (item) { return itemCategories(item).indexOf(category) >= 0 })
      var activeCategory = CATEGORIES.find(function (c) { return c.id === category }) || CATEGORIES[0]
      var pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE))
      var safePage = Math.min(page, pageCount)
      var from = rows.length === 0 ? 0 : (safePage - 1) * PAGE_SIZE + 1
      var to = Math.min(rows.length, safePage * PAGE_SIZE)
      var visible = rows.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)

      var installingSpecs = {}
      jobs.forEach(function (job) {
        if (job.status === 'installing' && job.spec) installingSpecs[job.spec] = true
      })

      var jobsActive = jobs.filter(function (job) { return job.status === 'installing' }).length
      var jobsFailed = jobs.filter(function (job) { return job.status === 'failed' }).length
      var jobsSuccess = jobs.filter(function (job) { return job.status === 'success' }).length
      var needRestart = Boolean(needRestartSticky) || jobs.some(function (job) { return job.status === 'success' && job.needRestart })
      var jobsNetworkFailed = jobs.some(function (job) {
        return job.status === 'failed' && /codeload|下载超时|网络中断|未检测到可用代理|SOCKS/.test(job.error || job.log || '')
      })
      var queueBusy = jobsActive > 0

      useEffect(function () {
        setPage(1)
      }, [tab, qn, source.length, sourceKey, category])

      var subText = isJobs
        ? ('安装队列 · ' + jobs.length + ' 项' + (jobsActive ? ' · ' + jobsActive + ' 进行中' : '') + (jobsFailed ? ' · ' + jobsFailed + ' 失败' : '') + (jobsSuccess ? ' · ' + jobsSuccess + ' 成功' : ''))
        : (
          '按 GitHub 星标排序 · topic: dsh-plugin · 已索引 ' + (tab === 'installed' ? installed.length : catalog.length) + ' 个' +
          (tab === 'catalog' && githubTotal ? ' / GitHub ' + githubTotal : '') +
          '（上限 1000）' +
          (showCategories && category !== 'all' ? ' · ' + activeCategory.label + ' ' + rows.length : '') +
          (showCategories ? ' · 同一插件可属多个分类' : '') +
          (tab === 'catalog' && partial ? ' · 正在补全…' : '')
        )

      var jobsTabLabel = '安装中' + (jobsActive || jobsFailed ? ' (' + (jobsActive + jobsFailed) + ')' : '')

      return createPortal(createElement('div', {
        style: overlay.mask,
        onClick: function (e) { if (e.target === e.currentTarget) onClose() },
      },
        createElement('div', { style: overlay.panel },
          createElement('div', { style: overlay.head },
            createElement('div', null,
              createElement('div', { style: overlay.title }, '插件索引'),
              createElement('div', { style: overlay.sub }, subText),
            ),
            createElement('button', { type: 'button', style: overlay.iconBtn, onClick: onClose }, '关闭'),
          ),
          createElement('div', { style: overlay.toolbar },
            createElement('input', {
              style: overlay.input,
              value: query,
              placeholder: isJobs ? '搜索安装任务' : '搜索仓库名、描述或分类（本地过滤）',
              onChange: function (e) { setQuery(e.target.value) },
              onKeyDown: function (e) { if (e.key === 'Enter' && !isJobs) onSearch() },
            }),
            !isJobs && createElement('button', {
              type: 'button',
              style: overlay.btn,
              onClick: onSearch,
              disabled: loading && !catalog.length,
            }, loading && !catalog.length ? '刷新中…' : (partial ? '补全中…' : '刷新')),
            createElement('button', {
              type: 'button',
              style: tab === 'catalog' ? overlay.btnActive : overlay.btnGhost,
              onClick: function () { setTab('catalog') },
            }, '市场'),
            createElement('button', {
              type: 'button',
              style: tab === 'installed' ? overlay.btnActive : overlay.btnGhost,
              onClick: function () { setTab('installed') },
            }, '已安装'),
            createElement('button', {
              type: 'button',
              style: tab === 'jobs' ? overlay.btnActive : overlay.btnGhost,
              onClick: function () { setTab('jobs') },
            }, jobsTabLabel),
          ),
          showCategories && createElement('div', { style: overlay.filters },
            CATEGORIES.map(function (c) {
              var count = categoryCounts[c.id] || 0
              var active = category === c.id
              return createElement('button', {
                key: c.id,
                type: 'button',
                style: Object.assign({}, active ? overlay.chipActive : overlay.chip, (c.id !== 'all' && count === 0) ? { opacity: 0.4, cursor: 'default' } : {}),
                disabled: c.id !== 'all' && count === 0,
                onClick: function () { setCategory(c.id) },
              }, c.label + (c.id === 'all' ? ' ' + searched.length : ' ' + count))
            }),
          ),
          needRestart && createElement('div', { style: overlay.banner },
            '有插件已写入 profile，请用启动器重启 DSH 后生效。',
          ),
          isJobs && jobsNetworkFailed && createElement('div', { style: overlay.bannerWarn },
            '安装失败若提示 GitHub / codeload 超时，请确认本机代理可用（或设置 DSH_HTTPS_PROXY），然后点「重试」。这通常不是 allowBuilds 问题。',
          ),
          isJobs ? createElement('div', { key: 'jobs-' + safePage + '-' + qn, style: overlay.list },
            rows.length === 0 && createElement('div', { style: overlay.empty }, '暂无安装任务。在「市场」点击安装后会出现在这里。'),
            visible.map(function (job) {
              var logTail = (job.error || job.log || job.hint || '').trim()
              if (logTail.length > 800) logTail = '…' + logTail.slice(-800)
              return createElement('div', { key: job.id, style: overlay.card },
                createElement('div', { style: overlay.cardMain },
                  createElement('div', { style: overlay.cardTitle },
                    job.title || job.spec,
                    createElement('span', { style: statusTagStyle(job.status) }, statusLabel(job.status)),
                    job.plainDependency ? createElement('span', { style: overlay.tagWarn }, '普通依赖') : null,
                  ),
                  createElement('div', { style: overlay.meta },
                    job.spec || '',
                    '  ·  耗时 ' + fmtElapsed(job, now),
                    job.attempts > 1 ? ('  ·  尝试 ' + job.attempts + ' 次') : '',
                    job.networkHint ? ('  ·  ' + job.networkHint) : '',
                  ),
                  logTail ? createElement('pre', { style: overlay.jobLog }, logTail) : null,
                ),
                createElement('div', { style: overlay.actions },
                  job.status === 'failed' && createElement('button', {
                    type: 'button',
                    style: overlay.btn,
                    onClick: function () { onRetryJob(job) },
                  }, '重试'),
                  job.status !== 'success' && createElement('button', {
                    type: 'button',
                    style: overlay.btnDanger,
                    onClick: function () { onCancelJob(job) },
                  }, job.status === 'failed' ? '清除' : '取消'),
                ),
              )
            }),
          ) : createElement('div', { key: tab + '-' + safePage + '-' + qn + '-' + category, style: overlay.list },
            loading && source.length === 0 && createElement('div', { style: overlay.empty }, '正在拉取索引…'),
            !loading && rows.length === 0 && createElement('div', { style: overlay.empty },
              tab === 'installed'
                ? (category !== 'all' ? '已安装里没有该分类的插件。' : '还没有通过 profile 安装的第三方插件。')
                : (category !== 'all' ? '该分类下没有匹配的插件。' : '没有匹配的插件。')
            ),
            !(loading && source.length === 0) && visible.map(function (item) {
              var key = item.id || item.name
              var title = item.id || item.packageName || item.name
              var desc = item.description || item.spec || ''
              var pkg = item.packageName || item.name || ''
              var isOn = Boolean(item.installed || item.bundled || (tab === 'installed' && item.name))
              var canUninstall = item.removable !== false && pkg && pkg !== '@dsh-external/dsh-plugin-index'
              var showManual = needsManualHelp(item)
              var inQueue = Boolean(item.spec && installingSpecs[item.spec])
              var blockRootInstall = Boolean(!isOn && item.needsManualInstall)
              return createElement('div', { key: key, style: overlay.card },
                createElement('div', { style: overlay.cardMain },
                  createElement('div', { style: overlay.cardTitle },
                    title,
                    itemCategoryLabels(item).map(function (label) {
                      return createElement('span', { key: label, style: overlay.tagCat }, label)
                    }),
                    isOn ? createElement('span', { style: overlay.tagOn }, '已安装') : null,
                    inQueue ? createElement('span', { style: overlay.tagWarn }, '安装中') : null,
                    item.bundled === false ? createElement('span', { style: overlay.tagWarn }, '未入 bundles') : null,
                    !isOn && item.needsManualInstall ? createElement('span', { style: overlay.tagWarn }, '需手动装子包') : null,
                    item.present === false ? createElement('span', { style: overlay.tagWarn }, '文件缺失') : null,
                  ),
                  createElement('div', { style: overlay.cardDesc }, desc),
                  showManual && item.guideText
                    ? createElement('div', { style: overlay.guide }, item.guideText)
                    : null,
                  createElement('div', { style: overlay.meta },
                    item.stars != null ? ('★ ' + fmtStars(item.stars)) : null,
                    item.forks != null ? ('  ·  fork ' + item.forks) : null,
                    item.language ? ('  ·  ' + item.language) : null,
                    item.spec ? ('  ·  ' + item.spec) : null,
                  ),
                ),
                createElement('div', { style: overlay.actions },
                  !isOn && tab !== 'installed' && createElement('button', {
                    type: 'button',
                    style: overlay.btn,
                    disabled: busy || inQueue || blockRootInstall,
                    title: blockRootInstall ? '根仓通常无法加载，请用「安装说明」或复制命令装子目录' : '',
                    onClick: function () { onAction('install', item) },
                  }, blockRootInstall ? '请手动装' : (inQueue ? '安装中' : '安装')),
                  isOn && createElement('button', {
                    type: 'button',
                    style: overlay.btnGhost,
                    disabled: busy || queueBusy,
                    title: queueBusy ? '安装队列进行中，请等待完成或取消后再操作' : '',
                    onClick: function () { onAction('update', item) },
                  }, '更新'),
                  isOn && createElement('button', {
                    type: 'button',
                    style: overlay.btnGhost,
                    disabled: busy || queueBusy,
                    title: queueBusy ? '安装队列进行中，请等待完成或取消后再操作' : '',
                    onClick: function () { onAction('repair', item) },
                  }, '修复'),
                  isOn && canUninstall && createElement('button', {
                    type: 'button',
                    style: overlay.btnDanger,
                    disabled: busy || queueBusy,
                    title: queueBusy ? '安装队列进行中，请等待完成或取消后再操作' : '',
                    onClick: function () {
                      if (!window.confirm('确定卸载 ' + (item.packageName || item.name || item.id) + '？')) return
                      onAction('uninstall', item)
                    },
                  }, '卸载'),
                  showManual && createElement('button', {
                    type: 'button', style: overlay.btnGhost,
                    onClick: function () { onGuide(item) },
                  }, '安装说明'),
                  showManual && item.installCommand && createElement('button', {
                    type: 'button', style: overlay.btnGhost,
                    onClick: function () { onCopyInstall(item) },
                  }, String(item.installCommand).indexOf('<子目录>') >= 0 ? '复制安装模板' : '复制安装命令'),
                  item.url && createElement('a', {
                    href: item.url, target: '_blank', rel: 'noreferrer', style: overlay.link,
                  }, '仓库'),
                ),
              )
            }),
          ),
          !isJobs && !(loading && source.length === 0) && rows.length > 0 && createElement('div', { style: overlay.pager },
            createElement('button', {
              type: 'button', style: overlay.btnGhost, disabled: safePage <= 1,
              onClick: function () { setPage(safePage - 1) },
            }, '上一页'),
            createElement('span', { style: overlay.pagerText },
              from + '–' + to + ' / ' + rows.length + ' · 第 ' + safePage + '/' + pageCount + ' 页',
            ),
            createElement('button', {
              type: 'button', style: overlay.btnGhost, disabled: safePage >= pageCount,
              onClick: function () { setPage(safePage + 1) },
            }, '下一页'),
          ),
          createElement('pre', { style: overlay.log }, log || '安装会进入「安装中」列表；超时会自动重试，也可手动重试。更新、修复、卸载后需要重启 DSH 才会生效。'),
        ),
      ), document.body)
    }

    function FooterButton(props) {
      var wide = props.wide
      var open = useState(false)
      var isOpen = open[0]
      var setOpen = open[1]
      var query = useState('')
      var q = query[0]
      var setQuery = query[1]
      var tab = useState('catalog')
      var t = tab[0]
      var setTab = tab[1]
      var catalog = useState([])
      var items = catalog[0]
      var setItems = catalog[1]
      var installed = useState([])
      var inst = installed[0]
      var setInst = installed[1]
      var jobsState = useState([])
      var jobs = jobsState[0]
      var setJobs = jobsState[1]
      var jobsRef = useState({ current: [] })[0]
      var loading = useState(false)
      var busyLoad = loading[0]
      var setLoading = loading[1]
      var busy = useState(false)
      var isBusy = busy[0]
      var setBusy = busy[1]
      var log = useState('')
      var msg = log[0]
      var setLog = log[1]
      var total = useState(0)
      var githubTotal = total[0]
      var setGithubTotal = total[1]
      var partialState = useState(false)
      var partial = partialState[0]
      var setPartial = partialState[1]
      var nowState = useState(Date.now())
      var now = nowState[0]
      var setNow = nowState[1]
      var restartState = useState(false)
      var needRestartSticky = restartState[0]
      var setNeedRestartSticky = restartState[1]
      var reqSeq = useState({ catalog: 0, installed: 0, jobs: 0 })[0]
      var pollTimer = useState({ id: 0 })[0]
      var jobPollTimer = useState({ id: 0 })[0]
      var jobsTabVisit = useState({ active: false })[0]

      var clearPoll = function () {
        if (pollTimer.id) {
          clearTimeout(pollTimer.id)
          pollTimer.id = 0
        }
      }

      var clearJobPoll = function () {
        if (jobPollTimer.id) {
          clearTimeout(jobPollTimer.id)
          jobPollTimer.id = 0
        }
      }

      var loadCatalog = function (fresh, quiet) {
        var seq = ++reqSeq.catalog
        clearPoll()
        if (!quiet) setLoading(true)
        json('/catalog' + (fresh ? '?fresh=1' : ''))
          .then(function (d) {
            if (seq !== reqSeq.catalog) return
            if (!d.ok) throw new Error(d.error || 'catalog failed')
            setItems(d.items || [])
            setGithubTotal(d.githubTotal || (d.items || []).length)
            var isPartial = Boolean(d.partial)
            setPartial(isPartial)
            if (isPartial) {
              pollTimer.id = setTimeout(function () {
                if (seq !== reqSeq.catalog) return
                loadCatalog(false, true)
              }, 900)
            }
          })
          .catch(function (e) {
            if (seq !== reqSeq.catalog) return
            setLog(String(e.message || e))
            setPartial(false)
          })
          .finally(function () {
            if (seq !== reqSeq.catalog) return
            if (!quiet) setLoading(false)
          })
      }

      var loadInstalled = function () {
        var seq = ++reqSeq.installed
        json('/installed')
          .then(function (d) {
            if (seq !== reqSeq.installed) return
            if (!d.ok) throw new Error(d.error || 'installed failed')
            setInst(d.items || [])
          })
          .catch(function (e) {
            if (seq !== reqSeq.installed) return
            setLog(String(e.message || e))
          })
      }

      var loadJobs = function () {
        var seq = ++reqSeq.jobs
        return json('/jobs')
          .then(function (d) {
            if (seq !== reqSeq.jobs) return []
            if (!d.ok) throw new Error(d.error || 'jobs failed')
            var list = d.items || []
            var prev = jobsRef.current
            jobsRef.current = list
            setJobs(list)
            setNow(Date.now())
            var justFinished = list.filter(function (job) {
              if (job.status !== 'success' && job.status !== 'failed') return false
              var before = prev.find(function (row) { return row.id === job.id })
              return !before || before.status === 'installing'
            }).sort(function (a, b) { return (b.finishedAt || 0) - (a.finishedAt || 0) })
            if (justFinished.length) {
              var doneJob = justFinished[0]
              var doneTitle = doneJob.title || doneJob.spec
              if (doneJob.status === 'success') {
                setNeedRestartSticky(true)
                setLog(doneJob.plainDependency
                  ? ('安装完成，但装成了普通依赖（未入 bundles）：' + doneTitle
                    + '。市场安装通常不能直接当插件用，请到市场/已安装用「安装说明 / 复制安装命令」。')
                  : ('安装完成：' + doneTitle + '。请用启动器重启 DSH 后生效。'))
              } else {
                setLog('安装失败：' + doneTitle + '\n' + (doneJob.error || doneJob.log || ''))
              }
              loadCatalog(false, true)
              loadInstalled()
            }
            clearJobPoll()
            var hasInstalling = list.some(function (job) { return job.status === 'installing' })
            if (hasInstalling) {
              jobPollTimer.id = setTimeout(function () {
                if (seq !== reqSeq.jobs) return
                loadJobs()
              }, 900)
            }
            return list
          })
          .catch(function (e) {
            if (seq !== reqSeq.jobs) return []
            setLog(String(e.message || e))
            return []
          })
      }

      var dismissSuccessJobs = function (list) {
        var successes = (list || []).filter(function (job) { return job.status === 'success' })
        if (!successes.length) return Promise.resolve()
        return Promise.all(successes.map(function (job) {
          return json('/jobs/' + encodeURIComponent(job.id) + '/dismiss', { method: 'POST' })
        })).then(function () { return loadJobs() })
      }

      useEffect(function () {
        if (!isOpen) {
          clearPoll()
          clearJobPoll()
          jobsTabVisit.active = false
          return
        }
        loadCatalog(false)
        loadInstalled()
        loadJobs()
        return function () {
          clearPoll()
          clearJobPoll()
        }
      }, [isOpen])

      useEffect(function () {
        if (!isOpen || t !== 'jobs') {
          if (t !== 'jobs') jobsTabVisit.active = false
          return
        }
        if (jobsTabVisit.active) return
        jobsTabVisit.active = true
        loadJobs().then(function (list) {
          return dismissSuccessJobs(list)
        })
      }, [isOpen, t])

      var onAction = function (kind, item) {
        if (kind === 'install') {
          setLog('已加入安装队列：' + (item.id || item.spec || item.name))
          json('/jobs/install', {
            method: 'POST',
            body: JSON.stringify({
              spec: item.spec,
              title: item.id || item.packageName || item.name || '',
              id: item.id || '',
            }),
          })
            .then(function (d) {
              if (!d.ok) throw new Error(d.error || 'enqueue failed')
              setTab('jobs')
              return loadJobs()
            })
            .catch(function (e) { setLog(String(e.message || e)) })
          return
        }
        setBusy(true)
        setLog((kind === 'update' ? '正在更新 ' : kind === 'repair' ? '正在修复 ' : '正在卸载 ') + (item.packageName || item.id || item.name) + ' …')
        json('/' + kind, {
          method: 'POST',
          body: JSON.stringify({
            spec: item.spec,
            name: item.packageName || item.name || '',
          }),
        })
          .then(function (d) {
            var text = (d.log || d.error || JSON.stringify(d)).slice(0, 4000)
            var prefix = (d.ok ? '完成。' : '失败。') + (d.needRestart ? ' 请用启动器重启 DSH。\n' : '\n')
            if (d.ok) setNeedRestartSticky(true)
            if (d.ok && d.plainDependency) {
              prefix += '注意：当前装成了普通依赖（未入 bundles），市场安装通常不能直接当插件用。可用「安装说明 / 复制安装命令」。\n'
            }
            setLog(prefix + text)
            loadCatalog(false, true)
            loadInstalled()
          })
          .catch(function (e) { setLog(String(e.message || e)) })
          .finally(function () { setBusy(false) })
      }

      var onGuide = function (item) {
        var link = item.readmeUrl || item.url || ''
        var body = (item.guideText || '请查看仓库 README，按作者说明安装可加载子包。')
          + (item.installCommand ? ('\n\n' + item.installCommand) : '')
          + (link ? ('\n\nREADME：' + link) : '')
        setLog(body)
        if (link) window.open(link, '_blank', 'noopener,noreferrer')
      }

      var onCopyInstall = function (item) {
        var cmd = item.installCommand || ''
        if (!cmd) {
          setLog('暂无可用的手动安装命令，请打开「安装说明」查看 README。')
          return
        }
        copyText(cmd).then(function (ok) {
          setLog(ok
            ? ('已复制安装命令到剪贴板：\n' + cmd)
            : ('复制失败，请手动复制：\n' + cmd))
        })
      }

      var onCancelJob = function (job) {
        json('/jobs/' + encodeURIComponent(job.id) + '/cancel', { method: 'POST' })
          .then(function (d) {
            if (!d.ok) throw new Error(d.error || 'cancel failed')
            if (job.status === 'installing') {
              setLog('已取消安装：' + (job.title || job.spec) + '。若 profile 异常，可到「已安装」修复或卸载。')
            }
            return loadJobs()
          })
          .then(function () {
            loadCatalog(false, true)
            loadInstalled()
          })
          .catch(function (e) { setLog(String(e.message || e)) })
      }

      var onRetryJob = function (job) {
        setLog('正在重试安装：' + (job.title || job.spec))
        json('/jobs/' + encodeURIComponent(job.id) + '/retry', { method: 'POST' })
          .then(function (d) {
            if (!d.ok) throw new Error(d.error || 'retry failed')
            setTab('jobs')
            return loadJobs()
          })
          .catch(function (e) { setLog(String(e.message || e)) })
      }

      return createElement(React.Fragment, null,
        createElement('button', {
          type: 'button',
          title: '插件索引',
          'aria-label': '插件索引',
          onClick: function () { setOpen(true) },
          onMouseEnter: function (e) { e.currentTarget.style.background = 'var(--dsw-alias-interactive-bg-hover, rgba(255,255,255,.06))' },
          onMouseLeave: function (e) { e.currentTarget.style.background = 'transparent' },
          style: {
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            width: wide ? 'calc(100% + 8px)' : 36,
            height: wide ? 34 : 36,
            margin: wide ? '4px -4px' : '8px 0 10px',
            padding: wide ? '6px 2px 6px 10px' : 0,
            justifyContent: wide ? 'flex-start' : 'center',
            boxSizing: 'border-box',
            border: 'none',
            background: 'transparent',
            color: 'var(--dsw-alias-label-primary, inherit)',
            cursor: 'pointer',
            borderRadius: wide ? 12 : '50%',
            fontSize: 14,
            fontFamily: 'inherit',
            lineHeight: '22px',
          },
        },
          createElement('span', { style: { width: 18, textAlign: 'center', fontSize: 15, lineHeight: 1 } }, '▣'),
          wide ? createElement('span', null, '插件') : null,
        ),
        isOpen ? createElement(Overlay, {
          onClose: function () { setOpen(false) },
          query: q,
          setQuery: setQuery,
          tab: t,
          setTab: setTab,
          catalog: items,
          installed: inst,
          jobs: jobs,
          loading: busyLoad,
          log: msg,
          busy: isBusy,
          onSearch: function () { loadCatalog(true) },
          onAction: onAction,
          onGuide: onGuide,
          onCopyInstall: onCopyInstall,
          onCancelJob: onCancelJob,
          onRetryJob: onRetryJob,
          githubTotal: githubTotal,
          partial: partial,
          now: now,
          needRestartSticky: needRestartSticky,
        }) : null,
      )
    }

    var overlay = {
      mask: {
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'var(--dsw-alias-bg-mask-1, rgba(0,0,0,.45))',
        display: 'flex', alignItems: 'stretch', justifyContent: 'flex-end',
      },
      panel: {
        width: 'min(720px, 100vw)',
        background: 'var(--dsw-alias-bg-layer-1, #1b1d22)',
        color: 'var(--dsw-alias-label-primary, #ececec)',
        borderLeft: '1px solid var(--dsw-alias-border-l2, #333)',
        display: 'flex', flexDirection: 'column',
      },
      head: {
        display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
        padding: '18px 20px 10px',
      },
      title: { fontSize: 16, fontWeight: 650, color: 'var(--dsw-alias-label-primary, #ececec)' },
      sub: { fontSize: 12, marginTop: 4, color: 'var(--dsw-alias-label-secondary, #9aa0a6)' },
      toolbar: { display: 'flex', gap: 8, padding: '0 20px 12px', flexWrap: 'wrap' },
      filters: { display: 'flex', gap: 6, padding: '0 20px 12px', flexWrap: 'wrap' },
      chip: {
        height: 26, padding: '0 10px', borderRadius: 999, fontSize: 12,
        border: '1px solid var(--dsw-alias-border-l2, #444)',
        background: 'transparent', color: 'var(--dsw-alias-label-secondary, #9aa0a6)', cursor: 'pointer',
      },
      chipActive: {
        height: 26, padding: '0 10px', borderRadius: 999, fontSize: 12, fontWeight: 650,
        border: '1px solid var(--dsw-alias-button-info-fill, #3b82f6)',
        background: 'var(--dsw-alias-button-info-fill, #3b82f6)', color: '#fff', cursor: 'pointer',
      },
      banner: {
        margin: '0 20px 10px',
        padding: '8px 10px',
        borderRadius: 8,
        fontSize: 12,
        background: 'rgba(59,130,246,.12)',
        color: 'var(--dsw-alias-label-primary, #ececec)',
        border: '1px solid rgba(59,130,246,.35)',
      },
      bannerWarn: {
        margin: '0 20px 10px',
        padding: '8px 10px',
        borderRadius: 8,
        fontSize: 12,
        background: 'rgba(245,158,11,.12)',
        color: 'var(--dsw-alias-label-primary, #ececec)',
        border: '1px solid rgba(245,158,11,.35)',
      },
      input: {
        flex: '1 1 180px', minWidth: 160, height: 32, borderRadius: 8, padding: '0 10px',
        border: '1px solid var(--dsw-alias-border-l2, #333)',
        background: 'var(--dsw-alias-bg-layer-2, #22252b)',
        color: 'var(--dsw-alias-label-primary, #ececec)',
      },
      btn: {
        height: 32, padding: '0 12px', borderRadius: 8, border: 'none',
        background: 'var(--dsw-alias-button-info-fill, #3b82f6)', color: '#fff', cursor: 'pointer',
      },
      btnActive: {
        height: 32, padding: '0 12px', borderRadius: 8,
        border: '1px solid var(--dsw-alias-button-info-fill, #3b82f6)',
        background: 'var(--dsw-alias-button-info-fill, #3b82f6)',
        color: '#fff', cursor: 'pointer', fontWeight: 650,
      },
      btnGhost: {
        height: 32, padding: '0 12px', borderRadius: 8,
        border: '1px solid var(--dsw-alias-border-l2, #444)',
        background: 'transparent', color: 'var(--dsw-alias-label-primary, #ececec)', cursor: 'pointer',
      },
      btnDanger: {
        height: 32, padding: '0 12px', borderRadius: 8,
        border: '1px solid #b45353', background: 'transparent', color: '#f87171', cursor: 'pointer',
      },
      iconBtn: {
        height: 32, padding: '0 10px', borderRadius: 8,
        border: '1px solid var(--dsw-alias-border-l2, #444)',
        background: 'transparent', color: 'var(--dsw-alias-label-primary, #ececec)', cursor: 'pointer',
      },
      list: { flex: 1, overflow: 'auto', padding: '0 20px 12px' },
      empty: { color: 'var(--dsw-alias-label-secondary, #9aa0a6)', padding: '24px 4px', fontSize: 13 },
      card: {
        display: 'flex', gap: 12, justifyContent: 'space-between',
        border: '1px solid var(--dsw-alias-border-l2, #333)',
        borderRadius: 10, padding: 12, marginBottom: 8,
        background: 'var(--dsw-alias-bg-layer-2, #22252b)',
      },
      cardMain: { minWidth: 0, flex: 1 },
      cardTitle: { fontWeight: 650, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', color: 'var(--dsw-alias-label-primary, #ececec)' },
      cardDesc: { fontSize: 12, marginTop: 4, lineHeight: 1.45, color: 'var(--dsw-alias-label-secondary, #9aa0a6)' },
      guide: {
        fontSize: 12, marginTop: 8, lineHeight: 1.5,
        color: '#fbbf24',
        background: 'rgba(245,158,11,.08)',
        border: '1px solid rgba(245,158,11,.22)',
        borderRadius: 8,
        padding: '8px 10px',
      },
      meta: { fontSize: 11, marginTop: 6, color: 'var(--dsw-alias-label-tertiary, #7d838b)' },
      jobLog: {
        margin: '8px 0 0',
        padding: 8,
        maxHeight: 120,
        overflow: 'auto',
        fontSize: 11,
        lineHeight: 1.4,
        whiteSpace: 'pre-wrap',
        borderRadius: 6,
        background: 'var(--dsw-alias-bg-layer-1, #1b1d22)',
        color: 'var(--dsw-alias-label-secondary, #9aa0a6)',
      },
      tagCat: { fontSize: 10, padding: '1px 6px', borderRadius: 999, background: 'rgba(148,163,184,.16)', color: 'var(--dsw-alias-label-secondary, #9aa0a6)' },
      tagOn: { fontSize: 10, padding: '1px 6px', borderRadius: 999, background: 'rgba(16,185,129,.16)', color: '#34d399' },
      tagWarn: { fontSize: 10, padding: '1px 6px', borderRadius: 999, background: 'rgba(245,158,11,.16)', color: '#fbbf24' },
      tagDanger: { fontSize: 10, padding: '1px 6px', borderRadius: 999, background: 'rgba(248,113,113,.16)', color: '#f87171' },
      actions: { display: 'flex', flexDirection: 'column', gap: 6, flexShrink: 0 },
      link: { fontSize: 12, color: 'var(--dsw-alias-button-info-fill, #60a5fa)', textAlign: 'center' },
      pager: {
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
        padding: '8px 20px',
        borderTop: '1px solid var(--dsw-alias-border-l2, #333)',
      },
      pagerText: { fontSize: 12, color: 'var(--dsw-alias-label-secondary, #9aa0a6)', flex: 1, textAlign: 'center' },
      log: {
        margin: 0, padding: '10px 20px', maxHeight: 140, overflow: 'auto',
        fontSize: 11, color: 'var(--dsw-alias-label-secondary, #9aa0a6)',
        borderTop: '1px solid var(--dsw-alias-border-l2, #333)',
        whiteSpace: 'pre-wrap',
      },
    }

    exports.name = 'dsh-plugin-index'
    exports.inject = ['slots']
    exports.apply = function apply(ctx) {
      ctx.effect(function () {
        return ctx.slots.inject('sidebar.footer.action', function () {
          return ctx.slots.register({
            name: 'sidebar.footer.action',
            id: 'dsh-plugin-index',
            order: 20,
          }, FooterButton)
        })
      }, 'plugin-index: sidebar entry')
    }

    return module.exports
  },
})
