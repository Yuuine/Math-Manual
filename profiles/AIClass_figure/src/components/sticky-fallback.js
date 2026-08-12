// sticky 兜底 — Chrome 51 / iOS 13 无 position: sticky 时，用 fixed + 占位模拟 .cc-problem-brief 吸顶
// 只在支持探测失败时生效；现代浏览器零影响
;(function () {
  var ns = window.AIClassComponent = window.AIClassComponent || {}
  var supports = null
  var tracked = null
  var spacer = null

  function supportsSticky() {
    if (supports != null) return supports
    var el = document.createElement('div')
    el.style.position = 'sticky'
    supports = el.style.position === 'sticky'
    return supports
  }

  function update() {
    if (!tracked) return
    var rect = tracked.getBoundingClientRect()
    var host = tracked.closest('.course-scroll-right, .course-body, .course-flow')
    var hostRect = (host || tracked.parentNode).getBoundingClientRect()
    var shouldStick = rect.top <= hostRect.top
    if (shouldStick) {
      tracked.classList.add('is-stuck')
      tracked.style.left = hostRect.left + 'px'
      tracked.style.width = hostRect.width + 'px'
      if (spacer) spacer.style.display = 'block'
    } else {
      tracked.classList.remove('is-stuck')
      tracked.style.left = ''
      tracked.style.width = ''
      if (spacer) spacer.style.display = 'none'
    }
  }

  function install(panel) {
    if (supportsSticky()) return
    if (!panel || panel.classList.contains('cc-problem-brief--embedded')) return
    if (tracked === panel) {
      update()
      return
    }
    tracked = panel
    // 占位：panel 切 fixed 后保持流布局，下方内容不上移
    if (spacer && spacer.parentNode && spacer.parentNode !== panel.parentNode) {
      spacer.parentNode.removeChild(spacer)
      spacer = null
    }
    if (!spacer && panel.parentNode) {
      spacer = document.createElement('div')
      spacer.className = 'cc-problem-brief-spacer'
      spacer.style.height = (panel.offsetHeight || 0) + 'px'
      panel.parentNode.insertBefore(spacer, panel)
    }
    document.documentElement.classList.add('no-sticky')
    window.addEventListener('scroll', update, true)
    window.addEventListener('resize', update)
    update()
  }

  ns.installStickyFallback = install
})()
