// 通用 figure-spec 加载器 — 读 window.FIGURE_SPECS（每个 figure-spec 数据），
// 用 JXGKit2D 构建图形并注册进 AIClassFigureRegistry。
// 依赖加载顺序：jxg-loader → jxg-kit-2d → 本文件（engine-manifest 保证）。
// 支持元素：points / segments / lines / curves(bezier2) / polygons / circles / texts(含 flipX) / images
;(function () {
  if (window.AIClassFigureSpecLoader) return

  function drawFigure(board, spec, imgOk) {
    var els = { points: {}, curves: {}, segments: {}, lines: {}, polygons: {}, circles: {}, arcs: {}, texts: {}, images: {}, _dynamic: [] }
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
    function resolveCoords(ref) {
      if (Array.isArray(ref)) return ref
      if (typeof ref === 'string' && points[ref]) return [points[ref].X(), points[ref].Y()]
      return null
    }
    ;(spec.curves || []).forEach(function (item, index) {
      var id = item.id || ('curve-' + index)
      var attrs = Object.assign({
        strokeColor: '#1e293b',
        strokeWidth: 2,
        visible: true,
        fixed: true,
        highlight: false,
        fillOpacity: 0,
        numberPointsHigh: 160,
        numberPointsLow: 80
      }, item)
      delete attrs.id
      delete attrs.bezier2
      delete attrs.from
      delete attrs.to
      delete attrs.ctrl
      var el = null
      if (item.bezier2) {
        var A = resolveCoords(item.bezier2.from)
        var Ctrl = resolveCoords(item.bezier2.ctrl)
        var B = resolveCoords(item.bezier2.to)
        if (!A || !Ctrl || !B) {
          console.error('[FigureSpec] curve bezier2 坐标无效: ' + id)
          return
        }
        el = board.create('curve', [
          function (t) { return (1 - t) * (1 - t) * A[0] + 2 * (1 - t) * t * Ctrl[0] + t * t * B[0] },
          function (t) { return (1 - t) * (1 - t) * A[1] + 2 * (1 - t) * t * Ctrl[1] + t * t * B[1] },
          0, 1
        ], attrs)
      } else {
        console.error('[FigureSpec] 未知 curve 类型: ' + id)
        return
      }
      els.curves[id] = el
    })
    ;(spec.polygons || []).forEach(function (poly, index) {
      var vertNames = poly.vertices || poly.verts || []
      var verts = vertNames.map(function (v) { return points[v] })
      var attrs = Object.assign({
        fillColor: '#dbeafe',
        fillOpacity: 0.7,
        borders: { strokeColor: '#1e293b', strokeWidth: 2 },
        fixed: true,
        highlight: false
      }, poly)
      delete attrs.vertices
      delete attrs.verts
      delete attrs.vertexStyle
      attrs.vertices = poly.vertexStyle || { visible: false, fixed: true }
      var id = poly.id || 'poly-' + index
      attrs.id = id
      els.polygons[id] = board.create('polygon', verts, attrs)
    })
    ;(spec.circles || []).forEach(function (cir, index) {
      var center = points[cir.center]
      if (!center) { console.error('[figure-spec] circle 未知圆心: ' + cir.center); return }
      var parents = cir.through != null ? [center, points[cir.through]] : [center, cir.radius]
      var attrs = Object.assign({
        strokeColor: '#1e293b',
        strokeWidth: 2,
        fixed: true,
        highlight: false,
        visible: true
      }, cir)
      delete attrs.center
      delete attrs.through
      delete attrs.radius
      var id = attrs.id || 'cir-' + index
      attrs.id = id
      els.circles[id] = board.create('circle', parents, attrs)
    })
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
      var flipX = !!attrs.flipX
      delete attrs.flipX
      var textEl = board.create('text', parents, Object.assign({
        fixed: true,
        highlight: false,
        fontSize: 14,
        // SVG 内嵌文本：随 viewBox 等比缩放，避免 HTML 覆盖层与缩放后图形错位
        display: 'internal',
        visible: t.visible !== false
      }, attrs))
      // 水平镜像（如 🏃 默认朝左，场景需要朝右）：绕文本锚点翻转，位置不变
      if (flipX && textEl.rendNode && Array.isArray(t.at)) {
        var ax = parseFloat(textEl.rendNode.getAttribute('x'))
        if (!isFinite(ax)) ax = board.origin.scrCoords[1] + t.at[0] * board.unitX
        textEl.rendNode.setAttribute('transform', 'translate(' + (2 * ax) + ',0) scale(-1,1)')
      }
      els.texts[t.id || t.name || 'text-' + index] = textEl
    })
    ;(spec.images || []).forEach(function (img, index) {
      var id = img.id || 'img-' + index
      var size = img.size || [2, 2]
      var cx = img.at[0]
      var cy = img.at[1]
      var visible = img.visible !== false
      var el
      if (!imgOk || imgOk[img.src]) {
        el = board.create('image', [img.src, [cx - size[0] / 2, cy - size[1] / 2], [size[0], size[1]]], {
          id: id, fixed: true, highlight: false, visible: visible
        })
      } else {
        var px = Math.round(size[1] * (board.unitY || 30) * 0.72)
        el = board.create('text', [cx, cy, img.fallback || ''], {
          id: id, fixed: true, highlight: false, visible: visible,
          fontSize: px, anchorX: 'middle', anchorY: 'middle'
        })
      }
      els.images[id] = el
    })
    return els
  }

  function preloadImages(spec) {
    var list = spec.images || []
    if (!list.length) return Promise.resolve(null)
    var jobs = list.map(function (img) {
      return new Promise(function (resolve) {
        var im = new Image()
        im.onload = function () { resolve({ src: img.src, ok: true }) }
        im.onerror = function () { resolve({ src: img.src, ok: false }) }
        im.src = img.src
      })
    })
    return Promise.all(jobs).then(function (results) {
      var map = {}
      results.forEach(function (r) { map[r.src] = r.ok })
      return map
    })
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
        preloadImages(spec).then(function (imgOk) {
          if (!root) return
          var mounted = JXGKit2D.mount(root, { board: spec.board || {} })
          board = mounted.board
          els = drawFigure(board, spec, imgOk)
          base = JXGKit2D.captureBase(els)
          applyState(state)
        })
      }).catch(function (err) {
        if (root) root.textContent = '图形加载失败: ' + err.message
      })
    }

    function applyState(next, params) {
      state = next || 'default'
      if (root) root.setAttribute('data-figure-state', state)
      if (!board || !els || !base) return
      // keepPrevious：保留当前元素状态（不清标注/高亮），仅应用新状态声明
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
      // 注册工厂而非单例：同页多个容器（例/练）共用同一模板时各自实例化画板
      AIClassFigureRegistry.register(spec.figureTemplate, function () { return makeFigure(spec) })
    })
  }

  // figure-spec 数据可能已就绪（window.FIGURE_SPECS），也可能后置加载
  loadAll()

  window.AIClassFigureSpecLoader = { loadAll: loadAll }
})()
