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
import { checkCoursewareFile } from './courseware-check.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const engineSrc = path.join(root, 'engine', 'src')
const vendorSrc = path.join(root, 'vendor')

const FLOWS = [
  { flow_id: 'flow_1', title: '学习例题的解题思路' },
  { flow_id: 'flow_2', title: '快速复习例题的解题思路' },
  { flow_id: 'flow_3', title: '自己来做做练习题' }
]

function actionName(entry) {
  if (entry && typeof entry === 'object' && entry.name != null) return String(entry.name)
  if (entry != null && entry !== '') return String(entry)
  return ''
}

function stateTriggerAt(state) {
  if (state && state.at) return String(state.at)
  const a = state && state.action && state.action[0]
  if (a && typeof a === 'object' && a.at) return String(a.at)
  return ''
}

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

/** 空口播且带 at 的拍，并入上一句口播节点的 action[] 为 {name, at}（引擎 timeline 仍一拍一状态） */
function buildCourseware(plan) {
  const timeline = plan.timeline || []
  const folded = new Set()
  const nodes = []
  for (const st of timeline) {
    const at = stateTriggerAt(st)
    const host = nodes.length ? nodes[nodes.length - 1] : null
    const canFold = !!(
      at &&
      host &&
      host.text &&
      host.type !== 'question' &&
      !(st.text) &&
      st.type !== 'question' &&
      !st.answer_type &&
      (st.flow_id || 'flow_1') === host.flow_id
    )
    if (canFold) {
      const name = actionName(st.action && st.action[0]) || st.id
      host.action.push({ name, at })
      host.next = st.next != null ? st.next : null
      folded.add(st.id)
      if (host.text.indexOf(at) < 0) {
        console.warn('[export] action at 不在口播 text 中: ' + name + ' at="' + at + '" (node ' + host.id + ')')
      }
      continue
    }
    nodes.push(projectNode(st))
  }
  const byId = new Map(timeline.map((s) => [s.id, s]))
  function remap(id) {
    let cur = id
    const seen = new Set()
    while (cur && folded.has(cur) && !seen.has(cur)) {
      seen.add(cur)
      const src = byId.get(cur)
      cur = src && src.next != null ? src.next : null
    }
    return cur && folded.has(cur) ? null : cur
  }
  for (const n of nodes) {
    n.next = remap(n.next)
    if (n.test && n.test.length) {
      n.test = n.test.map((t) => Object.assign({}, t, { next: remap(t.next) }))
    }
  }
  const byNodeId = {}
  for (const n of nodes) byNodeId[n.id] = n
  for (const n of nodes) {
    if (!n.test) continue
    for (const t of n.test) {
      if (!t || t.next == null) continue
      const tgt = byNodeId[t.next]
      if (tgt) tgt.text = ''
    }
  }
  return {
    id: plan.courseId || plan.id || '',
    title: plan.title || '',
    child_title: FLOWS.map((f) => ({ title: f.title, flow_id: f.flow_id })),
    problem_source: plan.problem_source || [],
    nodes,
    globals: []
  }
}

function markdownRoot() {
  if (process.env.AICLASS_MARKDOWN) return process.env.AICLASS_MARKDOWN
  const fallback = path.join(path.parse(root).root, 'markdown', 'AIClass-1')
  return fs.existsSync(fallback) ? fallback : null
}

/** 原题 markdown 目录：优先 _output_ 里已放的 .md，否则按 AIClass-1/{grade}-{lesson}/{lesson}-{N}star/ */
function findProblemMarkdownDir(courseDir, parts) {
  const hasMd = (dir) => {
    if (!dir || !fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return false
    return fs.readdirSync(dir).some((n) => n.toLowerCase().endsWith('.md'))
  }
  if (hasMd(courseDir)) return courseDir
  const mdRoot = markdownRoot()
  if (!mdRoot) return null
  const grade = String(parts.grade)
  const lesson = String(parts.lesson)
  const short = lesson + '-' + parts.difficulty + 'star'
  const leaf = parts.leafId
  const lessonDir = path.join(mdRoot, grade + '-' + lesson)
  const candidates = [
    path.join(lessonDir, short),
    path.join(lessonDir, leaf),
    path.join(lessonDir, grade + '-' + lesson + '-' + parts.difficulty + 'star')
  ]
  return candidates.find(hasMd) || null
}

function extractMarkdownImageRefs(mdText) {
  const refs = []
  const re = /!\[[^\]]*\]\(([^)]+)\)|<img\b[^>]*\bsrc=["']([^"']+)["']/gi
  let m
  while ((m = re.exec(mdText))) {
    const raw = String(m[1] || m[2] || '').trim().replace(/^<|>$/g, '').split(/\s+/)[0]
    if (raw) refs.push(raw)
  }
  return refs
}

function copyFileInto(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  fs.copyFileSync(src, dest)
}

// ---- 原题留档：{course}/problem/ 只放 markdown + 用到的图片（不写 problems.json）----
// 输入 plan.problem_source（images 可为 [{url,description}] 或纯字符串；url 相对 courseDir）
// 产出：
//  - {course}/problem/*.md —— 原题 markdown
//  - {course}/problem/ 下题干图片（url 与 md 占位符一致，按文件名）
// 返回 courseware.problem_source.images → [{url, description}]（url 为文件名）
function archiveProblems(outDir, courseDir, plan, parts) {
  const problemDir = path.join(outDir, 'problem')
  fs.mkdirSync(problemDir, { recursive: true })
  const missing = []

  const mdDir = findProblemMarkdownDir(courseDir, parts)
  if (mdDir) {
    for (const name of fs.readdirSync(mdDir)) {
      if (!name.toLowerCase().endsWith('.md')) continue
      const srcMd = path.join(mdDir, name)
      copyFileInto(srcMd, path.join(problemDir, name))
      const mdText = fs.readFileSync(srcMd, 'utf8')
      for (const ref of extractMarkdownImageRefs(mdText)) {
        if (/^(https?:|data:)/i.test(ref)) continue
        const rel = ref.replace(/\\/g, '/')
        const srcImg = path.join(mdDir, rel)
        if (fs.existsSync(srcImg) && fs.statSync(srcImg).isFile()) {
          copyFileInto(srcImg, path.join(problemDir, rel))
        } else {
          missing.push(rel)
        }
      }
    }
  } else {
    console.warn('[export] 未找到原题 markdown（_output_ 与 AIClass-1 均无 .md）')
  }

  const problems = plan.problem_source || []
  const forCourseware = problems.map((ps) => {
    const imgs = Array.isArray(ps.images) ? ps.images : []
    const seen = {}
    const out = []
    imgs.forEach((it) => {
      const url = typeof it === 'string' ? it : (it && it.url != null ? String(it.url) : null)
      if (!url) return
      const base = path.basename(url)
      const src = path.join(courseDir, url)
      if (fs.existsSync(src)) {
        copyFileInto(src, path.join(problemDir, base))
      } else if (!fs.existsSync(path.join(problemDir, base))) {
        missing.push(url)
      }
      if (seen[base]) return
      seen[base] = true
      const description = it && typeof it === 'object' && it.description != null
        ? String(it.description)
        : ''
      out.push({ url: base, description })
    })
    return Object.assign({}, ps, { images: out })
  })
  if (missing.length) console.warn('[export] 缺失题干图片（已跳过）: ' + missing.join(', '))
  return forCourseware
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
    // 单对象或 specs[] / 顶层数组（例+练两套图）都摊平成 FIGURE_SPECS
    const list = Array.isArray(figureSpec)
      ? figureSpec
      : (Array.isArray(figureSpec.specs) ? figureSpec.specs : [figureSpec])
    const figureJs = 'window.FIGURE_SPECS = ' + JSON.stringify(list) + ';\n' +
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
  // loader.js 写死加载 config.local.js；无 profile 覆盖层时也要保证文件存在（file:// 下 404 会报错）
  const configLocalPath = path.join(lessonDir, 'config.local.js')
  if (!fs.existsSync(configLocalPath)) {
    fs.writeFileSync(configLocalPath, '// 导出包默认不携带密钥。宿主可在本文件中注入 provider 与本地覆盖配置。\nwindow.AIClassProviders = window.AIClassProviders || {}\n')
  }
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

  // courseware/ 运行时包：course.json + plan.json（整体保留）+ assets + runtime + scripts + debug + courseware.js（调试兜底）
  // 原题留档独立于运行时包，落在 {course}/problem/
  const cwDir = path.join(out, 'courseware')
  fs.mkdirSync(cwDir, { recursive: true })

  // 顶层（4 项）：index.html + courseware.json（problem_source.images → {url, description}）+ problem/ 原题留档
  fs.writeFileSync(path.join(out, 'index.html'), generateIndexHtml(plan, courseId))
  courseware.problem_source = archiveProblems(out, courseDir, plan, parts)
  fs.writeFileSync(path.join(out, 'courseware.json'), JSON.stringify(courseware, null, 2) + '\n')

  // courseware.json 校验：硬规则违规中止导出，软规则仅提示（规则见 courseware-check.mjs）
  const cwCheck = checkCoursewareFile(path.join(out, 'courseware.json'))
  for (const v of cwCheck) {
    const line = `[courseware-check] ${v.level === 'hard' ? 'FAIL' : 'warn'} ${v.rule}${v.node ? ' [' + v.node + ']' : ''} ${v.message}`
    if (v.level === 'hard') throw new Error(line)
    console.warn(line)
  }

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
  // 每课件独有样式钩子：作者在 _output_/{course}/lesson/styles/lesson.css 提供的样式
  // 覆盖到 runtime/lesson/styles/lesson.css（在 profile 覆盖层之后，作者优先）
  const authorLessonCss = path.join(courseDir, 'lesson', 'styles', 'lesson.css')
  if (fs.existsSync(authorLessonCss)) {
    fs.copyFileSync(authorLessonCss, path.join(runtimeDir, 'lesson', 'styles', 'lesson.css'))
  }
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
