// renderState — 时间线状态确定性渲染（主驱动）
// 语义：
//  - 每个 timeline 状态 = 自包含完成态快照（blocks 描述该状态画面）
//  - 顺序 +1 前进：在现有容器上增量追加新块（动画播放，画面渐进）
//  - 回退 / 跳步：整屏重建该状态完成态（瞬间，无动画）
//  - 多容器（对齐旧 ContainerHost）：problem_source 每道题一块；
//    例题+讲解/快问快答同一块，练习题另起一块追加在下方（不替换例题）
//  - 顶栏：head/difficulty + region:top 题干，StemExpand 限高展开/收起
//  - 快问快答：state.qa = open|question|answer|close（对齐旧 AIClassQuickQA）
//  - 跟滚：追加后调用 AIClassScrollFollow（对齐旧 scheduler.followContent）
;(function () {
  var container = null
  var containerRecord = null
  var currentIndex = -1
  var activeContainerIdx = -1
  var pendingAlignStart = false

  function resolveFigure(figure) {
    if (!figure) return null
    if (typeof figure === 'string' &&
        window.AIClassFigureRegistry && typeof window.AIClassFigureRegistry.resolve === 'function') {
      return window.AIClassFigureRegistry.resolve(figure)
    }
    return figure
  }

  function figureTemplateId(metaFigure, state) {
    var m = state && state.figureTemplate ? state.figureTemplate : metaFigure
    if (!m) return null
    if (typeof m === 'string') return m
    if (m && m.template) return m.template
    return null
  }

  function lessonConfig() {
    return { meta: {}, handlers: window.LESSON_HANDLERS || {} }
  }

  function blockKey(block) {
    if (!block) return null
    if (block.replaceKey != null && block.replaceKey !== '') return 'k:' + block.replaceKey
    if (block.id != null) return 'id:' + block.id
    return null
  }

  function isTopBlock(block) {
    var region = block && (block.region || block.zone)
    return region === 'top'
  }

  // flow_id → 容器下标：problem_source[i].flow_id → i；其它 flow 并入「当前题」
  function buildFlowContainerMap(loader, meta) {
    var sources = (meta && meta.problem_source) || []
    var problemFlows = {}
    for (var si = 0; si < sources.length; si++) {
      var ps = sources[si]
      if (ps && ps.flow_id) problemFlows[String(ps.flow_id)] = si
    }
    var flowMap = {}
    var active = 0
    var n = loader.getLength()
    for (var i = 0; i < n; i++) {
      var st = loader.getState(i)
      if (!st) continue
      var fid = st.flow_id != null ? String(st.flow_id) : ''
      if (fid && problemFlows[fid] != null) active = problemFlows[fid]
      if (fid && flowMap[fid] == null) flowMap[fid] = active
    }
    return { flowMap: flowMap, problemFlows: problemFlows }
  }

  function containerIdxForState(state, maps) {
    if (!state) return 0
    if (state.containerIdx != null && state.containerIdx !== '') {
      var n = Number(state.containerIdx)
      return isFinite(n) && n >= 0 ? n : 0
    }
    var fid = state.flow_id != null ? String(state.flow_id) : ''
    if (fid && maps && maps.flowMap && maps.flowMap[fid] != null) return maps.flowMap[fid]
    return 0
  }

  function accumulateBlocksForContainer(loader, index, targetIdx, maps) {
    var map = {}
    var order = []
    for (var i = 0; i <= index; i++) {
      var state = loader.getState(i)
      if (!state || containerIdxForState(state, maps) !== targetIdx) continue
      var list = state.blocks || []
      for (var bi = 0; bi < list.length; bi++) {
        var block = list[bi]
        if (!block) continue
        var key = blockKey(block)
        if (key) {
          if (map[key] == null) order.push(key)
          map[key] = block
        } else {
          var anon = 'anon:' + i + ':' + bi
          order.push(anon)
          map[anon] = block
        }
      }
    }
    return order.map(function (k) { return map[k] })
  }

  function seedStateForContainer(loader, index, targetIdx, maps) {
    var seed = null
    for (var i = 0; i <= index; i++) {
      var st = loader.getState(i)
      if (!st || containerIdxForState(st, maps) !== targetIdx) continue
      if (!seed) seed = st
      if (st.head != null) return st
    }
    return seed
  }

  function lastStateForContainer(loader, index, targetIdx, maps) {
    var last = null
    for (var i = 0; i <= index; i++) {
      var st = loader.getState(i)
      if (!st || containerIdxForState(st, maps) !== targetIdx) continue
      last = st
    }
    return last
  }

  function maxContainerIdxThrough(loader, index, maps) {
    var max = 0
    for (var i = 0; i <= index; i++) {
      var st = loader.getState(i)
      if (!st) continue
      var c = containerIdxForState(st, maps)
      if (c > max) max = c
    }
    return max
  }

  function ensureFlowEl() {
    var flowEl = document.getElementById('course-flow')
    if (flowEl) return flowEl
    flowEl = document.createElement('div')
    flowEl.id = 'course-flow'
    flowEl.className = 'course-flow'
    var stage = document.getElementById('course-stack-stage') || document.querySelector('.lf-stage')
    if (stage) stage.appendChild(flowEl)
    else document.body.appendChild(flowEl)
    return flowEl
  }

  function stopFollowAndQa(destroyQa) {
    if (destroyQa && window.AIClassQuickQA && typeof AIClassQuickQA.destroy === 'function') {
      AIClassQuickQA.destroy()
    }
    if (window.AIClassScrollFollow && typeof AIClassScrollFollow.stop === 'function') {
      AIClassScrollFollow.stop()
    }
  }

  function teardownActiveStem() {
    if (container && container.el && typeof container.el._stemExpandTeardown === 'function') {
      container.el._stemExpandTeardown()
    }
  }

  function layoutParamsFromMeta(meta) {
    var layoutType = (meta.layout && meta.layout.type) || 'text-only'
    var layoutParams = Object.assign({}, (meta.layout && meta.layout.params) || {})
    if (layoutType === 'text-only' &&
        (layoutParams.textMaxWidth == null || layoutParams.textMaxWidth === '')) {
      layoutParams.textMaxWidth = 'none'
    }
    return { layoutType: layoutType, layoutParams: layoutParams }
  }

  function buildHostMeta(meta, state, containerIdx) {
    var layout = layoutParamsFromMeta(meta)
    var isFirst = containerIdx === 0
    var guidanceChain = null
    var guidanceLayout = meta.guidanceLayout || 'interleaved'
    if (state && state.outline) {
      guidanceChain = state.outline
    } else if (isFirst) {
      guidanceChain = meta.outline || null
    } else {
      // 练习等后续容器：默认不带例题讲解链（对齐旧 practice 独立 module）
      guidanceChain = null
      guidanceLayout = 'stacked'
    }
    return {
      moduleId: 'main',
      containerId: 'c' + containerIdx,
      containerIdx: containerIdx,
      layout: layout.layoutType,
      layoutParams: layout.layoutParams,
      style: (meta.layout && meta.layout.style) || {},
      figure: resolveFigure(figureTemplateId(meta.figure, state)),
      head: state && state.head != null ? state.head : (isFirst ? (meta.head || null) : null),
      difficulty: state && state.difficulty != null
        ? state.difficulty
        : (meta.difficulty || null),
      difficultyMax: meta.difficultyMax || null,
      problemBrief: (state && state.problemBrief) || null,
      textAccumulate: meta.textAccumulate !== false,
      guidanceLayout: guidanceLayout,
      guidanceChain: guidanceChain
    }
  }

  function createOneContainer(meta, state, containerIdx) {
    var flowEl = ensureFlowEl()
    if (window.AIClassContainerHost) AIClassContainerHost.setFlowEl(flowEl)
    if (!window.AIClassCourseContainer && !window.AIClassContainerHost) return null

    var hostMeta = buildHostMeta(meta, state, containerIdx)
    var record = null

    if (window.AIClassContainerHost && typeof AIClassContainerHost.create === 'function') {
      record = AIClassContainerHost.create(hostMeta)
    } else {
      var created = window.AIClassCourseContainer.create({
        mount: flowEl,
        layout: hostMeta.layout,
        layoutParams: hostMeta.layoutParams,
        style: hostMeta.style,
        figure: hostMeta.figure,
        head: hostMeta.head,
        difficulty: hostMeta.difficulty,
        difficultyMax: hostMeta.difficultyMax,
        problemBrief: hostMeta.problemBrief,
        textAccumulate: hostMeta.textAccumulate,
        guidanceLayout: hostMeta.guidanceLayout,
        guidanceChain: hostMeta.guidanceChain,
        meta: {
          moduleId: hostMeta.moduleId,
          containerId: hostMeta.containerId,
          containerIdx: hostMeta.containerIdx
        }
      })
      record = {
        el: created.getElement(),
        container: created,
        scrollEl: created.getScrollEl()
      }
    }
    record.quickQALayout = meta.quickQALayout || 'above-body'
    return record
  }

  function resetAllContainers() {
    teardownActiveStem()
    stopFollowAndQa(true)
    if (window.AIClassContainerHost) AIClassContainerHost.reset()
    container = null
    containerRecord = null
    activeContainerIdx = -1
  }

  function setActiveContainer(record, idx) {
    containerRecord = record
    container = record ? record.container : null
    activeContainerIdx = idx
  }

  function orderTopThenBody(blocks) {
    var topBlocks = []
    var bodyBlocks = []
    blocks.forEach(function (b) {
      if (isTopBlock(b)) topBlocks.push(b)
      else bodyBlocks.push(b)
    })
    return topBlocks.concat(bodyBlocks)
  }

  function syncStemHeadLabel(state, meta) {
    if (!container || !container.scrollEl) return
    var head = state && state.head != null ? state.head : (meta && meta.head)
    if (head == null) return
    var label = container.scrollEl.querySelector('.course-stem-head .course-label')
    if (label) label.textContent = String(head)
  }

  function followContent(anchorEl, instant) {
    if (!window.AIClassScrollFollow || !containerRecord) return
    if (instant && typeof AIClassScrollFollow.stop === 'function') {
      // 瞬间重建：停掉动画跟滚，交给布局自然落位；仍触发一次 follow 便于内层滚到末块
    }
    var opts = {
      stage: document.getElementById('course-stack-stage') || document.querySelector('.lf-stage'),
      pageEl: containerRecord.el
    }
    if (pendingAlignStart) {
      opts.alignStart = true
      pendingAlignStart = false
    }
    var c = containerRecord.container
    if (c && typeof c.getFollowScrollEl === 'function') {
      var inner = c.getFollowScrollEl()
      if (anchorEl && anchorEl.closest) {
        if (c.scrollLeftEl && c.scrollLeftEl.contains(anchorEl)) inner = c.scrollLeftEl
        else if (c.scrollRightEl && c.scrollRightEl.contains(anchorEl)) inner = c.scrollRightEl
      }
      if (inner) {
        opts.scrollEl = inner
        opts.layoutScrollEl = inner
      }
    }
    AIClassScrollFollow.follow(anchorEl || containerRecord.el, opts)
  }

  function blockFingerprint(block) {
    if (!block) return ''
    try {
      return JSON.stringify(block)
    } catch (err) {
      return String(block.id || '') + ':' + String(block.replaceKey || '')
    }
  }

  // 新增块，或同 replaceKey/id 内容变更（走 appendBlocks 替换路径）
  function deltaBlocks(current, next) {
    var prevByKey = {}
    ;(current && current.blocks || []).forEach(function (b) {
      var key = blockKey(b)
      if (key) prevByKey[key] = b
    })
    return (next && next.blocks || []).filter(function (b) {
      var key = blockKey(b)
      if (!key) return true
      if (!prevByKey[key]) return true
      return blockFingerprint(prevByKey[key]) !== blockFingerprint(b)
    })
  }

  function guideGroupFromState(state) {
    if (!state || state.outlineIndex == null) return null
    var n = Number(state.outlineIndex)
    if (!isFinite(n) || n < 0) return null
    return n + 1
  }

  function appendOpts(state, instant, isForward) {
    return {
      stepId: state && state.id,
      isCurrentStep: true,
      instant: instant === true ? true : (isForward ? false : true),
      group: guideGroupFromState(state),
      config: lessonConfig()
    }
  }

  function resolveQaOp(state) {
    if (!state) return null
    if (state.qa === 'open' || state.qa === 'question' || state.qa === 'answer' || state.qa === 'close') {
      return state.qa
    }
    if (state.type === 'quick_qa' || state.type === 'quickQA') {
      return state.qaOp || state.qa || 'question'
    }
    return null
  }

  function withQaContainer(fn) {
    // 快问快答挂在例题容器（下标 0）上
    var qaRecord = window.AIClassContainerHost
      ? AIClassContainerHost.get('main', 0)
      : (activeContainerIdx === 0 ? containerRecord : null)
    if (!qaRecord) qaRecord = containerRecord
    var prevRecord = containerRecord
    var prevIdx = activeContainerIdx
    if (qaRecord && qaRecord !== prevRecord) setActiveContainer(qaRecord, 0)
    try {
      return fn()
    } finally {
      setActiveContainer(prevRecord, prevIdx)
    }
  }

  function applyQuickQA(state, meta) {
    var op = resolveQaOp(state)
    if (!op) return false
    if (!window.AIClassQuickQA) {
      console.warn('[render-state] AIClassQuickQA 未加载')
      return true
    }
    if (!containerRecord) return true

    var useAboveBody = (meta && meta.quickQALayout) === 'above-body' ||
      containerRecord.quickQALayout === 'above-body'

    if (op === 'open') {
      if (useAboveBody) AIClassQuickQA.mountAboveBody(containerRecord)
      else if (AIClassQuickQA.isMinimized()) AIClassQuickQA.restore(containerRecord)
      else AIClassQuickQA.mount(containerRecord)
      return true
    }
    if (op === 'close') {
      if (AIClassQuickQA.isOpen()) AIClassQuickQA.hide()
      return true
    }

    var qaId = state.qaId
    var qaItem = null
    if (window.AIClassPlanLoader) {
      if (qaId) qaItem = AIClassPlanLoader.findQuickQA(qaId)
      if (!qaItem && state.question) {
        qaItem = {
          id: qaId || state.id,
          question: state.question,
          answer: state.qaAnswer != null ? state.qaAnswer : state.answer,
          fillBlank: state.fillBlank === true
        }
      }
    }
    if (!qaItem) {
      console.warn('[render-state] 未找到 quickQA 项: ' + qaId)
      return true
    }

    if (op === 'question') {
      if (!AIClassQuickQA.isOpen()) {
        if (useAboveBody) AIClassQuickQA.mountAboveBody(containerRecord)
        else AIClassQuickQA.mount(containerRecord)
      }
      AIClassQuickQA.showQuestion(containerRecord, qaItem)
      return true
    }
    if (op === 'answer') {
      if (!AIClassQuickQA.isOpen()) {
        if (useAboveBody) AIClassQuickQA.mountAboveBody(containerRecord)
        else AIClassQuickQA.mount(containerRecord)
        AIClassQuickQA.showQuestion(containerRecord, qaItem)
      }
      AIClassQuickQA.showAnswer(qaItem)
      return true
    }
    return true
  }

  function replayQuickQA(loader, index, meta) {
    if (!window.AIClassQuickQA) return
    withQaContainer(function () {
      var lastOpen = -1
      var lastClose = -1
      var lastQuestion = null
      var lastAnswer = null
      for (var i = 0; i <= index; i++) {
        var st = loader.getState(i)
        var op = resolveQaOp(st)
        if (!op) continue
        if (op === 'open') lastOpen = i
        if (op === 'close') lastClose = i
        if (op === 'question') lastQuestion = st
        if (op === 'answer') lastAnswer = st
      }
      if (lastClose > lastOpen) {
        if (AIClassQuickQA.isOpen()) AIClassQuickQA.hide()
        return
      }
      if (lastOpen < 0 && !lastQuestion) return
      applyQuickQA({ qa: 'open' }, meta)
      if (lastQuestion) applyQuickQA(lastQuestion, meta)
      if (lastAnswer && lastQuestion &&
          (lastAnswer.qaId == null || lastAnswer.qaId === lastQuestion.qaId)) {
        applyQuickQA(lastAnswer, meta)
      }
    })
  }

  function applyContainerChrome(c, state, instant, isForward) {
    if (!c || !state) return
    if (state.figureState && typeof c.setFigureState === 'function') {
      c.setFigureState(state.figureState, {
        stepId: state.id,
        action: state.action,
        instant: instant || !isForward
      })
    }
    if (state.outlineIndex != null && typeof c.setGuidanceGroup === 'function') {
      var guideGroup = guideGroupFromState(state)
      if (guideGroup != null) c.setGuidanceGroup(guideGroup, {})
    }
    if (state.problemBrief && typeof c.setProblemBriefState === 'function') {
      c.setProblemBriefState(state.problemBrief)
    }
    if (typeof c.finalizeInteractions === 'function') {
      c.finalizeInteractions(state.id)
    }
    if (state.answer_type === 'course_photo' && typeof c.showPhotoAnswer === 'function') {
      c.showPhotoAnswer(function () {
        if (window.AIClassCoursewareSubmit && typeof AIClassCoursewareSubmit.requestPhoto === 'function') {
          AIClassCoursewareSubmit.requestPhoto()
        }
      })
    }
  }

  function rebuildToIndex(loader, meta, index, maps) {
    resetAllContainers()
    if (!window.AIClassCourseContainer && !window.AIClassContainerHost) return false

    var maxIdx = maxContainerIdxThrough(loader, index, maps)
    var records = {}
    for (var cIdx = 0; cIdx <= maxIdx; cIdx++) {
      var seed = seedStateForContainer(loader, index, cIdx, maps)
      if (!seed && cIdx > 0) continue
      var record = createOneContainer(meta, seed || loader.getState(index), cIdx)
      if (!record) return false
      records[cIdx] = record

      var blocks = accumulateBlocksForContainer(loader, index, cIdx, maps)
      if (blocks.length) {
        blocks = orderTopThenBody(blocks)
        var last = lastStateForContainer(loader, index, cIdx, maps) || seed
        record.container.appendBlocks(blocks, appendOpts(last, true, false))
      }
      var lastState = lastStateForContainer(loader, index, cIdx, maps)
      if (lastState) applyContainerChrome(record.container, lastState, true, false)
    }

    var activeIdx = containerIdxForState(loader.getState(index), maps)
    setActiveContainer(records[activeIdx] || records[0] || null, activeIdx)
    if (!container) return false

    replayQuickQA(loader, index, meta)
    return true
  }

  function renderState(index, opts) {
    opts = opts || {}
    var loader = window.AIClassPlanLoader
    var meta = loader.getMeta()
    var state = loader.getState(index)
    if (!state) return { ok: false, error: 'unknown state index ' + index }

    var maps = buildFlowContainerMap(loader, meta)
    var prev = currentIndex >= 0 ? loader.getState(currentIndex) : null
    var nextIdx = containerIdxForState(state, maps)
    var prevIdx = prev ? containerIdxForState(prev, maps) : -1
    var isForward = !opts.instant && index === currentIndex + 1 && container
    var instant = opts.instant === true
    var appended = []
    var sameContainerForward = isForward && nextIdx === activeContainerIdx && nextIdx === prevIdx

    if (!container || !isForward) {
      if (!rebuildToIndex(loader, meta, index, maps)) {
        return { ok: false, error: 'container not available' }
      }
    } else if (!sameContainerForward) {
      // 前进进入新容器：追加，不 reset 例题块
      stopFollowAndQa(false)
      var existing = window.AIClassContainerHost
        ? AIClassContainerHost.get('main', nextIdx)
        : null
      var createdNew = !existing
      var record = existing || createOneContainer(meta, state, nextIdx)
      if (!record) return { ok: false, error: 'container not available' }
      setActiveContainer(record, nextIdx)
      // 对齐旧 scheduler：新容器进 stack 时顶对齐翻页
      if (createdNew) {
        var inStack = window.AIClassContainerHost &&
          typeof AIClassContainerHost.isStackMode === 'function' &&
          AIClassContainerHost.isStackMode()
        pendingAlignStart = !!inStack || nextIdx > 0
      }
    }

    var qaOnly = resolveQaOp(state) && !(state.blocks && state.blocks.length)
    if (!qaOnly) {
      var blocks
      if (sameContainerForward) {
        blocks = deltaBlocks(prev, state)
      } else if (isForward && !sameContainerForward) {
        blocks = (state.blocks || []).slice()
      } else {
        // rebuild 已灌块
        blocks = []
      }
      if (blocks.length) {
        if (!isForward) blocks = orderTopThenBody(blocks)
        appended = container.appendBlocks(blocks, appendOpts(state, instant, isForward)) || []
      }
      syncStemHeadLabel(state, meta)
    }

    if (resolveQaOp(state)) {
      withQaContainer(function () { applyQuickQA(state, meta) })
    }

    if (!qaOnly || isForward) {
      applyContainerChrome(container, state, instant, isForward)
    }

    var anchor = null
    if (appended && appended.length) {
      for (var ai = appended.length - 1; ai >= 0; ai--) {
        var node = appended[ai]
        if (node && node.getAttribute && node.getAttribute('data-block-replaced') === 'true') continue
        anchor = node
        break
      }
    }
    if (anchor) followContent(anchor, instant)

    currentIndex = index

    if (!opts.silent && window.AIClassExecutionLog && typeof AIClassExecutionLog.post === 'function') {
      var actionName = state.action
      if (Object.prototype.toString.call(actionName) === '[object Array]') {
        actionName = actionName.length ? actionName[0] : ''
      }
      AIClassExecutionLog.post({ type: 'step_ok', action: actionName })
    }
    return { ok: true, index: index, action: state.action, containerIdx: activeContainerIdx }
  }

  window.AIClassRenderState = {
    renderState: renderState,
    getCurrentIndex: function () { return currentIndex },
    getContainerRecord: function () { return containerRecord },
    getActiveContainerIdx: function () { return activeContainerIdx },
    reset: function () {
      currentIndex = -1
      pendingAlignStart = false
      resetAllContainers()
    }
  }
})()
