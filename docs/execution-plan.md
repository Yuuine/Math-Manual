# Math-Manual 执行计划

> 依据 `docs/extraction-plan.md`（需求）与 `docs/postmessage-protocol.md`、`docs/field-design.md`（协议/字段）。
> 分阶段执行；每阶段完成即可验证。

## 0. 目标（最终设计）

**统一基础 + 图展示附加层**：`engine/` = 两模板 100% 共有（全部样式/组件/widget/core/session/容器/滚动）；`profiles/AIClass_figure/` = 仅图展示附加层；`profiles/AIClass_text/` ≈ 空。
**驱动**：master `plan.json`（= courseware.json 超集：节点字段 + 渲染信息 + `problem_source`）→ 编译双投影（父容器 `courseware.json` / 引擎 `timeline`）。
**协议**（父容器驱动）：`{action}` 下发驱动 + `photo_result` 下行；`ready`/`step_ok`/`user_submitted` 上行。
**约束**：源文件即运行 + 编译产物（dist 结构）；编译跑 compat 门禁；CI 兼容门禁（PR→main）。

## 1. 分阶段执行

### Phase 1 · 骨架
- 目录：`engine/` `profiles/AIClass_figure/` `profiles/AIClass_text/` `courses/` `examples/` `vendor/` `docs/` `.github/workflows/`
- `package.json`：node ≥18；deps `postcss` `doiuse`（compat）；scripts：`export`、`compat`、`test`
- `.gitignore`：node_modules / dist / courses 产物等

### Phase 2 · 提取统一引擎基础（engine/）
- **直接拷**（shared 唯一源）：
  - `shared/engine/src/` 全部 → `engine/src/`（components 18、widgets 9、styles 19、core/layout 5、core/scroll 2、core/session 3、config 2、boot、bridge、screens、assets 3）
  - `shared/engine/templates/`、`shared/engine/tests/`、`output-paths.mjs`
- **合并**（AIClass 与 AIClass_text 两模板各自持有、内容一致的公共文件，先 diff 校验字节一致再取一份）：
  - `components/choice.js`、`course-stem-head.js`
  - `core/scroll/scroll-follow.js`、`core/session/`（action-router、course-scheduler、execution-log）、`core/shell/`（container-host、course-container）
  - `bridge/courseware-submit.js`
  - `styles/`：course-container、course-presentation、text-explain、scrollbar、stem-zoom、tokens、widgets、choice、fill、choice-card、engine.css
  - `templates/course/*`、`templates/lesson-runtime/*`、`templates/module/*`
- **适配**：
  - `engine-manifest.js`：从"每模板一份+shared 外部引用"改为"统一一份"，profile 差异由附加层增量清单表达
  - 共享解析：`AICLASS_SHARED_ROOT` / `document.currentScript` 推导 → 统一 `engine/src/` 内直接引用（无外部 shared）
  - `tokens.css` 等通过 `engine.css` 统一 `@import`

### Phase 3 · 图展示附加层（profiles/AIClass_figure/）
- `figures/`：jxg-kit-2d/3d、jxg-loader、kit、registry、view3d-animate
- `components/`：calc-line-fit、calc-tex-split、problem-brief、sticky-fallback
- `core/shell/figure-host.js`
- `styles/`：calc-explain.css、problem-brief.css
- `templates/figure-preview/*`、`templates/figure/stateful.figure.js`
- figure 的 `engine.css` 增量 `@import`（figure 模板才引用）
- vendor：jsxgraph

### Phase 4 · 文本差异层（profiles/AIClass_text/）
- `assets/handwriting-demo/handwriting-demo.mp4`
- `templates/lesson-runtime/lesson/config.local.js`

### Phase 5 · 新建运行时核心（新写，源仓库没有）
- `plan.json` 加载器/驱动器：
  - 读 master plan.json → 建 timeline 状态索引（`id/action → 状态`）
  - `renderState(idOrAction)`：确定性重建——布局容器 + blocks（Widget Registry）+ figureState/figureActions（figure-host）+ animation + outlineIndex
  - 动画规则：顺序 +1 前进播放；回退/跳步瞬间终态
- action 分发：`{action}`（父容器）→ `renderState`；跳转任意 action 即导航
- 协议：`ready`（加载完上报）、`step_ok`（渲染完成确认）、`user_submitted`（作答/拍照上报）、`photo_result`（回填当前状态作答区）
- **新建 `photo-result 渲染`**：`photo_result.value` 的 Markdown 常用子集渲染器（标题/粗斜体/无序列表 → 安全标签 h1–h3/strong/em/ul/li；不执行任意 HTML）+ KaTeX 公式（`$$`/`$`）——ES5、Chrome 51 兼容
- 作者预览：时间线导航 UI（点击任意 action → renderState）
- 复用：course-container 布局骨架、Widget Registry、滚动、styles

### Phase 6 · 编译 + 兼容 + CI
- 编译脚本 `tools/export.mjs`：
  - 输入 `_output_/{grade}/{courseId}/plan.json`（真源，作者本地不入库）+ assets + profile
  - 投影出 `courseware.json`（去渲染字段 + `problem_source`）
  - 装配 **严格 3 项产物结构**：`dist/{grade}/{courseId}/` = `index.html` + `courseware.json` + `courseware/`（运行时包：course.json / plan.json 整体保留 / courseware.js 调试兜底 / assets / runtime/（lesson 生成脚本 + src 全量 + vendor）/ scripts/ / debug.html 调试壳）
- compat 门禁：`compat-check.mjs`（适配 shared 并入 engine 的路径）接入导出
- CI：`.github/workflows/ci.yml`——PR→main 跑 compat（node 24 + npm ci 装 postcss/doiuse）

### Phase 7 · 示例课件（examples/）
- `AIClass_figure/`：master plan.json（含 figure 状态）+ assets
- `AIClass_text/`：master plan.json（text-only）
- 端到端验证：源文件直跑 + 编译产物 + compat 通过

## 2. 需适配/新建的关键文件

| 文件 | 动作 |
|---|---|
| `engine/src/boot/engine-manifest.js` | 适配（统一 + profile 增量） |
| `engine/src/boot/loader.js` | 适配（无外部 shared） |
| `engine/src/bridge/message-bridge.js` | 改造为 action→renderState + 新协议 |
| `engine/src/bridge/courseware-submit.js` | 保留（user_submitted 上报） |
| 新建 `engine/src/core/timeline/plan-loader.js` | master plan.json 加载 + 状态索引 |
| 新建 `engine/src/core/timeline/render-state.js` | 确定性状态渲染 + 动画规则 |
| 新建 `engine/src/core/timeline/navigation.js` | 作者预览时间线导航 |
| `shared/engine/tools/compat-check.mjs` | 适配路径，接入导出 + CI |
| 新建 `tools/export.mjs` | 编译/双投影/装配 |
| 新建 `.github/workflows/ci.yml` | 兼容门禁 |

## 3. 待确认默认项（未反对即按此执行）

作者源 `courses/{courseId}/plan.json`；跳回重建画面、交互态清空可重做；组件/widget 全部纳入；vendor（katex+jsxgraph）纳入；带 debug/parent-shell；示例 AIClass_figure + AIClass_text 各一。

## 4. 风险 / 适配点

- 两模板公共文件须先 diff 确认字节一致，再取一份合并。
- `compat-check.mjs` 当前按 `engineRoot/src + 独立 sharedSrc` 扫描，Math-Manual 合并 shared 后需改路径逻辑。
- 新引擎无现成 `plan.json` 驱动器/状态渲染，是主要新写工作（Phase 5）。
- `photo_result` 回填目标由状态机持有（无旧"最近拍照 action"概念）。
- 动画长回退需"瞬间终态"渲染，涉及 figure 动画中间态处理（先快照终态，动画播放仅在 +1 前进）。
