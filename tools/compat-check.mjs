#!/usr/bin/env node
// 兼容门禁：用 doiuse（caniuse 数据）扫描课件引擎 src CSS（引擎自身 + shared 叠加层），
// 命中 Chrome 51 / iOS 13 不支持的 CSS 特性即失败。IGNORE 列出的特性为已评审放行项。
// 用法：node compat-check.mjs <engine-root>
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

// 依赖（postcss/doiuse）装在引擎的 node_modules；npm 脚本在引擎根运行时 cwd 即引擎根
const require = createRequire(join(process.cwd(), 'package.json'))
const postcss = require('postcss')
const DoIUse = require('doiuse')

const scriptDir = dirname(fileURLToPath(import.meta.url))
const sharedSrc = resolve(scriptDir, '..', 'src')
const engineRoot = resolve(process.argv[2] || '.')
const engineSrc = join(engineRoot, 'src')

const BROWSERS = ['Chrome >= 51', 'iOS >= 13']

// 已评审放行项（均有降级/兜底，见 docs-local/plans/2026-08-09-compat-landing.md）
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

function listCss(dir, out) {
  if (!statSync(dir, { throwIfNoEntry: false })) return
  readdirSync(dir).forEach((name) => {
    const p = join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) listCss(p, out)
    else if (name.endsWith('.css')) out.push(p)
  })
}

async function checkFile(file, base) {
  const rel = file.slice(base.length + 1).replace(/\\/g, '/')
  const css = readFileSync(file, 'utf8')
  const hits = []
  const checker = new DoIUse({
    browsers: BROWSERS,
    ignore: IGNORE,
    onFeatureUsage(info) {
      hits.push({ feature: info.feature, message: info.message, usage: String(info.usage || '').trim().slice(0, 60) })
    }
  })
  try {
    await postcss(checker).process(css, { from: file })
  } catch (err) {
    hits.push({ feature: 'parse-error', message: 'CSS 解析失败', usage: String(err && err.message).slice(0, 120) })
  }
  return hits.map((h) => ({ file: rel, ...h }))
}

const files = []
listCss(engineSrc, files)
listCss(sharedSrc, files)

const results = []
for (const file of files) {
  const base = file.indexOf(engineSrc) === 0 ? engineRoot : resolve(sharedSrc, '..', '..')
  results.push(...(await checkFile(file, base)))
}

if (results.length === 0) {
  console.log(`[compat] OK — ${engineRoot.split(/[\\/]/).pop()} src + shared 无禁用特性命中（doiuse, Chrome>=51/iOS>=13）`)
  process.exit(0)
}

console.log(`[compat] FAIL — 命中 ${results.length} 处：`)
results.forEach((r) => {
  console.log(`  ${r.file}  ${r.feature}  :: ${r.usage}  ${r.message}`)
})
process.exit(1)
