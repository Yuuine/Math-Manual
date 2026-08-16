// 通用 figure-spec 加载器 — 读 window.FIGURE_SPECS（每个 figure-spec 数据），
// 用 JXGKit2D 构建图形并注册进 AIClassFigureRegistry。
// 依赖加载顺序：jxg-loader → jxg-kit-2d → 本文件（engine-manifest 保证）。
;(function () {
  if (window.AIClassFigureSpecLoader) return

  function resolveAssetUrl(src) {
    if (!src || typeof src !== 'string') return src
    var trimmed = src.replace(/^\s+/, '')
    if (trimmed.indexOf('assets/') !== 0) return src
    var boot = window.__COURSE_BOOT || {}
    var lesson = boot.lessonRoot || 'lesson'
    var relPath = trimmed
    if (typeof lesson === 'string' && lesson.indexOf('runtime/lesson') >= 0) {
      relPath = lesson.replace(/runtime\/lesson$/, trimmed)
    } else if (typeof lesson === 'string' && lesson.indexOf('/') >= 0) {
      relPath = lesson.replace(/\/lesson$/, '') + '/' + trimmed
    }
    try {
      if (typeof document !== 'undefined' && document.location && document.location.href) {
        return new URL(relPath, document.location.href).href
      }
    } catch (e) { /* fall through */ }
    return relPath
  }

  var HIDDEN_VERTEX = {
    visible: false,
    fixed: true,
    size: 0,
    showInfobox: false,
    highlight: false,
    withLabel: false
  }

  function specPointCoords(specPoints, name) {
    var raw = specPoints[name]
    if (!raw) return [0, 0]
    if (Array.isArray(raw)) return raw
    return raw.coords || raw.xy || [0, 0]
  }

  function setVisibleEl(el, visible) {
    if (!el) return
    el.setAttribute({ visible: visible })
    if (visible && typeof el.showElement === 'function') el.showElement()
    if (!visible && typeof el.hideElement === 'function') el.hideElement()
  }

  /** barFill+icon 粗条由多个 polygon/image 组成，show/hide 锚点后需同步整组 */
  function syncBarGroups(els, barGroups) {
    if (!barGroups) return
    Object.keys(barGroups).forEach(function (id) {
      var anchor = els && els.segments && els.segments[id]
      if (!anchor || !anchor.visProp) return
      var vis = anchor.visProp.visible !== false
      barGroups[id].forEach(function (part) {
        if (part === anchor) return
        setVisibleEl(part, vis)
      })
    })
  }

  function hasClass(el, name) {
    return !!(el && el.className && (' ' + el.className + ' ').indexOf(' ' + name + ' ') >= 0)
  }

  function addClass(el, name) {
    if (!el || hasClass(el, name)) return
    el.className = (el.className ? el.className + ' ' : '') + name
  }

  function removeClass(el, name) {
    if (!el || !el.className) return
    el.className = (' ' + el.className + ' ').replace(' ' + name + ' ', ' ').replace(/^\s+|\s+$/g, '')
  }

  function closestFigure(el) {
    var n = el
    while (n && n.nodeType === 1) {
      if (hasClass(n, 'course-figure')) return n
      n = n.parentNode
    }
    return null
  }

  function drawFigure(board, spec) {
    var prepared = JSON.parse(JSON.stringify(spec || {}))
    ;(prepared.images || []).forEach(function (img) {
      if (!img) return
      if (img.url) img.url = resolveAssetUrl(img.url)
      if (img.src) img.src = resolveAssetUrl(img.src)
    })

    // barFill / texture 粗条不能走普通 segment，需单独画色块（icon 可选）
    var barGroups = {}
    var specialSegs = []
    var normalSegs = []
    ;(prepared.segments || []).forEach(function (item) {
      if (!item) return
      if (item.barFill || item.texture) specialSegs.push(item)
      else normalSegs.push(item)
    })
    prepared.segments = normalSegs

    var drawn = JXGKit2D.draw(board, prepared)
    var els = {
      points: {},
      curves: {},
      segments: {},
      lines: {},
      polygons: {},
      circles: {},
      arcs: {},
      texts: {},
      images: {},
      _dynamic: []
    }
    function indexGroup(src, sink, fallbackPrefix) {
      if (Array.isArray(src)) {
        src.forEach(function (el, i) {
          if (!el) return
          var id = el.name || (el.id != null ? String(el.id) : '') || (fallbackPrefix + i)
          sink[id] = el
        })
      } else {
        Object.keys(src || {}).forEach(function (k) { sink[k] = src[k] })
      }
    }
    indexGroup(drawn.points, els.points, 'pt-')
    indexGroup(drawn.segments, els.segments, 'seg-')
    indexGroup(drawn.lines, els.lines, 'ln-')
    indexGroup(drawn.polygons, els.polygons, 'poly-')
    indexGroup(drawn.circles, els.circles, 'cir-')
    indexGroup(drawn.arcs, els.arcs, 'arc-')
    indexGroup(drawn.texts, els.texts, 'text-')
    indexGroup(drawn.images, els.images, 'img-')

    var specPoints = prepared.points || {}
    specialSegs.forEach(function (item) {
      var from = item.from
      var to = item.to
      var attrs = Object.assign({}, item)
      var texture = attrs.texture
      var barHalfHeight = attrs.barHalfHeight
      var barFill = attrs.barFill
      var icon = attrs.icon
      var iconScale = attrs.iconScale
      delete attrs.from
      delete attrs.to
      delete attrs.texture
      delete attrs.barHalfHeight
      delete attrs.barFill
      delete attrs.icon
      delete attrs.iconScale
      var id = attrs.id || String(from) + String(to)
      var c0 = specPointCoords(specPoints, from)
      var c1 = specPointCoords(specPoints, to)
      var halfH = barHalfHeight != null ? barHalfHeight : 0.3
      var y = c0[1]
      var xMin = Math.min(c0[0], c1[0])
      var xMax = Math.max(c0[0], c1[0])
      var cellVisible = attrs.visible !== false

      if (barFill) {
        var nCells = Math.max(1, Math.round(xMax - xMin))
        var cellPolys = []
        var cellIcons = []
        var ci
        for (ci = 0; ci < nCells; ci++) {
          var bx = xMin + ci
          cellPolys.push(board.create('polygon', [
            [bx, y - halfH], [bx + 1, y - halfH], [bx + 1, y + halfH], [bx, y + halfH]
          ], {
            fillColor: barFill,
            fillOpacity: 1,
            borders: { strokeColor: '#1e293b', strokeWidth: 1.5, highlight: false },
            vertices: HIDDEN_VERTEX,
            hasInnerPoints: false,
            fixed: true,
            highlight: false,
            visible: cellVisible,
            name: id,
            layer: 1
          }))
        }
        if (icon) {
          var iconSize = iconScale != null ? iconScale : Math.min(0.52, halfH * 1.6)
          var url = resolveAssetUrl(icon)
          for (ci = 0; ci < nCells; ci++) {
            var ix = xMin + ci
            cellIcons.push(board.create('image', [
              url,
              [ix + 0.5 - iconSize / 2, y - iconSize / 2],
              [iconSize, iconSize]
            ], {
              fixed: true,
              highlight: false,
              showInfobox: false,
              visible: cellVisible,
              layer: 2,
              opacity: 1,
              loadCallback: function () {
                if (board && typeof board.update === 'function') board.update()
              }
            }))
          }
        }
        barGroups[id] = cellPolys.concat(cellIcons)
        els.segments[id] = cellPolys[0]
        return
      }

      if (texture) {
        var texEl = board.create('image', [
          resolveAssetUrl(texture),
          [xMin, y - halfH],
          [xMax - xMin, halfH * 2]
        ], Object.assign({
          strokeColor: '#1e293b',
          strokeWidth: 2,
          visible: cellVisible,
          fixed: true,
          highlight: false,
          name: id
        }, attrs))
        els.segments[id] = texEl
      }
    })

    return { els: els, barGroups: barGroups }
  }

  function findSpecImage(spec, id) {
    var list = spec.images || []
    var i
    for (i = 0; i < list.length; i++) {
      if (list[i] && (list[i].id === id || list[i].name === id)) return list[i]
    }
    return null
  }

  function setSpecIllust(figure, on) {
    if (!figure) return
    if (on) {
      addClass(figure, 'is-illust')
      figure.setAttribute('data-spec-illust', 'true')
    } else {
      figure.removeAttribute('data-spec-illust')
      removeClass(figure, 'is-illust')
    }
  }

  /** 插图挂在 .course-figure 上（不要塞进 display:none 的 content，否则 figureHidden=false 会把图藏掉） */
  function attachIllust(slot) {
    var figure = closestFigure(slot)
    var host = figure || slot
    var imgEl = host.querySelector ? host.querySelector('.cc-illust-img') : null
    if (!imgEl) {
      imgEl = document.createElement('img')
      imgEl.className = 'cc-illust-img'
      imgEl.alt = ''
      host.appendChild(imgEl)
    }
    return { figure: figure, imgEl: imgEl }
  }

  /** 左图右文插图：不走 JSXGraph，铺到 .course-figure-content */
  function makeImageFigure(spec) {
    var slot = null
    var figure = null
    var imgEl = null
    var state = (spec.initialState && spec.initialState.state) || 'default'

    function currentImage() {
      var def = (spec.states || {})[state] || {}
      var ids = def.show || []
      var found = ids.length ? findSpecImage(spec, ids[0]) : null
      return found || (spec.images && spec.images[0]) || null
    }

    function applyState(next) {
      state = next || 'default'
      if (figure) figure.setAttribute('data-figure-state', state)
      if (!imgEl) return
      var item = currentImage()
      if (!item) {
        imgEl.style.display = 'none'
        setSpecIllust(figure, false)
        return
      }
      imgEl.style.display = 'block'
      imgEl.src = resolveAssetUrl(item.url || item.src)
      imgEl.alt = item.alt || ''
      setSpecIllust(figure, true)
    }

    function mount(target) {
      if (slot) return
      slot = target
      var attached = attachIllust(slot)
      figure = attached.figure || slot
      imgEl = attached.imgEl
      if (figure) figure.setAttribute('data-figure-template', spec.figureTemplate)
      applyState(state)
    }

    function setState(next) {
      applyState(next)
    }

    function reset() {
      applyState((spec.initialState && spec.initialState.state) || 'default')
    }

    function teardown() {
      if (figure) {
        figure.removeAttribute('data-figure-state')
        figure.removeAttribute('data-figure-template')
        setSpecIllust(figure, false)
      }
      if (imgEl && imgEl.parentNode) imgEl.parentNode.removeChild(imgEl)
      slot = null
      figure = null
      imgEl = null
    }

    return {
      states: Object.keys(spec.states || {}),
      capabilities: [],
      mount: mount,
      setState: setState,
      reset: reset,
      teardown: teardown
    }
  }

  function makeFigure(spec) {
    var slot = null
    var figure = null
    var boardEl = null
    var board = null
    var els = null
    var barGroups = null
    var base = null
    var imgEl = null
    var state = (spec.initialState && spec.initialState.state) || 'default'
    var imageOnlyActive = false
    var imageById = {}
    ;(spec.images || []).forEach(function (img) {
      if (!img) return
      imageById[img.id || img.name] = img
    })

    function imageOnlyItem(stateName) {
      var def = (spec.states || {})[stateName] || {}
      var ids = def.show || []
      if (!ids.length) return null
      var i
      for (i = 0; i < ids.length; i++) {
        if (!imageById[ids[i]]) return null
      }
      return imageById[ids[0]] || null
    }

    function showIllust(item) {
      if (!imgEl || !item) return
      imageOnlyActive = true
      setSpecIllust(figure, true)
      imgEl.src = resolveAssetUrl(item.url || item.src)
      imgEl.alt = item.alt || ''
      imgEl.style.display = 'block'
    }

    // 只在「figure-spec 纯插图态」时收回 is-illust。
    // plan 的 figureHidden（左栏 HTML 插图）也用 is-illust，不能被 JSXGraph 异步 applyState 清掉。
    function hideIllust() {
      if (imgEl) imgEl.style.display = 'none'
      if (imageOnlyActive) {
        setSpecIllust(figure, false)
        imageOnlyActive = false
        resize()
      }
    }

    function mount(target) {
      if (slot) return
      slot = target
      figure = closestFigure(slot) || slot
      figure.setAttribute('data-figure-template', spec.figureTemplate)

      boardEl = slot
      var attached = attachIllust(slot)
      imgEl = attached.imgEl
      imgEl.style.display = 'none'

      AIClassJSXGraph.ready().then(function () {
        if (!slot) return
        // 保留 plan 已设的 is-illust，避免异步 mount 把读题插图盖掉
        var keepPlanIllust = figure && hasClass(figure, 'is-illust') && !imageOnlyActive
        var mounted = JXGKit2D.mount(boardEl, { board: spec.board || {} })
        board = mounted.board
        var built = drawFigure(board, spec)
        els = built.els
        barGroups = built.barGroups
        base = JXGKit2D.captureBase(els)
        applyState(state)
        if (keepPlanIllust) addClass(figure, 'is-illust')
        resize()
      }).catch(function (err) {
        if (slot) slot.textContent = '图形加载失败: ' + err.message
      })
      applyState(state)
    }

    function applyState(next, params) {
      params = params || {}
      state = next || 'default'
      if (figure) figure.setAttribute('data-figure-state', state)
      var illust = imageOnlyItem(state)
      if (illust) {
        showIllust(illust)
        return
      }
      hideIllust()
      if (!board || !els || !base) return
      var def = (spec.states || {})[state] || {}
      var keepPrevious = params.keepPrevious === true || def.keepPrevious === true
      var canSuspend = board && typeof board.suspendUpdate === 'function'
      if (canSuspend) board.suspendUpdate()
      try {
        if (!keepPrevious) {
          JXGKit2D.resetFigure(board, els, base)
        }
        JXGKit2D.applyStateDef(board, els, def, base)
        syncBarGroups(els, barGroups)
      } finally {
        if (canSuspend && typeof board.unsuspendUpdate === 'function') board.unsuspendUpdate()
      }
    }

    function setState(next, params, runtime) {
      params = params || {}
      applyState(next, params)
      if (imageOnlyItem(state)) return
      var skipAnim = runtime && runtime.instant
      if (!skipAnim && board && els && base && params.actions && params.actions.length) {
        JXGKit2D.runActions(board, els, params.actions, base)
        syncBarGroups(els, barGroups)
      }
    }

    function resize() {
      if (!board) return
      if (typeof board.resizeContainer === 'function') board.resizeContainer()
      if (typeof board.fullUpdate === 'function') board.fullUpdate()
      else if (typeof board.update === 'function') board.update()
    }

    function reset() {
      if (board && els && base) JXGKit2D.resetFigure(board, els, base)
      applyState((spec.initialState && spec.initialState.state) || 'default')
    }

    function teardown() {
      if (figure) {
        figure.removeAttribute('data-figure-state')
        figure.removeAttribute('data-figure-template')
        setSpecIllust(figure, false)
      }
      if (imgEl && imgEl.parentNode) imgEl.parentNode.removeChild(imgEl)
      slot = null
      figure = null
      boardEl = null
      board = null
      els = null
      barGroups = null
      base = null
      imgEl = null
    }

    return {
      states: Object.keys(spec.states || {}),
      capabilities: Object.keys(spec.actions || {}),
      mount: mount,
      setState: setState,
      resize: resize,
      reset: reset,
      teardown: teardown
    }
  }

  function loadAll() {
    var list = window.FIGURE_SPECS || []
    if (Array.isArray(list)) list.forEach(function (spec) {
      if (!spec || !spec.figureTemplate) return
      var factory = function () {
        return spec.kind === 'image' ? makeImageFigure(spec) : makeFigure(spec)
      }
      factory.states = Object.keys(spec.states || {})
      factory.capabilities = Object.keys(spec.actions || {})
      AIClassFigureRegistry.register(spec.figureTemplate, factory)
    })
  }

  loadAll()

  window.AIClassFigureSpecLoader = { loadAll: loadAll }
})()
