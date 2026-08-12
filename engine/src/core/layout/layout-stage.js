// 背景板缩放 — canvas（全屏自适应）与 stack（宽度等比缩放）两种模式
;(function () {
  function toCssSize(value) {
    if (value == null) return ''
    return typeof value === 'number' ? value + 'px' : String(value)
  }

  function removeById(root, id) {
    if (!root || !id) return
    var existing = root.querySelector('#' + id)
    if (existing && existing.parentNode) existing.parentNode.removeChild(existing)
  }

  function designSize(layout) {
    layout = layout || {}
    return {
      width: layout.designWidth || window.DESIGN_WIDTH || 1200,
      height: layout.designHeight || window.DESIGN_HEIGHT || 680
    }
  }

  function sync(stage, bg, layout) {
    if (!stage) return
    var size = designSize(layout)
    // rem 适配：根字号 = 16px × (视口宽度 / 设计宽度)，rem 内容随根字号等比缩放（替代 transform:scale）
    var baseFs = 16
    var fs = baseFs * (window.innerWidth / size.width)
    document.documentElement.style.fontSize = fs + 'px'

    // 舞台铺满视口：不缩放、不居中偏移；高度比例不足时由 stage 内滚
    stage.style.width = '100%'
    stage.style.height = '100%'
    stage.style.minHeight = ''
    stage.style.left = '0'
    stage.style.top = '0'
    stage.style.overflowY = 'auto'
    stage.style.overflowX = 'hidden'
    stage.style.transform = 'none'
    stage.style.transformOrigin = 'top left'

    // 兼容变量固定 1/0：scroll-index / mathlive / viewport-scale 走 no-op
    document.documentElement.style.setProperty('--lf-board-scale', '1')
    document.documentElement.style.setProperty('--lf-board-offset-x', '0px')
    document.documentElement.style.setProperty('--lf-board-offset-y', '0px')

    if (bg) {
      // 网格背景随 rem 缩放（20px 设计 = 1.25rem，100px = 6.25rem）
      var unit = '1.25rem'
      var unit5 = '6.25rem'
      bg.style.backgroundSize =
        unit + ' ' + unit + ', ' +
        unit + ' ' + unit + ', ' +
        unit5 + ' ' + unit5 + ', ' +
        unit5 + ' ' + unit5
      bg.style.backgroundPosition = '0 0'
    }
  }

  function resolveMountRoot(config, id, bg, onResize) {
    config = config || {}
    var explicitRoot = config.root
      ? (typeof config.root === 'string' ? document.querySelector(config.root) : config.root)
      : null
    var hostRoot = explicitRoot || document.getElementById(window.CONTENT_ID || 'matrix-content')
    if (hostRoot) {
      return {
        root: hostRoot,
        board: null,
        stage: null,
        ownsStage: false,
        resizeHandler: null
      }
    }

    removeById(document.body, id + '-board')
    var board = document.createElement('div')
    board.id = id + '-board'
    board.className = 'lf-board'

    var stage = document.createElement('div')
    stage.id = id + '-stage'
    stage.className = 'lf-stage'
    board.appendChild(stage)
    document.body.appendChild(board)

    var layout = config.layout || {}
    sync(stage, bg, layout)
    var resizeHandler = function () {
      sync(stage, bg, layout)
      if (typeof onResize === 'function') onResize()
    }
    window.addEventListener('resize', resizeHandler)

    return {
      root: stage,
      board: board,
      stage: stage,
      ownsStage: true,
      resizeHandler: resizeHandler
    }
  }

  window.AIClassLayoutStage = {
    toCssSize: toCssSize,
    removeById: removeById,
    designSize: designSize,
    sync: sync,
    resolveMountRoot: resolveMountRoot
  }
})()
