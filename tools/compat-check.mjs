#!/usr/bin/env node
// 兼容门禁：Chrome 51 / iOS 13 运行时代码静态校验。命中即失败，全仓运行时 JS/CSS 都要过。
//   1. CSS 浏览器支持 —— doiuse（caniuse 数据），IGNORE 为已评审放行项
//   2. JS 语法基线 —— acorn 按 ES5 解析，箭头函数/模板字符串/let·const/解构等新语法即失败
//   3. JS 禁用 Web API —— 令牌级扫描（.flat()/Object.fromEntries/structuredClone…），注释与字符串不误报
//   4. CSS 约定 —— vw/vh、100vh、inset 简写、min()/max()/clamp()（有评审白名单 VH_ALLOW）
//   5. 热区软警告 —— 交互选择子上显式 height/min-height <44px（padding 撑大的查不到，仅提示）
// 用法：node compat-check.mjs <engine-root>
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve, dirname, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import postcss, { parse as parsePostcss } from 'postcss'
import { parse as parseAcorn } from 'acorn'

// 依赖（postcss/doiuse/acorn）装在仓库 node_modules；npm 脚本运行时 cwd 即仓库根
const require = createRequire(join(process.cwd(), 'package.json'))
const DoIUse = require('doiuse')

const scriptDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(scriptDir, '..')
const engineRoot = resolve(process.argv[2] || '.')
const engineSrc = join(engineRoot, 'src')
const profileSrc = join(repoRoot, 'profiles')

const BROWSERS = ['Chrome >= 51', 'iOS >= 13']

// ── doiuse 已评审放行项（均有降级/兜底，见 docs-local/plans/2026-08-09-compat-landing.md）──
const IGNORE = [
  'css-overflow',              // overflow 核心属性，caniuse 标部分支持为噪音
  'css-backdrop-filter',       // 装饰性毛玻璃，已加 @supports not 近不透明兜底
  'css-sticky',                // 审题面板有 sticky-fallback.js JS 兜底
  'css-snappoints',            // scroll-padding/scroll-snap：无则滚动不偏移，优雅降级
  'css-overscroll-behavior',   // 无则滚动链回弹，优雅降级
  'css-display-contents',      // 退化为块级，已评审可接受
  'css-scrollbar',             // ::-webkit-scrollbar Chrome 51 支持
  'css-boxdecorationbreak',    // Chrome 51 支持（caniuse 标部分）
  'css-appearance',            // 已带 -webkit-appearance 前缀兜底
  'css-placeholder',           // 已补 ::-webkit-input-placeholder 前缀
  'css-gradients',             // iOS 13 标部分支持噪音（linear-gradient 实际可用）
  'prefers-reduced-motion',    // Chrome 51-73 不支持该媒体查询 → 动画照常，无障碍降级
  'intrinsic-width',           // fit-content/max-content 关键字 Chrome 46+ 已支持，caniuse partial 过宽
  'css3-cursors-grab',         // iOS 触屏无 grab 光标，无害
  'css3-cursors',              // iOS 触屏无 resize 光标，无害
  'css-resize',                // iOS 文本域无 resize 柄，resize:none 无效果，无害
  'extended-system-fonts',     // ui-* 字体回退到下一候选
  'pointer'                    // touch-action Chrome 51 支持
]

// vh 高度白名单：文件级放行（图廊放大镜：vh 恰为期望的视口边界行为，非布局链核心尺寸）
const VH_ALLOW = new Set(['image-zoom.css'])

// 禁用 Web API：方法名（.xxx 调用）——来自 COMPATIBILITY.md §3 + Chrome 51 不支持的内建
const BANNED_METHODS = new Set([
  'flat', 'flatMap', 'at', 'findLast',   // Array.prototype，Chrome 69/97
  'entries', 'values', 'fromEntries',     // Object/Map，Object.entries/fromEntries Chrome 54
  'padStart', 'padEnd',                  // String.prototype，Chrome 57
  'animate'                              // Web Animations API，Chrome 36+ 但 iOS 13 缺；文档禁用
])
// 全局函数/构造器（裸调用）
const BANNED_GLOBALS = new Set(['structuredClone', 'AbortController', 'ReadableStream'])

// 交互选择子（热区软检查用）；\b 词边界，避免 -keyboard 这类复合词误伤
const TAP_SELECTOR = /\b(btn|button|option|choice|tap|close|key|toggle)\b/i

function listFiles(dir, ext, out) {
  if (!statSync(dir, { throwIfNoEntry: false })) return
  readdirSync(dir).forEach((name) => {
    const p = join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) listFiles(p, ext, out)
    else if (name.endsWith(ext)) out.push(p)
  })
}

function collectFiles() {
  const js = []
  const css = []
  listFiles(engineSrc, '.js', js)
  listFiles(engineSrc, '.css', css)
  if (statSync(profileSrc, { throwIfNoEntry: false })) {
    readdirSync(profileSrc).forEach((name) => {
      const src = join(profileSrc, name, 'src')
      listFiles(src, '.js', js)
      listFiles(src, '.css', css)
    })
  }
  return { js, css }
}

const rel = (p) => p.replace(/\\/g, '/').replace(new RegExp('^' + repoRoot.replace(/\\/g, '/') + '/'), '')

// ── JS 语法基线：acorn 按 ES5 解析 ──
export function checkJsSyntax(file, code) {
  const v = []
  try {
    parseAcorn(code, { ecmaVersion: 5, sourceType: 'script', locations: true })
  } catch (err) {
    v.push({ line: (err.loc && err.loc.line) || 0, rule: 'js-es5-syntax', message: String(err.message).split('\n')[0] })
  }
  return v
}

// ── JS 禁用 Web API：令牌级扫描（注释/字符串天然免疫） ──
export function checkJsApis(file, code) {
  const v = []
  let tokens = []
  try {
    parseAcorn(code, { ecmaVersion: 5, sourceType: 'script', locations: true, onToken: (t) => tokens.push(t) })
  } catch (err) {
    return v // 语法错已由 checkJsSyntax 报，这里不重复
  }
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]
    if (t.type.label !== 'name') continue
    // 仅方法调用（标识符后紧跟 `(`）命中；`.at`/`.animate` 作对象属性读取时 Chrome 51 合法
    if (tokens[i - 1] && tokens[i - 1].type.label === '.' && BANNED_METHODS.has(t.value) && tokens[i + 1] && tokens[i + 1].type.label === '(') {
      v.push({ line: t.loc.start.line, rule: 'js-banned-api', message: '成员调用 .' + t.value + '(' + ' —— ' + t.value + ' Chrome 51 / iOS 13 不支持（见 COMPATIBILITY.md §3）' })
    } else if (BANNED_GLOBALS.has(t.value) && tokens[i + 1] && tokens[i + 1].type.label === '(') {
      v.push({ line: t.loc.start.line, rule: 'js-banned-api', message: '全局调用 ' + t.value + '( —— 不支持（见 COMPATIBILITY.md §3）' })
    }
  }
  return v
}

// ── CSS 约定：vw/vh、100vh、inset、min()/max()/clamp() + 热区软警告 ──
export function checkCssConventions(file, css) {
  const v = []
  let root
  try {
    root = parsePostcss(css)
  } catch (err) {
    v.push({ line: 0, rule: 'css-parse', message: String(err.message).split('\n')[0] })
    return v
  }
  const allowVh = VH_ALLOW.has(basename(file))
  root.walkDecls((decl) => {
    const prop = decl.prop
    const val = decl.value
    if (/font-size/.test(prop) && /\d+(\.\d+)?(vw|vh)/.test(val)) {
      v.push({ line: decl.source.start.line, rule: 'css-vw-vh', message: '字号用 vw/vh（' + prop + ':' + val + '），iOS 地址栏/WebView 高度抖动（§5）' })
    } else if (!allowVh && /\d+(\.\d+)?vh/.test(val)) {
      v.push({ line: decl.source.start.line, rule: 'css-vh', message: '高度用 vh（' + prop + ':' + val + '），抖动；用 % 链/rem（§5）' })
    }
    if (prop === 'inset') v.push({ line: decl.source.start.line, rule: 'css-inset', message: 'inset 简写 Chrome 87+，用 top/right/bottom/left 分开（§5）' })
    if (/(?:^|[-:])\s*(min|max|clamp)\(/.test(val)) {
      v.push({ line: decl.source.start.line, rule: 'css-math-fn', message: prop + ':' + val + ' 含 min()/max()/clamp()（Chrome 79+），用 rem/媒体查询（§2）' })
    }
  })
  root.walkRules((rule) => {
    if (!TAP_SELECTOR.test(rule.selector)) return
    // §6 豁免：拖拽手柄非点按目标；::after/before 是装饰，无热区
    if (/-(drag|resize)\b|::(after|before)/.test(rule.selector)) return
    rule.walkDecls(/^(height|min-height)$/, (decl) => {
      const m = decl.value.match(/^([\d.]+)(rem|px)$/)
      if (!m) return
      const px = m[2] === 'rem' ? parseFloat(m[1]) * 16 : parseFloat(m[1])
      if (px < 44) v.push({ line: decl.source.start.line, rule: 'css-hotzone', level: 'warn', message: rule.selector + ' 热区 ' + decl.value + '（<' + (m[2] === 'rem' ? '2.75rem' : '44px') + '），点按目标需 ≥44px（§6）' })
    })
  })
  return v
}

async function doiuseCheck(file) {
  const css = readFileSync(file, 'utf8')
  const hits = []
  const checker = new DoIUse({ browsers: BROWSERS, ignore: IGNORE, onFeatureUsage(info) {
    hits.push({ line: 0, rule: 'css-support', message: info.feature + ' — ' + String(info.usage || '').trim().slice(0, 60) + ' ' + (info.message || '') })
  } })
  try {
    await postcss(checker).process(css, { from: file })
  } catch (err) {
    hits.push({ line: 0, rule: 'css-parse', message: 'CSS 解析失败：' + String(err.message).slice(0, 120) })
  }
  return hits
}

// ── CLI 入口（被测试 import 时不执行）──
const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  const results = []
  const { js, css } = collectFiles()
  for (const f of js) {
    const code = readFileSync(f, 'utf8')
    results.push(...checkJsSyntax(f, code).map((v) => ({ file: rel(f), ...v })))
    results.push(...checkJsApis(f, code).map((v) => ({ file: rel(f), ...v })))
  }
  for (const f of css) {
    const code = readFileSync(f, 'utf8')
    results.push(...checkCssConventions(f, code).map((v) => ({ file: rel(f), ...v })))
    results.push(...(await doiuseCheck(f)).map((v) => ({ file: rel(f), ...v })))
  }

  const errors = results.filter((r) => r.level !== 'warn')
  const warns = results.filter((r) => r.level === 'warn')

  if (errors.length === 0) {
    console.log(`[compat] OK — ${js.length} js + ${css.length} css 无禁用项命中（ES5 语法 / 禁用 API / vw·vh·inset·clamp / doiuse Chrome>=51·iOS>=13）`)
    warns.forEach((w) => console.log(`  [warn] ${w.file}:${w.line}  ${w.rule}  ${w.message}`))
    process.exit(0)
  }

  console.log(`[compat] FAIL — ${errors.length} 处（${js.length} js + ${css.length} css）：`)
  errors.forEach((r) => console.log(`  ${r.file}:${r.line}  ${r.rule}  ${r.message}`))
  process.exit(1)
}
