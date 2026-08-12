import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawn } from 'node:child_process'
import { courseIdFromInput, validSlug } from './course-id-from-md.mjs'
import { distRoot, outputLessonDir, outputCourseDir, findOutputCourseDir, platformRoot } from '../../output-paths.mjs'
import { buildStandardPlanSchema } from '../schemas/standard-plan.js'
import { expectedQuickQACount } from './quickqa-by-difficulty.mjs'

export function createAiclass({ profile, root, repoRoot, Ajv2020 }) {
  const PROFILE = profile
  const generatedName = '.generated'
const referenceSentinels = [
  'AICLASS_REFERENCE_ONLY',
  'REFERENCE_ONLY_DO_NOT_COPY',
  '"referenceOnly": true'
]

function collectFigureModulePaths(courseDir) {
  const modulesDir = path.join(courseDir, 'lesson', 'modules')
  if (!fs.existsSync(modulesDir)) return []
  return fs
    .readdirSync(modulesDir)
    .filter((name) => /^_.+-figure\.js$/i.test(name))
    .sort()
    .map((name) => `lesson/modules/${name}`)
}

function generateFigureModule(spec) {
  const template = spec && spec.figureTemplate
  if (!template) return null
  const specJson = safeJsonForScript(spec)
  return {
    name: `_${template}-figure.js`,
    source: `// @generated from figure-spec ${spec.id || ''}; do not edit.
;(function () {
  'use strict'
  var SPEC = ${specJson}
  var root = null
  var board = null
  var els = null
  var base = null
  var state = (SPEC.initialState && SPEC.initialState.state) || 'default'

  function mount(target) {
    if (root) return
    root = target
    root.setAttribute('data-figure-template', SPEC.figureTemplate)
    AIClassJSXGraph.ready().then(function () {
      if (!root) return
      var mounted = JXGKit2D.mount(root, { board: SPEC.board || {} })
      board = mounted.board
      els = drawFigure(board, SPEC)
      base = JXGKit2D.captureBase(els)
      applyState(state)
    }).catch(function (err) {
      if (root) root.textContent = '图形加载失败: ' + err.message
    })
  }

  function drawFigure(board, spec) {
    // 所有构件按稳定 id 登记，plan 的 figure.actions targets 据此解析
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
    ;(spec.functions || []).forEach(function (fn, index) {
      var expr = fn.expr || fn.expression
      if (!expr) return
      var curve = board.create('functiongraph', [
        function (x) { return evalExpr(expr, x) }
      ], {
        strokeColor: fn.strokeColor || '#1d4ed8',
        strokeWidth: fn.strokeWidth != null ? fn.strokeWidth : 2.5,
        visible: fn.visible !== false,
        fixed: true,
        highlight: false
      })
      els.curves[fn.id || fn.name || 'curve-' + index] = curve
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
    ;(spec.polygons || []).forEach(function (poly, index) {
      var vertNames = poly.vertices || poly.points || []
      var verts = vertNames.map(function (v) { return points[v] })
      var polyEl = board.create('polygon', verts, Object.assign({
        fillColor: poly.fillColor || '#3b82f6',
        fillOpacity: poly.fillOpacity != null ? poly.fillOpacity : 0.25,
        borders: { strokeColor: '#1e293b', strokeWidth: 2, visible: true },
        visible: poly.visible !== false,
        fixed: true,
        highlight: false,
        vertices: { visible: false, fixed: true }
      }, poly))
      els.polygons[poly.id || poly.name || vertNames.join('') || 'polygon-' + index] = polyEl
    })
    ;(spec.circles || []).forEach(function (cir, index) {
      var parents
      if (cir.through != null) {
        parents = [points[cir.center], points[cir.through]]
      } else {
        parents = [points[cir.center], cir.radius]
      }
      var attrs = Object.assign({
        strokeColor: '#1e293b',
        strokeWidth: 2,
        visible: cir.visible !== false,
        fixed: true,
        highlight: false
      }, cir)
      delete attrs.center
      delete attrs.through
      delete attrs.radius
      els.circles[cir.id || cir.name || 'circle-' + index] = board.create('circle', parents, attrs)
    })
    ;(spec.arcs || []).forEach(function (arc, index) {
      var attrs = Object.assign({
        strokeColor: '#1e293b',
        strokeWidth: 2,
        visible: arc.visible !== false,
        fixed: true,
        highlight: false
      }, arc)
      delete attrs.center
      delete attrs.from
      delete attrs.start
      delete attrs.to
      delete attrs.end
      els.arcs[arc.id || arc.name || 'arc-' + index] = board.create('arc', [
        points[arc.center],
        points[arc.from || arc.start],
        points[arc.to || arc.end]
      ], attrs)
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
      var textEl = board.create('text', parents, Object.assign({
        fixed: true,
        highlight: false,
        fontSize: 14,
        visible: t.visible !== false
      }, attrs))
      els.texts[t.id || t.name || 'text-' + index] = textEl
    })
    return els
  }

  function evalExpr(expr, x) {
    var safe = String(expr).replace(/x/g, '(' + x + ')')
    // eslint-disable-next-line no-new-func
    return Function('"use strict"; return (' + safe + ')')()
  }

  function applyState(next, params) {
    state = next || 'default'
    if (root) root.setAttribute('data-figure-state', state)
    if (!board || !els || !base) return
    if (!params || params.keepPrevious !== true) {
      JXGKit2D.resetFigure(board, els, base)
    }
    JXGKit2D.applyStateDef(board, els, (SPEC.states || {})[state], base)
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
    applyState((SPEC.initialState && SPEC.initialState.state) || 'default')
  }

  function teardown() {
    if (root) root.removeAttribute('data-figure-state')
    if (root) root.removeAttribute('data-figure-template')
    root = null
    board = null
    els = null
    base = null
  }

  window.AIClassFigureRegistry.register(SPEC.figureTemplate, {
    states: Object.keys(SPEC.states || {}),
    capabilities: Object.keys(SPEC.actions || {}),
    mount: mount,
    setState: setState,
    reset: reset,
    teardown: teardown
  })
})()
`
  }
}

function generatedFigure(figure) {
  if (!figure || !figure.state) return null
  return {
    ...figure,
    animate: figure.animate === true ||
      Boolean(figure.transition) ||
      Boolean(figure.actions && figure.actions.length)
  }
}

function validateTopSplitStructure(plan) {
  const steps = plan.steps || []
  const retains = (step, id) => {
    const rp = step && step.retainPush
    if (rp == null) return false
    if (rp === true) return true
    const list = Array.isArray(rp) ? rp : [rp]
    return list.some((value) => String(value) === String(id))
  }
  const pinBlocks = (step) => (step.push || [])
    .filter((b) => /calc-key-pin/.test(String(b.class || ''))).length

  const keyStart = steps.find((s) => /_详解_起$/.test(s.action || ''))
  if (!keyStart) return // 极简 top-split（无详解阶段）不强制

  // 详解_起：必须右栏钉 calc-key-pin；禁止 retainPush（否则要点区不清、右钉错位）
  if (pinBlocks(keyStart) < 1) {
    throw new Error(`top-split 详解_起 must pin calc-key-pin: ${plan.id}/${keyStart.id}`)
  }
  if (keyStart.retainPush != null) {
    throw new Error(`top-split 详解_起 must not carry retainPush: ${plan.id}/${keyStart.id}`)
  }

  const pointAcc = []
  const detailIds = []
  let inDetail = false
  for (const step of steps) {
    const action = step.action || ''
    if (step.id === 'start') continue
    if (/详解_起$/.test(action)) { inDetail = true; continue }
    if (inDetail) {
      if (/详解_步/.test(action) || /答案$/.test(action)) {
        const need = [keyStart.id, ...detailIds]
        const missing = need.filter((id) => !retains(step, id))
        if (missing.length) {
          throw new Error(
            `top-split ${/答案$/.test(action) ? '答案' : '详解步'} must retainPush [详解_起 + prior 详解步] (missing ${missing.join(',')}): ${plan.id}/${step.id}`
          )
        }
        if (/详解_步/.test(action)) detailIds.push(step.id)
      }
      continue
    }
    // 要点阶段：除首个外，保留前序所有要点步，避免阶段内容被后续步清掉
    if (/要点_/.test(action)) {
      const missing = pointAcc.filter((id) => !retains(step, id))
      if (missing.length) {
        throw new Error(
          `top-split 要点 must accumulate prior 要点 in retainPush (missing ${missing.join(',')}): ${plan.id}/${step.id}`
        )
      }
      pointAcc.push(step.id)
    }
  }
}


function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function writeText(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, value, 'utf8')
}

function copyFile(source, target) {
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.copyFileSync(source, target)
}

function copyDirectory(source, target, options = {}) {
  if (!fs.existsSync(source)) return
  fs.mkdirSync(target, { recursive: true })
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    if ((options.exclude || []).includes(entry.name)) continue
    const from = path.join(source, entry.name)
    const to = path.join(target, entry.name)
    if (entry.isDirectory()) copyDirectory(from, to, options)
    else copyFile(from, to)
  }
}

function removeDirectory(target) {
  fs.rmSync(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
}

/** Windows often locks dist/<courseId> while debug iframe is open; overwrite in place. */
function publishExportDirectory(temp, finalDir) {
  fs.mkdirSync(path.dirname(finalDir), { recursive: true })
  try {
    removeDirectory(finalDir)
    fs.renameSync(temp, finalDir)
    return
  } catch (err) {
    const code = err && err.code
    if (code !== 'EBUSY' && code !== 'EPERM' && code !== 'ENOTEMPTY') throw err
  }
  fs.mkdirSync(finalDir, { recursive: true })
  for (const entry of fs.readdirSync(finalDir)) {
    if (fs.existsSync(path.join(temp, entry))) continue
    try {
      fs.rmSync(path.join(finalDir, entry), { recursive: true, force: true, maxRetries: 2, retryDelay: 100 })
    } catch (_) {
      // A browser may still hold an old asset; keep it rather than failing the export.
    }
  }
  copyDirectory(temp, finalDir)
  try {
    removeDirectory(temp)
  } catch (_) {
    // temp cleanup is best-effort when the locked browser still holds handles
  }
  console.warn(
    `dist/${path.basename(finalDir)} was locked; exported by in-place overwrite. ` +
    'Reload the debug iframe (hard refresh) to pick up changes.'
  )
}

function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

function collectHashes(base, relative = '') {
  const result = {}
  const current = path.join(base, relative)
  if (!fs.existsSync(current)) return result
  for (const entry of fs.readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const rel = path.posix.join(relative.split(path.sep).join('/'), entry.name)
    if (entry.isDirectory()) Object.assign(result, collectHashes(base, rel))
    else result[rel] = sha256File(path.join(base, rel))
  }
  return result
}

function assertInside(base, target, label) {
  const rel = path.relative(path.resolve(base), path.resolve(target))
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`${label} escapes its allowed directory: ${target}`)
  }
}

function courseDirectory(courseId) {
  if (!validSlug(courseId)) {
    throw new Error('courseId must be a 2-48 character lowercase ASCII slug.')
  }
  const dir = findOutputCourseDir(courseId)
  if (!dir) throw new Error(`Course not found: ${courseId}`)
  return dir
}

function loadCourse(courseId) {
  const dir = courseDirectory(courseId)
  const file = path.join(dir, 'course.json')
  if (!fs.existsSync(file)) throw new Error(`Course not found: ${courseId}`)
  return { dir, file, config: readJson(file) }
}

function loadWorkspace() {
  const local = path.join(root, 'workspace.local.json')
  return fs.existsSync(local) ? readJson(local) : { authoringRoots: {} }
}

function createAjv() {
  return new Ajv2020({ allErrors: true, strict: false })
}

function validateAgainstSchema(data, schema, label) {
  const ajv = createAjv()
  const validate = ajv.compile(schema)
  if (!validate(data)) {
    const details = validate.errors.map((item) => `${item.instancePath || '/'} ${item.message}`).join('\n')
    throw new Error(`${label} is invalid:\n${details}`)
  }
}

function checkUnique(items, key, label) {
  const seen = new Map()
  for (const item of items) {
    const value = item[key]
    if (seen.has(value)) throw new Error(`Duplicate ${label}: ${value}`)
    seen.set(value, true)
  }
}

function checkCourse(course) {
  validateAgainstSchema(
    course.config,
    readJson(path.join(root, 'schemas', 'course.schema.json')),
    `_output_/${course.config.grade}/${course.config.courseId}/course.json`
  )
  if (course.config.courseId !== path.basename(course.dir)) {
    throw new Error('courseId must match its directory name.')
  }

  const engine = readJson(path.join(root, 'engine.version.json'))
  const required = course.config.engine.requiredCapabilities || []
  const missing = required.filter((item) => !engine.capabilities.includes(item))
  if (missing.length) throw new Error(`Missing engine capabilities: ${missing.join(', ')}`)

  const problems = (course.config.authoring && course.config.authoring.problems) || []
  checkUnique(problems, 'problemId', 'problemId')
  checkUnique(problems, 'actionPrefix', 'actionPrefix')
  checkUnique(problems, 'order', 'problem order')

  if (course.config.actionCatalogPath) {
    const catalogFile = path.resolve(course.dir, course.config.actionCatalogPath)
    assertInside(course.dir, catalogFile, 'actionCatalogPath')
    if (!fs.existsSync(catalogFile)) {
      throw new Error(`Action catalog not found: ${course.config.actionCatalogPath}`)
    }
    const catalog = readJson(catalogFile)
    if (!Array.isArray(catalog)) throw new Error('actionCatalogPath must point to a JSON array')
    checkUnique(catalog, 'name', 'authored action')
  }

  if (!problems.length && !(course.config.authoredModules || []).length) {
    throw new Error('Course must declare authoring.problems or authoredModules.')
  }

  for (const file of [...(course.config.authoredModules || []), ...(course.config.extensions || [])]) {
    if (path.isAbsolute(file)) throw new Error(`Absolute paths are forbidden: ${file}`)
    const resolved = path.resolve(course.dir, file)
    assertInside(course.dir, resolved, 'Course file')
    if (!fs.existsSync(resolved)) throw new Error(`Course file does not exist: ${file}`)
  }
  checkCourseware(course)
  return { engine, problems }
}

/** 校验 courseware.json：next 引用存在、主链连续（flow_1 末→flow_2 首→flow_3 首→flow_3 末 null）、next: null 仅主链末端 */
function checkCourseware(course) {
  const file = path.join(course.dir, 'courseware.json')
  if (!fs.existsSync(file)) return
  const cw = readJson(file)
  const nodes = Array.isArray(cw.nodes) ? cw.nodes : []
  const byId = new Map()
  for (const node of nodes) {
    if (!node || typeof node.id !== 'string' || !node.id) {
      throw new Error('courseware.json: 节点缺少 id')
    }
    if (byId.has(node.id)) throw new Error(`courseware.json: 节点 id 重复 ${node.id}`)
    byId.set(node.id, node)
  }

  const refs = []
  for (const node of nodes) {
    if (node.next != null) refs.push([node.id, node.next])
    for (const branch of node.test || []) {
      if (branch.next == null) {
        throw new Error(`courseware.json: ${node.id} 的 test 分支 next 不能为 null（不设 retry，true/false 都往下走）`)
      }
      refs.push([node.id, branch.next])
    }
  }
  for (const [from, target] of refs) {
    if (!byId.has(target)) throw new Error(`courseware.json: ${from} 引用了不存在的节点 ${target}`)
  }

  const flowIds = (cw.child_title || []).map((item) => item.flow_id)
  if (flowIds.length !== 3) throw new Error('courseware.json: child_title 必须含三条 flow（flow_1/flow_2/flow_3）')
  const flowNodes = flowIds.map((flowId) => nodes.filter((node) => node.flow_id === flowId))
  for (let i = 0; i < flowIds.length; i++) {
    if (!flowNodes[i].length) throw new Error(`courseware.json: flow ${flowIds[i]} 无节点`)
  }

  // 主链连续：flow_1 末 next → flow_2 首；flow_2 末 next → flow_3 首；flow_3 末 next = null
  for (let i = 0; i < flowIds.length - 1; i++) {
    const tail = flowNodes[i][flowNodes[i].length - 1]
    const nextHead = flowNodes[i + 1][0]
    if (tail.next !== nextHead.id) {
      throw new Error(
        `courseware.json 主链断裂: flow ${flowIds[i]} 末节点 ${tail.id} 的 next 应为 ${nextHead.id}（flow ${flowIds[i + 1]} 首），实际 ${tail.next}`
      )
    }
  }
  const finalTail = flowNodes[flowIds.length - 1]
  const finalNode = finalTail[finalTail.length - 1]
  if (finalNode.next !== null) {
    throw new Error(`courseware.json: 主链末节点 ${finalNode.id} 的 next 应为 null（仅主链最后节点为 null）`)
  }

  // 仅主链最后节点允许 next: null
  const lastFlowId = flowIds[flowIds.length - 1]
  for (const node of nodes) {
    if (node.next === null && node.flow_id !== lastFlowId) {
      throw new Error(
        `courseware.json: ${node.id} 的 next 为 null，但 null 仅允许在主链最后节点（flow ${lastFlowId} 末）——` +
        `flow_1/flow_2 末节点必须接下一 flow 首节点`
      )
    }
  }

  // 快问快答问/答节点的 text 是口播稿（汉字逐字稿，来源 plan 的 promptText/correctText/wrongText），不得含 LaTeX/数字
  const qaLatexRe = /[$\\]|[0-9]/
  for (const node of nodes) {
    const acts = (node.action || []).join(' ')
    if (acts.indexOf('快问快答') >= 0 && (acts.indexOf('显示问题') >= 0 || acts.indexOf('显示答案') >= 0)) {
      const text = node.text == null ? '' : String(node.text)
      if (text && qaLatexRe.test(text)) {
        throw new Error(
          `courseware.json: ${node.id} 快问快答口播稿含 LaTeX/数字（"${text}"）——问/答节点口播应为汉字逐字稿（取 plan 的 promptText/correctText/wrongText）`
        )
      }
    }
  }
}

function resolvePlan(course, problem) {
  if (problem.planPath) {
    const local = path.resolve(course.dir, problem.planPath)
    assertInside(course.dir, local, 'planPath')
    return local
  }
  if (course.config.authoring.rootKey !== 'output') {
    throw new Error('course.json authoring.rootKey must be "output".')
  }
  return path.join(outputLessonDir(course.config.grade, course.config.courseId, problem.problemId), 'plan.json')
}

function normalizePlan(raw) {
  return {
    ...raw,
    schemaVersion: raw.schemaVersion || 1,
    steps: raw.steps || [],
    quickQA: raw.quickQA || []
  }
}

const SCREEN_LATEX_CMD = /\\(?:frac|dfrac|sqrt|times|div|pm|cdot|pi)\b/
const SCREEN_UNICODE_MATH = /[²³×÷½⅓¼⅔¾]/

function screenTextNeedsLatex(text) {
  const s = String(text || '')
  if (!s) return false
  if (SCREEN_LATEX_CMD.test(s)) return true
  if (SCREEN_UNICODE_MATH.test(s)) return true
  return false
}

function assertScreenLatexDelimiters(text, label) {
  if (!screenTextNeedsLatex(text)) return
  if (!/\$[^$]+\$/.test(String(text))) {
    throw new Error(`${label} must wrap math in $...$`)
  }
}

function validateQuickQALatex(quickQA, planId) {
  for (const item of quickQA || []) {
    assertScreenLatexDelimiters(item.question, `quickQA question (${planId}/${item.id})`)
    assertScreenLatexDelimiters(item.answer, `quickQA answer (${planId}/${item.id})`)
  }
}

function isStemEquationBlock(block) {
  return /\bcalc-eq(?:--stem|-index)?\b/.test(String(block?.class || ''))
}

function validateStemEquationBlocks(plan) {
  for (const step of plan.steps || []) {
    for (const block of step.push || []) {
      if (block.region === 'top' && isStemEquationBlock(block) && block.type !== 'latex') {
        throw new Error(
          `Stem equation must use type "latex" (calc-eq): ${plan.id}/${step.id}`
        )
      }
      if (block.type === 'latex' && block.region === 'top' && isStemEquationBlock(block)) {
        if (!block.tex && !block.value) {
          throw new Error(`Stem latex block requires tex: ${plan.id}/${step.id}`)
        }
      }
    }
  }
}

function validatePlanSemantics(plan) {
  if (PROFILE === 'calculation') {
    if (plan.layout !== 'top-split') {
      throw new Error(`Only top-split layout is supported: ${plan.id}`)
    }
    if (plan.figureTemplate != null) {
      throw new Error(`figureTemplate is not supported in text courses: ${plan.id}`)
    }
    if (plan.steps.some((step) => step.figure != null)) {
      throw new Error(`step.figure is not supported in text courses: ${plan.id}`)
    }
    if (plan.guidanceChain != null || plan.guidanceLayout != null ||
        plan.steps.some((step) => step.group != null || step.guidanceSub != null)) {
      throw new Error(`guidanceChain/group is legacy text-only template, forbidden in top-split: ${plan.id}`)
    }
    if (plan.moduleType !== 'knowledge') {
      if (plan.problemBrief || plan.steps.some((step) => step.problemBrief)) {
        throw new Error(
          `plan 不上屏 problemBrief，请删除 plan/step.problemBrief: ${plan.id}`
        )
      }
    }
  } else if (PROFILE === 'text') {
    if (plan.layout && plan.layout !== 'text-only') {
      throw new Error(`Only text-only layout is supported: ${plan.id}`)
    }
    if (plan.figureTemplate != null) {
      throw new Error(`figureTemplate is not supported in text courses: ${plan.id}`)
    }
    if (plan.steps.some((step) => step.figure != null)) {
      throw new Error(`step.figure is not supported in text courses: ${plan.id}`)
    }
    const guidanceCount = (plan.guidanceChain || []).length
    const groups = plan.steps.map((step) => step.group || 0)
    const visibleGroups = new Set(groups.filter((group) => group > 0))
    const expectedGroups = Array.from({ length: guidanceCount }, (_, index) => index + 1)
    if (groups.some((group) => group < 0 || group > guidanceCount) ||
        expectedGroups.some((group) => !visibleGroups.has(group))) {
      throw new Error(
        `Plan groups must fully cover 1..guidanceChain.length: ${plan.id}`
      )
    }
    const invalidGroupZero = plan.steps.find((step) =>
      (step.group || 0) === 0 &&
      step.id !== 'start' &&
      !String(step.action || '').endsWith('_开始')
    )
    if (invalidGroupZero) {
      throw new Error(`Only the opening step may use group 0: ${plan.id}/${invalidGroupZero.id}`)
    }
    if (plan.moduleType !== 'knowledge') {
      if (plan.guidanceChain?.[0]?.title !== '审题环节') {
        throw new Error(`The first guidance stage must be 审题环节: ${plan.id}`)
      }
      const group1Blocks = plan.steps
        .filter((step) => (step.group || 0) === 1)
        .flatMap((step) => step.push || [])
      const hasKnownTag = group1Blocks.some((block) =>
        block.type === 'section' && String(block.tag || '').includes('已知'))
      const hasAskTag = group1Blocks.some((block) =>
        block.type === 'section' && String(block.tag || '').includes('求'))
      if (!hasKnownTag || !hasAskTag) {
        throw new Error(
          `text-only 审题须用 section 标签写出「已知」与「求」: ${plan.id}`
        )
      }
      if (plan.problemBrief || plan.steps.some((step) => step.problemBrief)) {
        throw new Error(
          `text-only 不上屏 problemBrief，请删除 plan/step.problemBrief: ${plan.id}`
        )
      }
    }
    if (plan.guidanceLayout && plan.guidanceLayout !== 'interleaved') {
      throw new Error(`guidanceLayout must be interleaved: ${plan.id}`)
    }
  } else {
    const guidanceCount = (plan.guidanceChain || []).length
    const groups = plan.steps.map((step) => step.group || 0)
    const visibleGroups = new Set(groups.filter((group) => group > 0))
    const expectedGroups = Array.from({ length: guidanceCount }, (_, index) => index + 1)
    if (groups.some((group) => group < 0 || group > guidanceCount) ||
        expectedGroups.some((group) => !visibleGroups.has(group))) {
      throw new Error(
        `Plan groups must fully cover 1..guidanceChain.length: ${plan.id}`
      )
    }
    const invalidGroupZero = plan.layout === 'top-split'
      ? null
      : plan.steps.find((step) =>
          (step.group || 0) === 0 &&
          step.id !== 'start' &&
          !String(step.action || '').endsWith('_开始')
        )
    if (invalidGroupZero) {
      throw new Error(`Only the opening step may use group 0: ${plan.id}/${invalidGroupZero.id}`)
    }

    if (plan.moduleType !== 'knowledge' && plan.layout !== 'top-split' && plan.layout !== 'text-only') {
      const brief = plan.problemBrief
      const known = brief && (Array.isArray(brief.known) ? brief.known : [brief.known])
      if (!brief || !known || !known.some((item) => String(item || '').trim()) ||
          !String(brief.ask || '').trim()) {
        throw new Error(`problemBrief.known and problemBrief.ask are required: ${plan.id}`)
      }
      if (Object.prototype.hasOwnProperty.call(brief, 'knowledge')) {
        throw new Error(`problemBrief must not display knowledge: ${plan.id}`)
      }
      if (plan.guidanceChain?.[0]?.title !== '审题环节') {
        throw new Error(`The first guidance stage must be 审题环节: ${plan.id}`)
      }
      const revealSteps = plan.steps.filter((step) => step.problemBrief)
      const finalReveal = revealSteps[revealSteps.length - 1]?.problemBrief
      const knownCount = known.filter((item) => String(item || '').trim()).length
      const knownSnapshots = revealSteps.map((step) => step.problemBrief.known || 0)
      const askIndex = revealSteps.findIndex((step) => step.problemBrief.ask === true)
      const keyIndex = revealSteps.findIndex((step) => step.problemBrief.key === true)
      if (!revealSteps.length ||
          revealSteps.some((step) => step.group !== 1) ||
          knownSnapshots.some((count, index) => index > 0 && count < knownSnapshots[index - 1]) ||
          (knownCount > 1 && new Set(knownSnapshots).size < 2) ||
          (finalReveal.known || 0) < knownCount ||
          finalReveal.ask !== true ||
          (brief.key && (finalReveal.key !== true || askIndex < 0 || keyIndex <= askIndex))) {
        throw new Error(`problemBrief must reveal progressively inside group 1: ${plan.id}`)
      }
    }
  }

  const stepIds = new Set(plan.steps.map((step) => step.id))

  const relationText = [
    plan.stem,
    plan.analysis,
    ...(plan.solution || [])
  ].filter(Boolean).join(' ')
  if (plan.lessonContext && plan.lessonContext.archetype === 'directFormula' &&
      /面积相等|等面积|等高|逆用|反求|上下底之和/.test(relationText)) {
    throw new Error(`Relation/inverse problem cannot use directFormula: ${plan.id}`)
  }

  const quickQA = plan.quickQA || []
  if (plan.moduleType === 'example') {
    const expected = expectedQuickQACount(plan.difficulty)
    if (quickQA.length !== expected) {
      throw new Error(
        `Example quickQA must contain ${expected} items for difficulty ${plan.difficulty || 1}: ${plan.id} (got ${quickQA.length})`
      )
    }
    if (plan.quickQALayout !== 'above-body') {
      throw new Error(`Example quickQA must use quickQALayout="above-body": ${plan.id}`)
    }
  } else if (quickQA.length) {
    throw new Error(`Only example plans may define quickQA: ${plan.id}`)
  }
  for (const item of quickQA) {
    if (!String(item.id || '').trim() || !String(item.question || '').trim() ||
        !String(item.answer || '').trim()) {
      throw new Error(`quickQA items require id, question, and answer: ${plan.id}`)
    }
    if (!String(item.promptText || '').trim()) {
      throw new Error(`quickQA items require promptText (TTS, Chinese): ${plan.id}/${item.id}`)
    }
    if (/你觉得|说说|谈谈|你的思路|怎么做|如何做|有什么方法/.test(item.question)) {
      throw new Error(`quickQA must use a concrete question with one answer: ${plan.id}/${item.id}`)
    }
    if (item.fillBlank && !item.question.includes('＿＿')) {
      throw new Error(`fillBlank quickQA must contain ＿＿: ${plan.id}/${item.id}`)
    }
  }
  validateQuickQALatex(quickQA, plan.id)
  validateStemEquationBlocks(plan)

  for (const step of plan.steps) {
    const agentType = step.agent?.type
    if (!agentType || !['explain', 'ask'].includes(agentType)) {
      throw new Error(`agent.type must be explain or ask: ${plan.id}/${step.id}`)
    }
    for (const block of step.push || []) {
      if (block.card === 'readStem') {
        throw new Error(
          PROFILE === 'figure'
            ? `readStem cards are replaced by problemBrief: ${plan.id}/${step.id}`
            : `readStem cards are forbidden; use section 已知/求: ${plan.id}/${step.id}`
        )
      }
      if (block.type === 'choice') {
        const options = block.options || []
        const values = options.map((option) => {
          return typeof option === 'object' ? option.value : option
        })
        const answers = Array.isArray(block.answer) ? block.answer : [block.answer]
        if (!options.length || answers.some((answer) => !values.includes(answer))) {
          throw new Error(`Choice answer is not present in options: ${plan.id}/${step.id}`)
        }
      }
      if (block.attachStepId && !stepIds.has(block.attachStepId)) {
        throw new Error(`Unknown attachStepId "${block.attachStepId}" in ${plan.id}/${step.id}`)
      }
      for (const field of ['src', 'url', 'image', 'video']) {
        if (typeof block[field] === 'string' && /^(?:https?:|file:|[A-Za-z]:[\\/]|\/)/i.test(block[field])) {
          throw new Error(`External or absolute block path is forbidden: ${block[field]}`)
        }
      }
    }
  }

  if (plan.layout === 'top-split') {
    validateTopSplitStructure(plan)
  }
}

function safeJsonForScript(value) {
  return JSON.stringify(value, null, 2)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
}

function generatedPush(push, planId) {
  return (push || []).map((block) => ({
    ...block,
    ...(block.attachStepId
      ? { attachStepId: `${planId}_${block.attachStepId}` }
      : {})
  }))
}

function remapRetainPush(retainPush, planId, steps) {
  if (retainPush == null) return retainPush
  // true = 保留全部步骤（卷面完整保留），展开为全部步骤 id
  if (retainPush === true) {
    return (steps || []).map((step) => `${planId}_${step.id}`)
  }
  const list = Array.isArray(retainPush) ? retainPush : [retainPush]
  return list.map((id) => {
    const value = String(id)
    if (value.startsWith(`${planId}_`)) return value
    return `${planId}_${value}`
  })
}

function generatedStepOptions(step, planId, steps) {
  const options = PROFILE === 'calculation' ? { scroll: {} } : {}
  const keys = PROFILE === 'calculation'
    ? ['scroll', 'stemClass']
    : PROFILE === 'figure'
      ? ['scroll', 'stemClass', 'guidanceSub', 'problemBrief']
      : ['scroll', 'stemClass', 'guidanceSub']
  for (const key of keys) {
    if (step[key] != null) options[key] = step[key]
  }
  if (step.retainPush != null) options.retainPush = remapRetainPush(step.retainPush, planId)
  return options
}

function courseLabel(moduleType) {
  const prefixes = {
    knowledge: '知识点',
    example: '例',
    practice: '练',
    homework: '作业'
  }
  return prefixes[moduleType] || '例'
}

const DEFAULT_TOP_SPLIT_LAYOUT = {
  edgePad: 28,
  gap: 24,
  splitLeftWidth: '58%',
  splitMinHeight: 420
}

function generatedModule(plan, problem, displayIndex) {
  const moduleId = `mod_${plan.id.replace(/-/g, '_')}`
  const containerId = `c_${plan.id.replace(/-/g, '_')}`
  const steps = plan.steps
  const start = steps[0]
  const sideEffects = steps.slice(1).map((step) => {
    const item = {
      id: `${plan.id}_${step.id}`,
      action: step.action,
      kind: plan.moduleType || 'example',
      containerIdx: 0,
      ...(PROFILE === 'calculation' ? {} : { group: step.group || 0 }),
      description: (step.agent && step.agent.description) || step.description || '',
      ...generatedStepOptions(step, plan.id, steps)
    }
    if (PROFILE === 'figure') {
      const figure = generatedFigure(step.figure)
      if (figure) item.figure = figure
    }
    if (step.push && step.push.length) item.push = generatedPush(step.push, plan.id)
    if (PROFILE === 'figure' && step.guidanceDesc) item.guidanceDesc = step.guidanceDesc
    return item
  })
  if (plan.moduleType === 'practice') {
    sideEffects.unshift({
      id: `${plan.id}_photo_answer`,
      action: `${problem.actionPrefix}_作答_拍照`,
      kind: 'practice',
      containerIdx: 0,
      anchorStepId: `${plan.id}_${start.id}`,
      photoAnswer: true,
      description: '显示拍照作答区域'
    })
  }
  const quickQA = (plan.quickQA || []).map((item, index) => {
    const suffix = index ? String(index + 1) : ''
    return {
      ...item,
      openAction: item.openAction || `${problem.actionPrefix}_快问快答_打开`,
      questionAction: item.questionAction || `${problem.actionPrefix}_快问快答${suffix}_显示问题`,
      answerAction: item.answerAction || `${problem.actionPrefix}_快问快答${suffix}_显示答案`
    }
  })
  const containerSteps = [
    {
      id: `${plan.id}_${start.id}`,
      kind: plan.moduleType || 'example',
      action: start.action,
      description: (start.agent && start.agent.description) || start.description || '',
      ...generatedStepOptions(start, plan.id, steps),
      ...(start.push && start.push.length ? { push: generatedPush(start.push, plan.id) } : {})
    }
  ]
  const container = PROFILE === 'calculation'
    ? {
        id: containerId,
        label: courseLabel(plan.moduleType || 'example', displayIndex),
        head: courseLabel(plan.moduleType || 'example', displayIndex),
        difficulty: plan.difficulty || 1,
        difficultyMax: plan.difficultyMax || 8,
        layout: 'top-split',
        ...(plan.quickQALayout ? { quickQALayout: plan.quickQALayout } : {}),
        guidanceLayout: 'stacked',
        layoutParams: { ...DEFAULT_TOP_SPLIT_LAYOUT, ...(plan.layoutParams || {}) },
        ...(plan.style ? { style: plan.style } : {}),
        textAccumulate: true,
        steps: containerSteps
      }
    : PROFILE === 'text'
      ? {
        id: containerId,
        label: courseLabel(plan.moduleType || 'example', displayIndex),
        head: courseLabel(plan.moduleType || 'example', displayIndex),
        difficulty: plan.difficulty || 1,
        difficultyMax: plan.difficultyMax || 8,
        layout: 'text-only',
        guidanceChain: plan.guidanceChain || [],
        guidanceLayout: 'interleaved',
        ...(plan.quickQALayout ? { quickQALayout: plan.quickQALayout } : {}),
        ...(plan.layoutParams ? { layoutParams: plan.layoutParams } : {}),
        ...(plan.style ? { style: plan.style } : {}),
        textAccumulate: true,
        steps: containerSteps
      }
    : {
        id: containerId,
        label: courseLabel(plan.moduleType || 'example', displayIndex),
        head: courseLabel(plan.moduleType || 'example', displayIndex),
        difficulty: plan.difficulty || 1,
        difficultyMax: plan.difficultyMax || 8,
        layout: plan.layout || 'left-right',
        figure: plan.figureTemplate || null,
        problemBrief: plan.problemBrief || null,
        guidanceChain: plan.guidanceChain || [],
        guidanceLayout: plan.guidanceLayout ||
          ((plan.layout || 'left-right') === 'left-right' && (plan.guidanceChain || []).length
            ? 'interleaved'
            : 'stacked'),
        ...(plan.quickQALayout ? { quickQALayout: plan.quickQALayout } : {}),
        ...(plan.layout === 'top-split'
          ? { layoutParams: { ...DEFAULT_TOP_SPLIT_LAYOUT, ...(plan.layoutParams || {}) } }
          : plan.layout === 'text-only'
            ? { layoutParams: { edgePad: 32, textMaxWidth: 'none', gap: 28, ...(plan.layoutParams || {}) } }
            : plan.layoutParams
              ? { layoutParams: plan.layoutParams }
              : {}),
        ...(plan.style ? { style: plan.style } : {}),
        textAccumulate: true,
        steps: [
          {
            id: `${plan.id}_${start.id}`,
            kind: plan.moduleType || 'example',
            action: start.action,
            description: (start.agent && start.agent.description) || start.description || '',
            ...generatedStepOptions(start, plan.id, steps),
            ...(generatedFigure(start.figure) ? { figure: generatedFigure(start.figure) } : {}),
            ...(start.push && start.push.length ? { push: generatedPush(start.push, plan.id) } : {})
          }
        ]
      }
  const module = {
    id: moduleId,
    title: plan.title,
    sideEffects,
    quickQA,
    containers: [container]
  }
  return {
    module,
    source: `// @generated from standard plan ${plan.id}; do not edit.\n;(function () {\n  window.__lessonRegisterModule(${safeJsonForScript(module)})\n})()\n`
  }
}

function actionCatalog(plan, module) {
  const entries = PROFILE === 'text'
    ? (module.containers || []).flatMap((container) =>
        (container.steps || []).map((step) => ({
          name: step.action,
          params: [],
          description: step.description || ''
        }))
      )
    : plan.steps.map((step) => ({
        name: step.action,
        params: [],
        description: (step.agent && step.agent.description) || step.description || ''
      }))
  for (const effect of module.sideEffects || []) {
    if (PROFILE === 'calculation') {
      if (effect.photoAnswer && !entries.some((item) => item.name === effect.action)) {
        const startIndex = entries.findIndex((item) => item.name === plan.steps[0].action)
        entries.splice(startIndex + 1, 0, {
          name: effect.action,
          params: [],
          description: effect.description || '显示拍照作答区域'
        })
      }
    } else if (!entries.some((item) => item.name === effect.action)) {
      const item = { name: effect.action, params: [], description: effect.description || '' }
      if (PROFILE === 'figure' && effect.photoAnswer === true) entries.splice(1, 0, item)
      else entries.push(item)
    }
  }
  for (const qa of module.quickQA || []) {
    for (const [name, description] of [
      [qa.openAction, '打开快问快答'],
      // 问节点口播用 promptText；屏幕 question 不得进 catalog
      [qa.questionAction, String(qa.promptText || '').trim()],
      // 答对/答错口播在 courseware 节点；此处仅占位，禁止用 LaTeX answer
      [qa.answerAction, '显示答案']
    ]) {
      if (!entries.some((item) => item.name === name)) entries.push({ name, params: [], description })
    }
  }
  return entries
}

function loadAuthoredCatalog(course) {
  const rel = course.config.actionCatalogPath
  if (!rel) return []
  const file = path.resolve(course.dir, rel)
  assertInside(course.dir, file, 'actionCatalogPath')
  return readJson(file)
}

function mergeCatalogs(primary, secondary) {
  const merged = [...primary]
  const seen = new Set(primary.map((item) => item.name))
  for (const item of secondary) {
    if (seen.has(item.name)) throw new Error(`Duplicate action in catalog: ${item.name}`)
    seen.add(item.name)
    merged.push(item)
  }
  return merged
}

function buildLessonMeta(course) {
  const base = {
    id: course.config.courseId,
    title: course.config.title,
    defaults: {
      layoutParams: PROFILE === 'calculation'
        ? { edgePad: 32, textMaxWidth: 'none', gap: 28, splitLeftWidth: '58%', splitMinHeight: 420 }
        : PROFILE === 'figure'
          ? { edgePad: 32, textMaxWidth: 560, figureWidth: 480, gap: 28 }
          : { edgePad: 32, textMaxWidth: 'none', gap: 28 },
      style: { bodySize: 28, lineHeight: 1.58 }
    },
    theme: course.config.theme || {}
  }
  const extra = course.config.lessonMeta || {}
  return {
    ...base,
    ...extra,
    defaults: { ...base.defaults, ...(extra.defaults || {}) },
    theme: { ...base.theme, ...(extra.theme || {}) }
  }
}

function relativeToRepo(file) {
  const relative = path.relative(platformRoot, file)
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Debug editing only supports plans inside the monorepo: ${file}`)
  }
  return relative.split(path.sep).join('/')
}

function buildDebugEditMap(course, snapshots) {
  const courseId = course.config.courseId
  const grade = course.config.grade
  const base = `_output_/${grade}/${courseId}/.generated`
  const dist = `dist/${grade}/${courseId}/courseware/runtime`
  const actions = []
  for (const snapshot of Object.values(snapshots)) {
    for (const step of snapshot.plan.steps) {
      actions.push({
        action: step.action,
        stepId: step.id,
        planFile: relativeToRepo(snapshot.planFile),
        portablePlan: `content/${snapshot.plan.id}/plan.json`,
        portableOutput: `content/${snapshot.plan.id}/output.json`,
        generatedModule: `${base}/lesson/modules/${snapshot.moduleFile}`,
        distModule: `${dist}/lesson/modules/${snapshot.moduleFile}`,
        portableModule: `runtime/lesson/modules/${snapshot.moduleFile}`,
        editable: true
      })
    }
  }
  return {
    version: 1,
    courseId,
    grade,
    generatedCatalog: `${base}/action-catalog.json`,
    distCatalog: `${dist}/action-catalog.json`,
    distIndex: `dist/${grade}/${courseId}/index.html`,
    actions
  }
}

function buildProblemOutput(snapshot, catalog) {
  return {
    schemaVersion: 1,
    problemId: snapshot.plan.id,
    title: snapshot.plan.title,
    sourceOfTruth: 'plan.json',
    modulePath: `runtime/lesson/modules/${snapshot.moduleFile}`,
    steps: snapshot.plan.steps.map((step) => ({
      stepId: step.id,
      action: step.action,
      description: (step.agent && step.agent.description) || step.description || ''
    })),
    catalog: catalog.filter((item) => snapshot.plan.steps.some((step) => step.action === item.name))
  }
}

function embedDebugEditMap(shellFile, editMap) {
  let shell = fs.readFileSync(shellFile, 'utf8')
  shell = shell.replace(
    /var editMap = window\.AICLASS_DEBUG_EDIT_MAP \|\| null/,
    `var editMap = ${safeJsonForScript(editMap)}`
  )
  writeText(shellFile, shell)
}

function buildInlineDebugHtml(editMap) {
  const shellDir = path.join(root, 'templates', 'lesson-runtime', 'debug', 'parent-shell')
  let html = fs.readFileSync(path.join(shellDir, 'index.html'), 'utf8')
  const css = fs.readFileSync(path.join(shellDir, 'parent-shell.css'), 'utf8')
  let js = fs.readFileSync(path.join(shellDir, 'parent-shell.js'), 'utf8')
  js = js.replace(
    /var iframeSrc = params\.get\('src'\) \|\| '[^']*'/,
    `var iframeSrc = params.get('src') || '../index.html'`
  )
  js = js.replace(
    /var editMap = window\.AICLASS_DEBUG_EDIT_MAP \|\| null/,
    `var editMap = ${safeJsonForScript(editMap)}`
  )
  return html
    .replace('<link rel="stylesheet" href="parent-shell.css">', `<style>\n${css}\n</style>`)
    .replace('<script src="parent-shell.js"></script>', `<script>\n${js}\n</script>`)
}

function ensureCourseDebugShell(courseDir, course, editMap) {
  const courseId = course.config.courseId
  const grade = course.config.grade
  const source = path.join(root, 'templates', 'lesson-runtime', 'debug', 'parent-shell')
  const target = path.join(courseDir, 'debug')
  copyDirectory(source, target)

  const shellJs = path.join(target, 'parent-shell.js')
  const iframeSrc = `../../../../dist/${grade}/${courseId}/index.html`
  let shell = fs.readFileSync(shellJs, 'utf8')
  shell = shell.replace(
    /var iframeSrc = params\.get\('src'\) \|\| '[^']*'/,
    `var iframeSrc = params.get('src') || '${iframeSrc}'`
  )
  writeText(shellJs, shell)
  writeJson(path.join(target, 'edit-map.json'), editMap)
  embedDebugEditMap(shellJs, editMap)
  writeText(
    path.join(target, 'README.md'),
    `# ${courseId} 调试页\n\n` +
      `该页由 \`lesson:generate\` 自动同步，动作列表通过 \`help\` 动态读取。\n\n` +
      `在 Chrome 或 Edge 中打开 [index.html](./index.html)，点击“连接课程文件夹”。选择平台根目录会同步写回 plan.json；选择发布课件包（含 courseware/course.json 的 dist/${grade}/${courseId}/courseware）则只修改该课件包。保存后刷新 iframe 即生效。\n\n` +
      `首次使用前先运行 \`cd engine && npm run course:export -- ${courseId}\`。\n`
  )
}

function generateCourse(courseId) {
  const course = loadCourse(courseId)
  const { problems } = checkCourse(course)
  const generated = path.join(course.dir, generatedName)
  removeDirectory(generated)
  const moduleDir = path.join(generated, 'lesson', 'modules')
  let catalog = []
  const modules = []
  const snapshots = {}
  const typeCounters = { knowledge: 0, example: 0, practice: 0, homework: 0 }

  for (const problem of [...problems].sort((a, b) => a.order - b.order)) {
    const planFile = resolvePlan(course, problem)
    if (!fs.existsSync(planFile)) throw new Error(`Plan not found: ${planFile}`)
    const plan = normalizePlan(readJson(planFile))
    validateAgainstSchema(
      plan,
      buildStandardPlanSchema(PROFILE),
      `plan ${problem.problemId}`
    )
    if (plan.id !== problem.problemId) {
      throw new Error(`Plan id ${plan.id} does not match problemId ${problem.problemId}`)
    }
    checkUnique(plan.steps, 'id', `${plan.id} step id`)
    checkUnique(plan.steps, 'action', `${plan.id} action`)
    validatePlanSemantics(plan)
    const moduleType = plan.moduleType || 'example'
    typeCounters[moduleType] = (typeCounters[moduleType] || 0) + 1
    const output = generatedModule(plan, problem, typeCounters[moduleType])
    const moduleName = `${String(problem.order).padStart(2, '0')}-${plan.id}.js`
    writeText(path.join(moduleDir, moduleName), output.source)
    modules.push(`lesson/modules/${moduleName}`)
    catalog.push(...actionCatalog(plan, output.module))
    snapshots[plan.id] = { planFile, plan, module: output.module, moduleFile: moduleName }

    // 有图题：从 figure-spec 生成 figure 注册模块（持久源目录，供 manifest 收集）
    if (PROFILE === 'figure' && plan.figureTemplate) {
      const specFile = path.join(path.dirname(planFile), 'figure-spec.json')
      if (fs.existsSync(specFile)) {
        const figure = generateFigureModule(readJson(specFile))
        if (figure) {
          const figureDir = path.join(course.dir, 'lesson', 'modules')
          fs.mkdirSync(figureDir, { recursive: true })
          writeText(path.join(figureDir, figure.name), figure.source)
        }
      }
    }
  }

  catalog = mergeCatalogs(catalog, loadAuthoredCatalog(course))
  if (!catalog.length) throw new Error('Course action catalog is empty.')
  checkUnique(catalog, 'name', 'course action')
  for (const snapshot of Object.values(snapshots)) {
    writeJson(path.join(path.dirname(snapshot.planFile), 'output.json'), buildProblemOutput(snapshot, catalog))
  }
  writeJson(path.join(generated, 'action-catalog.json'), catalog)
  writeJson(path.join(generated, 'debug-tree.json'), {
    courseId,
    modules: Object.values(snapshots).length
      ? Object.values(snapshots).map(({ plan, module }) => ({
          moduleId: module.id,
          title: plan.title,
          actions: plan.steps.map((step) => step.action)
        }))
      : (course.config.authoredModules || []).map((modulePath) => ({
          moduleId: path.basename(modulePath, '.js'),
          title: path.basename(modulePath),
          actions: catalog
            .map((item) => item.name)
            .filter((name) => name.startsWith(path.basename(modulePath, '.js').replace(/^\d+-/, '')))
        }))
  })
  const manifestModules = PROFILE === 'figure'
    ? [...collectFigureModulePaths(course.dir), ...(course.config.authoredModules || []), ...modules].filter(
        (item, index, all) => all.indexOf(item) === index
      )
    : [...(course.config.authoredModules || []), ...modules]
  writeText(
    path.join(generated, 'lesson', 'manifest.js'),
    `// @generated; do not edit.\nwindow.LESSON_MANIFEST = ${safeJsonForScript({
      scripts: course.config.extensions || [],
      modules: manifestModules
    })}\n`
  )
  writeText(
    path.join(generated, 'lesson', 'course.meta.js'),
    `// @generated; do not edit.\nwindow.LESSON_META = ${safeJsonForScript(buildLessonMeta(course))}\n`
  )
  const editMap = buildDebugEditMap(course, snapshots)
  ensureCourseDebugShell(course.dir, course, editMap)
  return { course, generated, snapshots, catalog, editMap }
}

function copyCourseSourceFiles(course, target) {
  const lessonSource = path.join(course.dir, 'lesson')
  copyDirectory(lessonSource, path.join(target, 'lesson'), { exclude: [generatedName] })
  const assetsSource = path.join(course.dir, 'assets')
  copyDirectory(assetsSource, path.join(target, 'assets'))
}

function renderIndex(course, catalog, assetPrefix = '') {
  const template = fs.readFileSync(
    path.join(root, 'templates', 'lesson-runtime', 'index.template.html'),
    'utf8'
  )
  const baseRuntime = loadWorkspace().runtime || (PROFILE === 'calculation'
    ? { katexBase: 'vendor/katex/' }
    : { katexBase: 'vendor/katex/', jsxgraphBase: 'vendor/jsxgraph/' })
  const runtime = Object.fromEntries(
    Object.entries(baseRuntime).map(([key, value]) => [key, typeof value === 'string' ? assetPrefix + value : value])
  )
  return template
    .replaceAll('__COURSE_TITLE__', escapeHtml(course.config.title))
    .replace('__ACTION_CATALOG_JSON__', safeJsonForScript(catalog))
    .replace('__RUNTIME_CONFIG_JSON__', safeJsonForScript(runtime))
    .replaceAll('href="src/', `href="${assetPrefix}src/`)
    .replaceAll('href="lesson/', `href="${assetPrefix}lesson/`)
    .replace("srcRoot: 'src', lessonRoot: 'lesson'", `srcRoot: '${assetPrefix}src', lessonRoot: '${assetPrefix}lesson'`)
    .replaceAll('src="src/', `src="${assetPrefix}src/`)
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function gitCommit() {
  return null
}

function exportCourse(courseId, options = {}) {
  const result = generateCourse(courseId)
  const { course, generated, snapshots, catalog, editMap } = result
  const grade = course.config.grade
  const temp = path.join(distRoot, `.tmp-${courseId}`)
  const finalDir = path.join(distRoot, String(grade), courseId)
  const packageDir = path.join(temp, 'courseware')
  removeDirectory(temp)
  fs.mkdirSync(temp, { recursive: true })

  copyDirectory(path.join(root, 'src'), path.join(packageDir, 'runtime', 'src'))
  copyDirectory(path.join(root, 'vendor'), path.join(packageDir, 'runtime', 'vendor'))
  // 共享核心装配：从 ../shared 合并 engine/src 与 engine/vendor（共享文件不在本仓库，编译时注入）
  const sharedEngine = path.join(repoRoot, '..', 'shared', 'engine')
  if (fs.existsSync(path.join(sharedEngine, 'src'))) {
    copyDirectory(path.join(sharedEngine, 'src'), path.join(packageDir, 'runtime', 'src'))
  }
  if (fs.existsSync(path.join(sharedEngine, 'vendor'))) {
    copyDirectory(path.join(sharedEngine, 'vendor'), path.join(packageDir, 'runtime', 'vendor'))
  }
  copyDirectory(
    path.join(root, 'templates', 'lesson-runtime', 'lesson'),
    path.join(packageDir, 'runtime', 'lesson')
  )
  writeText(path.join(packageDir, 'debug.html'), buildInlineDebugHtml(editMap))
  copyCourseSourceFiles(course, path.join(packageDir, 'runtime'))
  copyDirectory(path.join(generated, 'lesson'), path.join(packageDir, 'runtime', 'lesson'))
  const customStyle = path.join(course.dir, 'lesson', 'styles', 'lesson.css')
  if (fs.existsSync(customStyle)) {
    copyFile(customStyle, path.join(packageDir, 'runtime', 'lesson', 'styles', 'lesson.css'))
  } else {
    copyFile(
      path.join(root, 'templates', 'course', 'lesson', 'styles', 'lesson.css'),
      path.join(packageDir, 'runtime', 'lesson', 'styles', 'lesson.css')
    )
  }

  writeText(path.join(temp, 'index.html'), renderIndex(course, catalog, 'courseware/runtime/'))
  const coursewareSource = path.join(course.dir, 'courseware.json')
  if (fs.existsSync(coursewareSource)) {
    copyFile(coursewareSource, path.join(temp, 'courseware.json'))
  }
  writeJson(path.join(packageDir, 'runtime', 'action-catalog.json'), catalog)
  writeJson(path.join(packageDir, 'course.json'), course.config)
  writeJson(path.join(packageDir, 'engine.version.json'), readJson(path.join(root, 'engine.version.json')))

  writeText(
    path.join(packageDir, 'README.md'),
    '# 可编辑课件包\n\n' +
    '- 仅编辑 `content/<题目>/plan.json`；同目录 `output.json` 是自动生成索引。\n' +
    '- `runtime/` 是运行产物，请勿直接修改。\n'
  )

  const inputHashes = { 'courseware/course.json': sha256File(course.file) }
  for (const [problemId, snapshot] of Object.entries(snapshots)) {
    const targetDir = path.join(packageDir, 'content', problemId)
    const target = path.join(targetDir, 'plan.json')
    writeJson(target, snapshot.plan)
    const output = buildProblemOutput(snapshot, catalog)
    writeJson(path.join(targetDir, 'output.json'), output)
    inputHashes[`plan:${problemId}`] = sha256File(target)
  }

  writeText(
    path.join(packageDir, 'scripts', 'smoke-test.mjs'),
    `import fs from 'node:fs'\n` +
    `for (const file of ['course.json','engine.version.json','runtime/lesson/manifest.js']) {\n` +
    `  if (!fs.existsSync(new URL('../' + file, import.meta.url))) throw new Error('Missing ' + file)\n` +
    `}\nconsole.log('Course package smoke test passed.')\n`
  )

  const outputHashes = collectHashes(temp)
  writeJson(path.join(packageDir, 'course.lock.json'), {
    schemaVersion: 1,
    courseId,
    courseVersion: course.config.version,
    engineVersion: readJson(path.join(root, 'engine.version.json')).version,
    engineCommit: gitCommit(),
    courseCommit: gitCommit(),
    inputs: inputHashes,
    outputs: outputHashes,
    toolVersions: { schema: '1', generator: '1' }
  })

  const exportedTextFiles = Object.keys(collectHashes(temp)).filter((rel) => /\.(?:js|json|html|css|md)$/.test(rel))
  for (const rel of exportedTextFiles) {
    const text = fs.readFileSync(path.join(temp, rel), 'utf8')
    const isLeakageGateSource = rel === 'framework-source/tools/aiclass.mjs'
    if ((!isLeakageGateSource && referenceSentinels.some((sentinel) => text.includes(sentinel))) ||
        /(?:^|[\\/])references[\\/]/m.test(text)) {
      throw new Error(`Reference content leaked into export: ${rel}`)
    }
  }

  if (options.checkOnly) {
    removeDirectory(temp)
    return { ...result, finalDir }
  }

  publishExportDirectory(temp, finalDir)
  return { ...result, finalDir }
}

function newCourse(courseId, title, grade) {
  const target = outputCourseDir(grade, courseId)
  if (fs.existsSync(target)) throw new Error(`Course already exists: ${courseId}`)
  copyDirectory(path.join(root, 'templates', 'course'), target)
  const source = path.join(target, 'course.template.json')
  const config = fs.readFileSync(source, 'utf8')
    .replaceAll('__COURSE_ID__', courseId)
    .replaceAll('__COURSE_GRADE__', String(grade))
    .replaceAll('__COURSE_TITLE__', title || courseId)
  writeText(path.join(target, 'course.json'), config)
  fs.unlinkSync(source)
  ensureCourseDebugShell(target, { config: { courseId, grade } }, {
    version: 1,
    courseId,
    grade,
    generatedCatalog: `_output_/${grade}/${courseId}/.generated/action-catalog.json`,
    distCatalog: `dist/${grade}/${courseId}/courseware/runtime/action-catalog.json`,
    distIndex: `dist/${grade}/${courseId}/index.html`,
    actions: []
  })
  console.log(`Created _output_/${grade}/${courseId}`)
}

function previewCourse(courseId) {
  const { finalDir } = exportCourse(courseId)
  const port = 3456
  console.log(`Preview: http://127.0.0.1:${port}/`)
  const child = spawn('python', ['-m', 'http.server', String(port)], {
    cwd: finalDir,
    stdio: 'inherit'
  })
  child.on('exit', (code) => process.exit(code || 0))
}

function parseCourseNewArgs(args) {
  const rest = args.filter((arg) => arg !== '--')
  const gradeIndex = rest.indexOf('--grade')
  const grade = gradeIndex >= 0 ? rest[gradeIndex + 1] : undefined
  if (gradeIndex >= 0) rest.splice(gradeIndex, 2)
  let idOrPath
  if (rest[0] === '--from-md') {
    rest.shift()
    idOrPath = rest.shift()
    if (!idOrPath) throw new Error('course:new --from-md requires a .md path')
  } else {
    idOrPath = rest.shift()
  }
  const title = rest.join(' ').trim() || undefined
  if (!idOrPath || !/^[1-9]\d*$/.test(String(grade))) {
    throw new Error(
      'Usage: course:new <courseId|path.md> --grade <n> ["title"] | course:new --from-md <path.md> --grade <n> ["title"]'
    )
  }
  return { courseId: courseIdFromInput(idOrPath), title, grade: Number(grade) }
}

function parseOptions(args) {
  return {
    checkOnly: args.includes('--check')
  }
}

async function main() {
  const [command, first, second, ...rest] = process.argv.slice(2)
  switch (command) {
    case 'course:new': {
      const { courseId, title, grade } = parseCourseNewArgs([first, second, ...rest].filter(Boolean))
      newCourse(courseId, title, grade)
      break
    }
    case 'course:check': {
      const course = loadCourse(first)
      checkCourse(course)
      if ((course.config.authoring && course.config.authoring.problems || []).length) generateCourse(first)
      console.log(`Course ${first} is valid.`)
      break
    }
    case 'lesson:generate':
      generateCourse(first)
      console.log(`Generated course ${first}.`)
      break
    case 'course:export': {
      const result = exportCourse(first, parseOptions([second, ...rest].filter(Boolean)))
      console.log(`Exported course ${first} to ${result.finalDir}`)
      break
    }
    case 'course:preview':
      previewCourse(first)
      break
    default:
      throw new Error(`Unknown command: ${command || '(missing)'}`)
  }
}

  return { main, courseIdFromInput, validSlug, generateFigureModule }
}

