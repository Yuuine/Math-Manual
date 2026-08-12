# 课件兼容性要求

> 适用于 `shared/engine` 与三个模板引擎（`AIClass` / `AIClass_text` / `AIClass_calculation`）的**运行时浏览器代码**（CSS / JS / 模板）。
> 设计课件、新增或修改任何运行时样式/脚本时必须遵守本文件。宿主适配方案见 `docs/移动端适配.md`；逐项整改跟踪见 `docs/mobile-adapt-checklist.html`。

## 1. 最低兼容基线

课件作为宿主混合式应用 WebView 内嵌页面运行，**必须同时在两端渲染**：

| 平台 | 基线 |
|---|---|
| Android 7（API 24） | 按**初始 Android System WebView / Chrome 51**（2016）设计，不假设系统 WebView 更新过 |
| iOS 13 | WKWebView（Safari 13 内核，2019） |

**交集原则**：两端都要能跑，只能用两边都支持的功能——以较弱方（Chrome 51）为准。iOS 13 能力更强，但不作为放宽依据；禁用清单宁严勿松，保证两端形态一致。

## 2. 禁用 CSS

以下特性 Chrome 51 不支持或两端缺失，**禁止用于核心布局/功能**：

- `display: grid` / `grid-template-*`
- Flex / Grid `gap`、`row-gap`、`column-gap`
- `position: sticky`
- `:has()`
- 容器查询 `@container`
- `aspect-ratio`
- 逻辑属性 `margin-inline` / `padding-block` 等
- `color-mix()` / `oklch()`
- 8 位十六进制颜色 `#RRGGBBAA`（用 `rgba()`）
- `clamp()` / `min()` / `max()`（Chrome 79+，禁用核心尺寸；用 `rem` / 媒体查询）
- `backdrop-filter`（Chrome 76+，**谨慎**：仅装饰性毛玻璃，必须带不透明背景兜底，见 Phase 6 的 `@supports not` 模式）

布局能力回退为：**Flexbox（无 gap）+ 百分比 / rem + 媒体查询**。间距用 `margin` + `:first-child` / `:last-child` 或 `> * + *` 实现。

> `position: sticky` 无纯 CSS 替代：引擎对审题面板实现 JS 兜底（`sticky-fallback.js`，boot 期探测 + 无支持时 fixed 吸顶），须保持该兜底不回归。

## 3. 禁用 / 谨慎 Web API

- **禁用**：`AbortController` / fetch `signal`、`Array.prototype.flat` / `flatMap` / `at` / `findLast`、`Object.fromEntries`、`structuredClone`、Web Animations API（`element.animate()`）、ReadableStream 流式 fetch。
- **谨慎**（须带降级守卫）：`ResizeObserver` / `IntersectionObserver`——Chrome 51 缺失或残缺，必须提供无该 API 时的回退路径（如 `resize` 事件 + 防抖）。

## 4. JS 语法基线

运行时脚本的输出必须能在 Chrome 51 / iOS 13 直接运行。宿主侧由 Babel 转译降级（文档 §1.3），但**课件引擎构建无 Babel 转译步骤**，因此运行时脚本须保持**纯 ES5 手写**（`var` / `function` / 字符串拼接），不引入箭头函数、模板字符串、解构等新语法，避免引入需降级的语法特性。

## 5. 单位与字号

- 字号与核心尺寸统一 `rem`（16px 基准）。**双模式**：hosted 模式（宿主提供 `matrix-content` 根节点，无 transform）随宿主 `html` 根字号（`BASE_W = 667`）等比缩放；独立/调试模式根字号恒为默认 16px，由舞台 `transform: scale` 缩放，rem 与 px 等价。两者按模式互斥、不叠加。
- 禁止用 `vw` / `vh` 作为字号或核心尺寸（iOS 地址栏 / Android WebView 高度抖动）。
- 禁止 `100vh` 全屏高度链；全屏用 `100%` 链式继承或 `position: fixed; top:0; right:0; bottom:0; left:0`（`inset` 简写为 Chrome 87+，禁用）。
- 最小正文 ≥ `0.875rem`（基准 16px 下 ≈ 14px）。

## 6. 触控热区

- 可点元素热区 ≥ **44px**（`2.75rem`），用 `padding` 扩大热区而非仅靠字号。
- 适用于所有按钮 / 选项 / 输入域 / 关闭键。
- 数学键盘（mathlive）按键/标签/关闭/清空已放大到 44px；拖拽条为拖动手柄非点按目标，豁免并保留小尺寸。

## 7. 固定定位元素与软键盘

- 横屏下软键盘占较大高度，底部 `position: fixed` 元素（悬浮按钮、键盘面板）必须处理遮挡：监听 `resize` 高度骤降时收起或上移。
- 不依赖 `VisualViewport`（Android 7 缺失），用 `resize` + 高度阈值。
- 安全区（home indicator / 圆角）：优先由原生统一裁剪，前端不重复处理；若需自理，用 `padding` 估算，不把 `env(safe-area-inset-*)` 当核心方案。

## 8. 图片与媒体

- 位图提供 `@2x` / `@3x`，用 `<img srcset>` 或媒体查询切换；维持比例用「固定宽 + `height: auto`」或百分比容器（禁用 `aspect-ratio`）。

## 9. 构建期校验

- 课件构建已接入兼容门禁 `course:compat`（`shared/engine/tools/compat-check.mjs`，基于 **doiuse** + caniuse 数据，基线 `Chrome >= 51 / iOS >= 13`）：扫描引擎 `src` + `shared` 全部 CSS，命中不支持的 CSS 特性即失败，并已前置进 `course:export`。已评审放行项（有降级/兜底）记录在门禁脚本的 `IGNORE` 清单，新增放行须评审后加入。宿主侧沿用 `compatibility.config.ts` + doiuse（见 `docs/移动端适配.md` §7.1）。
