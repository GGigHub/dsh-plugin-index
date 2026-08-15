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

    function Overlay(props) {
      var onClose = props.onClose
      var query = props.query
      var setQuery = props.setQuery
      var tab = props.tab
      var setTab = props.setTab
      var catalog = props.catalog
      var installed = props.installed
      var loading = props.loading
      var log = props.log
      var busy = props.busy
      var onSearch = props.onSearch
      var onAction = props.onAction

      useEffect(function () {
        function onKey(e) {
          if (e.key === 'Escape') onClose()
        }
        window.addEventListener('keydown', onKey)
        return function () { window.removeEventListener('keydown', onKey) }
      }, [onClose])

      var qn = (query || '').trim().toLowerCase()
      var source = tab === 'installed' ? installed : catalog
      var rows = !qn ? source : source.filter(function (item) {
        return ((item.id || '') + ' ' + (item.name || '') + ' ' + (item.description || '') + ' ' + (item.spec || '')).toLowerCase().includes(qn)
      })

      return createPortal(createElement('div', {
        style: overlay.mask,
        onClick: function (e) { if (e.target === e.currentTarget) onClose() },
      },
        createElement('div', { style: overlay.panel },
          createElement('div', { style: overlay.head },
            createElement('div', null,
              createElement('div', { style: overlay.title }, '插件索引'),
              createElement('div', { style: overlay.sub }, '按 GitHub 星标排序 · topic: dsh-plugin'),
            ),
            createElement('button', { type: 'button', style: overlay.iconBtn, onClick: onClose }, '关闭'),
          ),
          createElement('div', { style: overlay.toolbar },
            createElement('input', {
              style: overlay.input,
              value: query,
              placeholder: '搜索仓库名或描述',
              onChange: function (e) { setQuery(e.target.value) },
              onKeyDown: function (e) { if (e.key === 'Enter') onSearch() },
            }),
            createElement('button', { type: 'button', style: overlay.btn, onClick: onSearch, disabled: loading }, loading ? '刷新中…' : '刷新'),
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
          ),
          createElement('div', { style: overlay.list },
            loading && createElement('div', { style: overlay.empty }, '正在拉取索引…'),
            !loading && rows.length === 0 && createElement('div', { style: overlay.empty }, tab === 'installed' ? '还没有通过 profile 安装的第三方插件。' : '没有匹配的插件。'),
            !loading && rows.map(function (item) {
              var key = item.id || item.name
              var title = item.id || item.name
              var desc = item.description || item.spec || ''
              var isOn = item.installed || item.bundled
              return createElement('div', { key: key, style: overlay.card },
                createElement('div', { style: overlay.cardMain },
                  createElement('div', { style: overlay.cardTitle },
                    title,
                    isOn ? createElement('span', { style: overlay.tagOn }, '已安装') : null,
                    item.bundled === false ? createElement('span', { style: overlay.tagWarn }, '未入 bundles') : null,
                    item.present === false ? createElement('span', { style: overlay.tagWarn }, '文件缺失') : null,
                  ),
                  createElement('div', { style: overlay.cardDesc }, desc),
                  createElement('div', { style: overlay.meta },
                    item.stars != null ? ('★ ' + fmtStars(item.stars)) : null,
                    item.forks != null ? ('  ·  fork ' + item.forks) : null,
                    item.language ? ('  ·  ' + item.language) : null,
                    item.spec ? ('  ·  ' + item.spec) : null,
                  ),
                ),
                createElement('div', { style: overlay.actions },
                  !isOn && createElement('button', {
                    type: 'button', style: overlay.btn, disabled: busy,
                    onClick: function () { onAction('install', item) },
                  }, '安装'),
                  isOn && createElement('button', {
                    type: 'button', style: overlay.btnGhost, disabled: busy,
                    onClick: function () { onAction('update', item) },
                  }, '更新'),
                  isOn && createElement('button', {
                    type: 'button', style: overlay.btnGhost, disabled: busy,
                    onClick: function () { onAction('repair', item) },
                  }, '修复'),
                  isOn && item.name !== '@dsh-external/dsh-plugin-index' && item.packageName !== '@dsh-external/dsh-plugin-index' && createElement('button', {
                    type: 'button', style: overlay.btnDanger, disabled: busy,
                    onClick: function () {
                      if (!window.confirm('确定卸载 ' + (item.packageName || item.name || item.id) + '？')) return
                      onAction('uninstall', item)
                    },
                  }, '卸载'),
                  item.url && createElement('a', {
                    href: item.url, target: '_blank', rel: 'noreferrer', style: overlay.link,
                  }, '仓库'),
                ),
              )
            }),
          ),
          createElement('pre', { style: overlay.log }, log || '安装、更新、修复后需要重启 DSH 才会加载新插件。'),
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
      var loading = useState(false)
      var busyLoad = loading[0]
      var setLoading = loading[1]
      var busy = useState(false)
      var isBusy = busy[0]
      var setBusy = busy[1]
      var log = useState('')
      var msg = log[0]
      var setLog = log[1]

      var loadCatalog = function (fresh) {
        setLoading(true)
        var query = '/catalog?q=' + encodeURIComponent(q) + (fresh ? '&fresh=1' : '')
        json(query)
          .then(function (d) {
            if (!d.ok) throw new Error(d.error || 'catalog failed')
            setItems(d.items || [])
          })
          .catch(function (e) { setLog(String(e.message || e)) })
          .finally(function () { setLoading(false) })
      }

      var loadInstalled = function () {
        json('/installed')
          .then(function (d) {
            if (!d.ok) throw new Error(d.error || 'installed failed')
            setInst(d.items || [])
          })
          .catch(function (e) { setLog(String(e.message || e)) })
      }

      useEffect(function () {
        if (!isOpen) return
        loadCatalog(false)
        loadInstalled()
      }, [isOpen])

      var onAction = function (kind, item) {
        setBusy(true)
        setLog((kind === 'install' ? '正在安装 ' : kind === 'update' ? '正在更新 ' : kind === 'repair' ? '正在修复 ' : '正在卸载 ') + (item.packageName || item.id || item.name) + ' …')
        var path = '/' + kind
        json(path, {
          method: 'POST',
          body: JSON.stringify({
            spec: item.spec,
            name: item.packageName || item.name,
          }),
        })
          .then(function (d) {
            var text = (d.log || d.error || JSON.stringify(d)).slice(0, 4000)
            setLog((d.ok ? '完成。' : '失败。') + (d.needRestart ? ' 请用启动器重启 DSH。\n' : '\n') + text)
            loadCatalog()
            loadInstalled()
          })
          .catch(function (e) { setLog(String(e.message || e)) })
          .finally(function () { setBusy(false) })
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
          loading: busyLoad,
          log: msg,
          busy: isBusy,
          onSearch: function () { loadCatalog(true) },
          onAction: onAction,
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
        background: 'var(--dsw-alias-bg-primary, var(--theme-bg, #111827))',
        color: 'var(--dsw-alias-label-primary, var(--theme-text, #e5e7eb))',
        borderLeft: '1px solid var(--dsw-alias-border-l2, var(--theme-border, #333))',
        display: 'flex', flexDirection: 'column',
      },
      head: {
        display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
        padding: '18px 20px 10px',
      },
      title: { fontSize: 16, fontWeight: 650 },
      sub: { fontSize: 12, opacity: 0.65, marginTop: 4 },
      toolbar: { display: 'flex', gap: 8, padding: '0 20px 12px', flexWrap: 'wrap' },
      input: {
        flex: '1 1 180px', minWidth: 160, height: 32, borderRadius: 8, padding: '0 10px',
        border: '1px solid var(--theme-border, #333)',
        background: 'var(--theme-input-bg, #0b1220)',
        color: 'inherit',
      },
      btn: {
        height: 32, padding: '0 12px', borderRadius: 8, border: 'none',
        background: 'var(--theme-accent, #3b82f6)', color: '#fff', cursor: 'pointer',
      },
      btnActive: {
        height: 32, padding: '0 12px', borderRadius: 8, border: 'none',
        background: 'var(--theme-accent, #3b82f6)', color: '#fff', cursor: 'pointer',
      },
      btnGhost: {
        height: 32, padding: '0 12px', borderRadius: 8,
        border: '1px solid var(--theme-border, #444)',
        background: 'transparent', color: 'inherit', cursor: 'pointer',
      },
      btnDanger: {
        height: 32, padding: '0 12px', borderRadius: 8,
        border: '1px solid #b45353', background: 'transparent', color: '#f87171', cursor: 'pointer',
      },
      iconBtn: {
        height: 32, padding: '0 10px', borderRadius: 8,
        border: '1px solid var(--theme-border, #444)',
        background: 'transparent', color: 'inherit', cursor: 'pointer',
      },
      list: { flex: 1, overflow: 'auto', padding: '0 20px 12px' },
      empty: { opacity: 0.6, padding: '24px 4px', fontSize: 13 },
      card: {
        display: 'flex', gap: 12, justifyContent: 'space-between',
        border: '1px solid var(--theme-border, #333)',
        borderRadius: 10, padding: 12, marginBottom: 8,
      },
      cardMain: { minWidth: 0, flex: 1 },
      cardTitle: { fontWeight: 650, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' },
      cardDesc: { fontSize: 12, opacity: 0.75, marginTop: 4, lineHeight: 1.45 },
      meta: { fontSize: 11, opacity: 0.55, marginTop: 6 },
      tagOn: { fontSize: 10, padding: '1px 6px', borderRadius: 999, background: 'rgba(16,185,129,.16)', color: '#34d399' },
      tagWarn: { fontSize: 10, padding: '1px 6px', borderRadius: 999, background: 'rgba(245,158,11,.16)', color: '#fbbf24' },
      actions: { display: 'flex', flexDirection: 'column', gap: 6, flexShrink: 0 },
      link: { fontSize: 12, color: 'var(--theme-accent, #60a5fa)', textAlign: 'center' },
      log: {
        margin: 0, padding: '10px 20px', maxHeight: 140, overflow: 'auto',
        fontSize: 11, opacity: 0.8, borderTop: '1px solid var(--theme-border, #333)',
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
