// 通用 figure-spec 加载器 — 读 window.FIGURE_SPECS（每个 figure-spec 数据），
// 用 JXGKit2D 构建图形并注册进 AIClassFigureRegistry。
// 依赖加载顺序：jxg-loader → jxg-kit-2d → 本文件（engine-manifest 保证）。
;(function () {
  if (window.AIClassFigureSpecLoader) return

  function drawFigure(board, spec) {
    var els = { points: {}, curves: {}, segments: {}, lines: {}, polygons: {}, circles: {}, arcs: {}, texts: {}, _dynamic: [] }
    var points = {}
    Object.keys(spec.points || {}).forEach(function (name) {
      var raw = spec.points[name]
      var coords = Array.isArray(raw) ? raw : (raw.coords || raw.xy)
      var visible = raw && raw.visible !== false
      var label = raw && raw.name != null ? String(raw.name) : name
      var p = board.create('point', coords, {
        name: visible ? label : '',
        withLabel: visible && label !== '',
        visible: visible,
        size: 3,
        fixed: true,
        highlight: false,
        showInfobox: false,
        fillColor: '#2563eb',
        strokeColor: '#1e40af'
      })
      points[name] = p
      els.points[name] = p
    })
    function addEdge(item, type, sink) {
      var from = Array.isArray(item) ? item[0] : item.from
      var to = Array.isArray(item) ? item[1] : item.to
      var attrs = Array.isArray(item) ? (item[2] || {}) : Object.assign({}, item)
      delete attrs.from
      delete attrs.to
      var el = board.create(type, [points[from], points[to]], Object.assign({
        strokeColor: '#1e293b',
        strokeWidth: 2,
        visible: true,
        fixed: true,
        highlight: false
      }, attrs))
      var id = attrs.id || String(from) + String(to)
      sink[id] = el
      if (!attrs.id) sink[String(to) + String(from)] = el
    }
    ;(spec.segments || []).forEach(function (item) { addEdge(item, 'segment', els.segments) })
    ;(spec.lines || []).forEach(function (item) { addEdge(item, 'line', els.lines) })
    ;(spec.texts || []).forEach(function (t, index) {
      var content = t.text
      var parents
      if (typeof t.at === 'string') {
        var p = points[t.at]
        parents = [function () { return p.X() }, function () { return p.Y() }, content]
      } else {
        parents = [t.at[0], t.at[1], content]
      }
      var attrs = Object.assign({}, t)
      delete attrs.at
      delete attrs.text
      els.texts[t.id || t.name || 'text-' + index] = board.create('text', parents, Object.assign({
        fixed: true,
        highlight: false,
        fontSize: 14,
        visible: t.visible !== false
      }, attrs))
    })
    return els
  }

  function makeFigure(spec) {
    var root = null
    var board = null
    var els = null
    var base = null
    var state = (spec.initialState && spec.initialState.state) || 'default'

    function mount(target) {
      if (root) return
      root = target
      root.setAttribute('data-figure-template', spec.figureTemplate)
      AIClassJSXGraph.ready().then(function () {
        if (!root) return
        var mounted = JXGKit2D.mount(root, { board: spec.board || {} })
        board = mounted.board
        els = drawFigure(board, spec)
        base = JXGKit2D.captureBase(els)
        applyState(state)
      }).catch(function (err) {
        if (root) root.textContent = '图形加载失败: ' + err.message
      })
    }

    function applyState(next, params) {
      state = next || 'default'
      if (root) root.setAttribute('data-figure-state', state)
      if (!board || !els || !base) return
      if (!params || params.keepPrevious !== true) {
        JXGKit2D.resetFigure(board, els, base)
      }
      JXGKit2D.applyStateDef(board, els, (spec.states || {})[state], base)
    }

    function setState(next, params) {
      params = params || {}
      applyState(next, params)
      if (board && els && base && params.actions && params.actions.length) {
        JXGKit2D.runActions(board, els, params.actions, base)
      }
    }

    function reset() {
      if (board && els && base) JXGKit2D.resetFigure(board, els, base)
      applyState((spec.initialState && spec.initialState.state) || 'default')
    }

    function teardown() {
      if (root) root.removeAttribute('data-figure-state')
      if (root) root.removeAttribute('data-figure-template')
      root = null
      board = null
      els = null
      base = null
    }

    return {
      states: Object.keys(spec.states || {}),
      capabilities: Object.keys(spec.actions || {}),
      mount: mount,
      setState: setState,
      reset: reset,
      teardown: teardown
    }
  }

  function loadAll() {
    var list = window.FIGURE_SPECS || []
    if (Array.isArray(list)) list.forEach(function (spec) {
      if (!spec || !spec.figureTemplate) return
      AIClassFigureRegistry.register(spec.figureTemplate, makeFigure(spec))
    })
  }

  // figure-spec 数据可能已就绪（window.FIGURE_SPECS），也可能后置加载
  loadAll()

  window.AIClassFigureSpecLoader = { loadAll: loadAll }
})()
