// 兼容门禁单测：ES5 语法 / 禁用 Web API / CSS 约定 / 热区软警告
// 直接调 compat-check.mjs 导出的纯函数，不跑 CLI 副作用
import test from 'node:test'
import assert from 'node:assert/strict'
import { checkJsSyntax, checkJsApis, checkCssConventions } from '../compat-check.mjs'

test('ES5 语法门禁：新语法被拒、纯 ES5 通过', () => {
  assert.ok(checkJsSyntax('x.js', 'var f = () => 1;').length > 0, '箭头函数')
  assert.ok(checkJsSyntax('x.js', 'var s = `tpl`;').length > 0, '模板字符串')
  assert.ok(checkJsSyntax('x.js', 'let a = 1;').length > 0, 'let')
  assert.ok(checkJsSyntax('x.js', 'const a = { b: 1 };').length > 0, 'const')
  assert.ok(checkJsSyntax('x.js', 'function f(a = 1) {}').length > 0, '默认参数')
  assert.equal(checkJsSyntax('x.js', 'var f = function (a) { return a + 1 }').length, 0, '纯 ES5 通过')
})

test('禁用 Web API：令牌级扫描，注释/字符串不误报', () => {
  assert.ok(checkJsApis('x.js', 'var a = list.flat();').length > 0, '.flat()')
  assert.ok(checkJsApis('x.js', 'var a = list.at(0);').length > 0, '.at()')
  assert.ok(checkJsApis('x.js', 'var o = Object.fromEntries(x);').length > 0, 'Object.fromEntries')
  assert.ok(checkJsApis('x.js', 'var c = structuredClone(x);').length > 0, 'structuredClone')
  assert.ok(checkJsApis('x.js', 'el.animate({ opacity: 0 });').length > 0, '.animate() Web Animations')
  assert.equal(
    checkJsApis('x.js', '// .flat() 注释不算\nvar s = ".flat() 字符串也不算";').length,
    0,
    '注释/字符串里的禁用名不误报'
  )
  assert.equal(
    checkJsApis('x.js', 'var isStr = typeof action.at === "string"; if (figureState.animate === true) {}').length,
    0,
    '属性读取 .at/.animate 不误报（非方法调用）'
  )
})

test('CSS 约定：vw/vh、inset、clamp 被拒，白名单/宽度 vw 放行', () => {
  assert.ok(checkCssConventions('s.css', '.a { min-height: 60vh; }').length > 0, 'vh 高度')
  assert.ok(checkCssConventions('s.css', '.a { font-size: 2vw; }').length > 0, '字号 vw')
  assert.ok(checkCssConventions('s.css', '.a { inset: 0; }').length > 0, 'inset 简写')
  assert.ok(checkCssConventions('s.css', '.a { width: clamp(1px, 2%, 3px); }').length > 0, 'clamp')
  assert.equal(checkCssConventions('image-zoom.css', '.a { max-height: 92vh; }').length, 0, 'image-zoom vh 白名单')
  assert.equal(checkCssConventions('s.css', '.a { max-width: 97vw; }').length, 0, '宽度 vw 放行')
})

test('热区软警告：关闭按钮 <44px 警告，拖拽手柄豁免', () => {
  const hot = checkCssConventions('s.css', '.cc-close-btn { height: 2rem; }')
  assert.equal(hot.filter((v) => v.rule === 'css-hotzone' && v.level === 'warn').length, 1, '关闭按钮 32px 应警告')
  const exempt = checkCssConventions('s.css', '.close-btn-drag { height: 1rem; }')
  assert.equal(exempt.filter((v) => v.rule === 'css-hotzone').length, 0, '拖拽手柄豁免')
})
