// plan.json 加载器 — 读取主编排文件，建时间线状态索引（id/action → stateIndex）
// file:// 兼容：优先用 window.MASTER_PLAN（编译产物/调试注入的 JS 包裹），
// 否则 XHR 拉取 __COURSE_BOOT.planPath（http 环境）。
;(function () {
  var timeline = []
  var byId = {}
  var byAction = {}
  var meta = null
  var quickQA = []

  // 题号行：与旧 generated module 对齐（head + difficulty → .course-stem-head）
  var HEAD_BY_MODULE = {
    knowledge: '知识点',
    example: '例',
    practice: '练',
    homework: '作业'
  }

  function inferDifficulty(plan) {
    if (plan.difficulty != null && plan.difficulty !== '') {
      var n = Number(plan.difficulty)
      return isFinite(n) ? n : null
    }
    var id = String(plan.courseId || plan.id || '')
    var m = id.match(/(\d+)\s*star/i)
    return m ? Number(m[1]) : null
  }

  function resolveHead(plan, difficulty) {
    if (Object.prototype.hasOwnProperty.call(plan, 'head')) {
      var rawHead = plan.head == null ? '' : String(plan.head).trim()
      return rawHead || null
    }
    if (plan.label != null && String(plan.label).trim() !== '') return String(plan.label)
    if (HEAD_BY_MODULE[plan.moduleType]) return HEAD_BY_MODULE[plan.moduleType]
    return difficulty >= 1 ? '例' : null
  }

  function normalizeQuickQA(plan) {
    var prefix = '例'
    return (plan.quickQA || []).map(function (item, index) {
      var suffix = index === 0 ? '' : String(index + 1)
      return {
        id: item.id || ('qa-' + (index + 1)),
        question: item.question || '',
        answer: item.answer,
        fillBlank: item.fillBlank === true,
        promptText: item.promptText || item.question || '',
        correctText: item.correctText || '',
        wrongText: item.wrongText || '',
        openAction: item.openAction || (prefix + '_快问快答_打开'),
        questionAction: item.questionAction || (prefix + '_快问快答' + suffix + '_显示问题'),
        answerAction: item.answerAction || (prefix + '_快问快答' + suffix + '_显示答案')
      }
    })
  }

  function normalizePlan(raw) {
    var plan = typeof raw === 'object' && raw !== null ? raw : null
    if (!plan) throw new Error('[PlanLoader] 主编排文件无效')
    var difficulty = inferDifficulty(plan)
    if (!(difficulty >= 1)) difficulty = null
    var difficultyMax = null
    if (difficulty >= 1) {
      difficultyMax = plan.difficultyMax != null ? Number(plan.difficultyMax) : 8
      if (!(difficultyMax >= 1)) difficultyMax = 8
    }
    quickQA = normalizeQuickQA(plan)
    meta = {
      courseId: plan.courseId || plan.id || '',
      title: plan.title || '',
      grade: plan.grade != null ? plan.grade : null,
      profile: plan.profile || '',
      layout: plan.layout || null,
      figure: plan.figure || null,
      outline: plan.outline || null,
      guidanceLayout: plan.guidanceLayout || 'interleaved',
      textAccumulate: plan.textAccumulate !== false,
      // 与旧 generated module 默认一致
      quickQALayout: plan.quickQALayout || (quickQA.length ? 'above-body' : null),
      head: resolveHead(plan, difficulty),
      difficulty: difficulty,
      difficultyMax: difficultyMax,
      // 例/练分容器：problem_source 每条 flow 对应一个 CourseContainer（中间 flow 并入上一题）
      problem_source: Array.isArray(plan.problem_source) ? plan.problem_source : []
    }
    timeline = Array.isArray(plan.timeline) ? plan.timeline.slice() : []
    byId = {}
    byAction = {}
    timeline.forEach(function (state, i) {
      if (!state || !state.id) return
      byId[state.id] = i
      ;(state.action && state.action.length ? state.action : [state.action]).forEach(function (entry) {
        var name = entry && typeof entry === 'object' ? entry.name : entry
        if (name != null && name !== '') byAction[String(name)] = i
      })
    })
    return { meta: meta, timeline: timeline, problemSource: plan.problem_source || [], quickQA: quickQA }
  }

  function load(cb) {
    var boot = window.__COURSE_BOOT || {}
    if (window.MASTER_PLAN) {
      var ready = normalizePlan(window.MASTER_PLAN)
      if (cb) cb(null, ready)
      return
    }
    var path = boot.planPath || 'plan.json'
    var xhr = new XMLHttpRequest()
    xhr.open('GET', path, true)
    xhr.onreadystatechange = function () {
      if (xhr.readyState !== 4) return
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          var data = normalizePlan(JSON.parse(xhr.responseText))
          if (cb) cb(null, data)
        } catch (err) {
          if (cb) cb(err)
        }
      } else if (cb) {
        cb(new Error('[PlanLoader] 加载失败 ' + path + ' (status ' + xhr.status + ')'))
      }
    }
    xhr.onerror = function () {
      if (cb) cb(new Error('[PlanLoader] 网络错误 ' + path))
    }
    xhr.send()
  }

  window.AIClassPlanLoader = {
    load: load,
    getTimeline: function () { return timeline },
    getMeta: function () { return meta },
    getQuickQA: function () { return quickQA },
    findQuickQA: function (qaId) {
      for (var i = 0; i < quickQA.length; i++) {
        if (quickQA[i].id === qaId) return quickQA[i]
      }
      return null
    },
    getIndexByAction: function (action) {
      return action != null ? (byAction[String(action)] != null ? byAction[String(action)] : -1) : -1
    },
    getIndexById: function (id) {
      return id != null ? (byId[id] != null ? byId[id] : -1) : -1
    },
    getState: function (index) { return timeline[index] || null },
    getLength: function () { return timeline.length }
  }
})()
