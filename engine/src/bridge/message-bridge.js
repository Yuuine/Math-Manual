// 协议入口 — 父容器下发 action 驱动时间线（新引擎）
// 启动：挂载背景板 + board/stage（与旧引擎 message-bridge 对齐）
// 入站：{action} → renderState；course:reset → 清空画面回初始态；{type:'photo_result',value} → 回填作答区
// 出站：ready / step_ok / user_submitted
;(function () {
  var boot = window.__COURSE_BOOT || {}
  var boardStage = null
  var RESET_ACTIONS = { 'course:reset': true, '清空课件': true }

  function post(payload) {
    if (window.parent && window.parent !== window) {
      window.parent.postMessage(payload, boot.targetOrigin || '*')
    }
    if (typeof window.__onCourseMessage === 'function') window.__onCourseMessage(payload)
  }

  // 与旧引擎一致：网格纸背景 + lf-board / lf-stage + #course-flow
  function mountStackFlow() {
    if (!window.AIClassBackgroundBoard) {
      console.warn('[message-bridge] AIClassBackgroundBoard 未加载')
      return null
    }
    AIClassBackgroundBoard.ensureViewportBackground('course')
    boardStage = AIClassBackgroundBoard.mountBoardStage({
      boardId: 'course-stack-board',
      stageId: 'course-stack-stage',
      layout: { mode: 'stack', designWidth: 1200 },
      background: document.getElementById('course-bg')
    })

    var wrap = document.createElement('div')
    wrap.className = 'course-flow'
    wrap.id = 'course-flow'
    boardStage.stage.appendChild(wrap)
    if (window.AIClassContainerHost) AIClassContainerHost.setFlowEl(wrap)
    return boardStage
  }

  function renderByAction(action) {
    if (!action || !window.AIClassPlanLoader || !window.AIClassRenderState) return false
    var idx = window.AIClassPlanLoader.getIndexByAction(action)
    if (idx < 0) return false
    window.AIClassRenderState.renderState(idx, { instant: false })
    return true
  }

  // debug「清空课件」：清容器并回到 timeline[0]（silent 不发 step_ok，避免侧栏误标完成）
  function resetCourse() {
    if (!window.AIClassRenderState) return false
    AIClassRenderState.reset()
    if (window.AIClassPlanLoader && AIClassPlanLoader.getLength() > 0) {
      AIClassRenderState.renderState(0, { instant: true, silent: true })
    }
    return true
  }

  function showPhotoResult(value) {
    if (value == null) return
    if (window.AIClassPhotoAnswer && window.AIClassRenderState) {
      var flow = document.getElementById('course-flow')
      var card = flow && flow.querySelector('.cc-photo-answer')
      if (card) AIClassPhotoAnswer.showResult(card, String(value))
    }
  }

  function handleMessage(event) {
    var data = event.data
    if (!data) return
    if (data.type === 'photo_result') {
      showPhotoResult(data.value)
      return
    }
    if (typeof data.action === 'string' && data.action !== '') {
      if (RESET_ACTIONS[data.action]) {
        resetCourse()
        return
      }
      renderByAction(data.action)
    }
  }

  function init() {
    mountStackFlow()
    if (!window.AIClassPlanLoader) {
      post({ type: 'ready', status: 'error', message: 'PlanLoader missing' })
      return
    }
    window.AIClassPlanLoader.load(function (err) {
      if (err) {
        post({ type: 'ready', status: 'error', message: err.message })
        return
      }
      post({ type: 'ready', status: 'ok' })
      if (window.AIClassRenderState) {
        window.AIClassRenderState.renderState(0, { instant: true })
      }
    })
  }

  window.addEventListener('message', handleMessage)

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init)
  } else {
    init()
  }

  window.AIClassMessageBridge = {
    post: post,
    renderByAction: renderByAction,
    resetCourse: resetCourse,
    showPhotoResult: showPhotoResult,
    handleMessage: handleMessage,
    init: init,
    getBoardStage: function () { return boardStage }
  }
})()
