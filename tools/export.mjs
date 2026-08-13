#!/usr/bin/env node
// 编译导出：master plan.json → dist/{grade}/{lesson}/{grade}-{lesson}-{star}star/
//  - 双投影 courseware.json（父容器驱动图：去渲染字段 + problem_source）
//  - 装配 runtime/（lesson 生成脚本 + engine src + vendor）
//  - master plan.json 整体保留
// 用法：node tools/export.mjs [courseId]（默认扫描 _output_ 全部）
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execSync } from 'node:child_process'
import { distRoot, outputRoot, resolveDistParts } from './output-paths.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const engineSrc = path.join(root, 'engine', 'src')
const vendorSrc = path.join(root, 'vendor')

const FLOWS = [
  { flow_id: 'flow_1', title: '学习例题的解题思路' },
  { flow_id: 'flow_2', title: '快速复习例题的解题思路' },
  { flow_id: 'flow_3', title: '自己来做做练习题' }
]

// ---- courseware.json 投影（去渲染字段）----
function projectNode(state) {
  const node = {
    id: state.id,
    flow_id: state.flow_id || 'flow_1',
    type: state.type || 'text',
    text: state.text || '',
    action: state.action && state.action.length ? state.action.slice() : [],
    next: state.next != null ? state.next : null,
    test: state.test && state.test.length ? state.test.slice() : []
  }
  if (node.type === 'question' || state.answer_type) {
    if (state.question_type) node.question_type = state.question_type
    if (state.answer_type) node.answer_type = state.answer_type
    if (state.answer) node.answer = state.answer.slice()
  }
  return node
}

function buildCourseware(plan) {
  return {
    id: plan.courseId || plan.id || '',
    title: plan.title || '',
    child_title: FLOWS.map((f) => ({ title: f.title, flow_id: f.flow_id })),
    problem_source: plan.problem_source || [],
    nodes: (plan.timeline || []).map(projectNode),
    globals: []
  }
}

// ---- 生成运行时 lesson 脚本（file:// 兼容：plan 用 JS 包裹）----
function jsWrap(globalName, obj) {
  const json = JSON.stringify(obj)
    .replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')
  return 'window.' + globalName + ' = ' + json + ';\n'
}

function writeLessonFiles(lessonDir, plan, courseware, figureSpec) {
  fs.mkdirSync(path.join(lessonDir, 'modules'), { recursive: true })
  fs.mkdirSync(path.join(lessonDir, 'styles'), { recursive: true })
  fs.writeFileSync(path.join(lessonDir, 'course.meta.js'), jsWrap('LESSON_META', {
    id: plan.courseId || plan.id || '',
    title: plan.title || '',
    defaults: plan.defaults || {},
    theme: {}
  }))
  const scripts = ['lesson/plan.js']
  if (figureSpec) {
    // figure-spec → JS 包裹（file:// 可读），spec-loader 随后 loadAll 注册
    const figureJs = 'window.FIGURE_SPECS = [' + JSON.stringify(figureSpec) + '];\n' +
      'if (window.AIClassFigureSpecLoader) window.AIClassFigureSpecLoader.loadAll();\n'
    fs.writeFileSync(path.join(lessonDir, 'modules', 'figure.js'), figureJs)
    scripts.push('lesson/modules/figure.js')
  }
  fs.writeFileSync(path.join(lessonDir, 'manifest.js'), jsWrap('LESSON_MANIFEST', {
    scripts: scripts,
    modules: []
  }))
  fs.writeFileSync(path.join(lessonDir, 'plan.js'), jsWrap('MASTER_PLAN', plan))
  const handlersSrc = path.join(root, 'engine', 'templates', 'lesson-runtime', 'lesson', 'handlers.js')
  if (fs.existsSync(handlersSrc)) {
    fs.copyFileSync(handlersSrc, path.join(lessonDir, 'handlers.js'))
  } else {
    fs.writeFileSync(path.join(lessonDir, 'handlers.js'),
      'window.LESSON_HANDLERS = window.LESSON_HANDLERS || {};\n')
  }
  fs.writeFileSync(path.join(lessonDir, 'bootstrap.js'), 'window.LESSON_BOOT = true;\n')
  fs.writeFileSync(path.join(lessonDir, 'styles', 'lesson.css'), '')
}

// ---- 拷贝 engine src + profile 差异 ----
function copyTree(from, to) {
  if (!fs.existsSync(from)) return
  fs.cpSync(from, to, { recursive: true })
}

// ---- 按 profile 生成 engine-manifest（base + figure 附加层）----
function extractArray(file, globalName) {
  const text = fs.readFileSync(file, 'utf8')
  const re = new RegExp(globalName + '\\s*=\\s*(\\[[\\s\\S]*?\\])\\s*\\n?\\s*\\}\\)')
  const m = text.match(re)
  if (!m) throw new Error('无法解析 manifest: ' + file)
  return new Function('return ' + m[1])()
}

function extractFigureAdditions(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8')).additions
}

function mergeManifest(base, additions) {
  const list = base.slice()
  ;(additions || []).forEach(({ after, items }) => {
    const idx = list.indexOf(after)
    if (idx < 0) throw new Error('manifest 锚点未找到: ' + after)
    list.splice(idx + 1, 0, ...(items || []))
  })
  return list
}

function writeEngineManifest(runtimeSrcDir, profile) {
  const base = extractArray(path.join(engineSrc, 'boot', 'engine-manifest.js'), 'AICLASS_ENGINE_MANIFEST')
  let list = base
  if (profile === 'AIClass_figure') {
    const additions = extractFigureAdditions(path.join(root, 'profiles', 'AIClass_figure', 'engine-manifest.figure.json'))
    list = mergeManifest(base, additions)
  }
  const js = ';// 按 profile 生成的引擎清单\n;(function () {\n  window.AICLASS_ENGINE_MANIFEST = ' + JSON.stringify(list) + '\n})()\n'
  fs.writeFileSync(path.join(runtimeSrcDir, 'boot', 'engine-manifest.js'), js)
}

// 按 profile 生成 engine.css：基础层自包含，figure 附加 @import（problem-brief/calc-explain）
function writeEngineCss(runtimeSrcDir, profile) {
  const baseCssPath = path.join(engineSrc, 'styles', 'engine.css')
  const lines = fs.readFileSync(baseCssPath, 'utf8').split('\n')
  if (profile === 'AIClass_figure') {
    const additions = extractFigureAdditions(path.join(root, 'profiles', 'AIClass_figure', 'engine-css.figure.json'))
    ;(additions || []).forEach(({ after, items }) => {
      const idx = lines.findIndex((l) => l.trim() === after)
      if (idx < 0) throw new Error('engine.css 锚点未找到: ' + after)
      lines.splice(idx + 1, 0, ...(items || []))
    })
  }
  fs.writeFileSync(path.join(runtimeSrcDir, 'styles', 'engine.css'), lines.join('\n'))
}

function assembleRuntime(runtimeDir, profile) {
  const srcDir = path.join(runtimeDir, 'src')
  copyTree(engineSrc, srcDir)
  // profile 差异层覆盖/追加：src/ → runtime/src，lesson/ → runtime/lesson
  copyTree(path.join(root, 'profiles', profile, 'src'), srcDir)
  copyTree(path.join(root, 'profiles', profile, 'lesson'), path.join(runtimeDir, 'lesson'))
  copyTree(vendorSrc, path.join(runtimeDir, 'vendor'))
}

// ---- 生成 index.html（课件入口，参照旧引擎产物）----
function generateIndexHtml(plan, courseId) {
  const title = plan.title || courseId
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <link rel="stylesheet" href="courseware/runtime/src/styles/engine.css">
  <link rel="stylesheet" href="courseware/runtime/lesson/styles/lesson.css">
</head>
<body>
  <script>
    window.AICLASS_RUNTIME_CONFIG = {
  "katexBase": "courseware/runtime/vendor/katex/",
  "jsxgraphBase": "courseware/runtime/vendor/jsxgraph/"
}
    window.__COURSE_BOOT = { srcRoot: 'courseware/runtime/src', lessonRoot: 'courseware/runtime/lesson', planPath: 'courseware/plan.json' }
  </script>
  <script src="courseware/runtime/src/boot/engine-manifest.js"></script>
  <script src="courseware/runtime/src/boot/loader.js"></script>
</body>
</html>
`
}

// ---- 单课导出 ----
function exportCourse(courseDir) {
  const planPath = path.join(courseDir, 'plan.json')
  if (!fs.existsSync(planPath)) throw new Error('缺少 ' + planPath)
  const plan = JSON.parse(fs.readFileSync(planPath, 'utf8'))
  const parts = resolveDistParts(plan, courseDir)
  const grade = parts.grade
  const lesson = parts.lesson
  const leafId = parts.leafId
  const sourceCourseId = plan.courseId || plan.id || path.basename(courseDir)
  const courseId = leafId
  const profile = plan.profile || 'AIClass_text'
  plan.courseId = courseId
  plan.lesson = lesson

  const courseware = buildCourseware(plan)
  courseware.id = courseId
  const out = parts.out
  fs.rmSync(out, { recursive: true, force: true })
  fs.mkdirSync(out, { recursive: true })

  // 清理旧布局 dist/{grade}/{旧courseId}/
  const legacy = path.join(distRoot, grade, sourceCourseId)
  if (legacy !== out && fs.existsSync(legacy)) {
    fs.rmSync(legacy, { recursive: true, force: true })
  }

  // 顶层（严格 3 项）：index.html + courseware.json
  fs.writeFileSync(path.join(out, 'index.html'), generateIndexHtml(plan, courseId))
  fs.writeFileSync(path.join(out, 'courseware.json'), JSON.stringify(courseware, null, 2) + '\n')

  // courseware/ 运行时包：course.json + plan.json（整体保留）+ assets + runtime + scripts + debug + courseware.js（调试兜底）
  const cwDir = path.join(out, 'courseware')
  fs.mkdirSync(cwDir, { recursive: true })
  fs.writeFileSync(path.join(cwDir, 'course.json'), JSON.stringify({
    schemaVersion: 1,
    courseId: courseId,
    grade: grade,
    title: plan.title || '',
    profile: profile,
    engine: { range: '^1.0.0', requiredCapabilities: plan.engine && plan.engine.requiredCapabilities || [] }
  }, null, 2) + '\n')
  fs.writeFileSync(path.join(cwDir, 'README.md'), '# ' + (plan.title || courseId) + '\n')
  fs.writeFileSync(path.join(cwDir, 'engine.version.json'), JSON.stringify({ version: '0.1.0' }, null, 2) + '\n')
  fs.writeFileSync(path.join(cwDir, 'plan.json'), JSON.stringify(plan, null, 2) + '\n')
  fs.writeFileSync(path.join(cwDir, 'courseware.js'), jsWrap('MASTER_COURSEWARE', courseware))

  // 资产
  const assetsDir = path.join(courseDir, 'assets')
  if (fs.existsSync(assetsDir)) copyTree(assetsDir, path.join(cwDir, 'assets'))

  // runtime + scripts + debug
  const runtimeDir = path.join(cwDir, 'runtime')
  const figureSpecPath = path.join(courseDir, 'figure-spec.json')
  const figureSpec = fs.existsSync(figureSpecPath) ? JSON.parse(fs.readFileSync(figureSpecPath, 'utf8')) : null
  writeLessonFiles(path.join(runtimeDir, 'lesson'), plan, courseware, figureSpec)
  assembleRuntime(runtimeDir, profile)
  writeEngineManifest(path.join(runtimeDir, 'src'), profile)
  writeEngineCss(path.join(runtimeDir, 'src'), profile)
  fs.mkdirSync(path.join(cwDir, 'scripts'), { recursive: true })
  fs.writeFileSync(path.join(cwDir, 'scripts', 'smoke-test.mjs'), '// 冒烟测试占位\n')
  // 调试壳：courseware/debug.html（+ debug.css + debug.js）
  copyTree(path.join(root, 'engine', 'templates', 'debug'), cwDir)

  return { courseId, grade, lesson, profile, out }
}

// ---- 主流程：扫描 _output_/{grade}/{courseId}/plan.json ----
function findCourses(requested) {
  const targets = []
  if (!fs.existsSync(outputRoot)) return targets
  for (const g of fs.readdirSync(outputRoot)) {
    const gradeDir = path.join(outputRoot, g)
    if (!fs.statSync(gradeDir).isDirectory()) continue
    if (requested) {
      const dir = path.join(gradeDir, requested)
      if (fs.existsSync(path.join(dir, 'plan.json'))) targets.push(dir)
      continue
    }
    for (const c of fs.readdirSync(gradeDir)) {
      const dir = path.join(gradeDir, c)
      if (fs.statSync(dir).isDirectory() && fs.existsSync(path.join(dir, 'plan.json'))) targets.push(dir)
    }
  }
  return targets
}

const requested = process.argv[2]
const targets = findCourses(requested)

if (!targets.length) {
  console.log('[export] _output_/ 无课件，跳过')
  process.exit(0)
}

const exported = []
for (const dir of targets) {
  const r = exportCourse(dir)
  exported.push(r)
  console.log(`[export] ${r.courseId} (grade ${r.grade}, lesson ${r.lesson}, profile ${r.profile}) -> ${r.out}`)
}

// 兼容门禁（Chrome ≥51 / iOS ≥13）
console.log('[export] 运行兼容门禁…')
const compatScript = path.join(__dirname, 'compat-check.mjs')
for (const r of exported) {
  execSync(`node "${compatScript}" "${path.join(r.out, 'courseware', 'runtime')}"`, { stdio: 'inherit' })
}
console.log('[export] 完成 ✓')
