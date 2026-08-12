# Math-Manual 提取计划（持续维护的需求文档）

> 本仓库的目标与范围文档，随对话逐轮修订。最新确认见「当前共识」，遗留问题见「待澄清」。

## 当前共识（截至 2026-08-12 第四轮）

1. **定位**：`Math-Manual` 是**基础模板仓库**。用户在其基础上制作课件，复用已有的**样式、滚动机制**等基础能力。
2. **范围**：从 `G:\A-tem\templates` 提取两个模板 **`AIClass`（几何/图形）** 与 **`AIClass_text`（文本）**，以及相关的 **`shared/` 共享核心**。**排除** `AIClass_calculation`。
3. **运行时机制不裁剪**：action 驱动、核心驱动（session / 调度 / 路由）、**postMessage 交卷协议**等机制必须**原样保留**。
4. **去掉 skills 生成链 + schema 校验**：`schemas/*` 校验、`tools/aiclass.mjs` 生成管线（plan → `.generated/` → dist 编译、per-problem 多 plan 拆分）是 skills 驱动的产物，Math-Manual 不需要。**`plan.json` 保留为手写主编排文件**（非 skills 生成）。
5. **可拓展性**：正文区可自由设计；大纲（guidanceChain）为可选组件，可不用。Widget 注册表是拓展口。
6. **共享核心解耦**：`course-container` / 滚动 / 样式 / `Widget Registry` / 组件只消费普通 JS 对象与 DOM，不绑定 JSON，可独立提取。
7. **运行工作流**：**源文件即运行**（开发/预览，`file://`）**+ 编译产出**（发布）。作者写**主编排 `plan.json`**；编译步骤派生父容器 `courseware.json` + 装配发布包，产物结构参考 `G:\A-tem\templates` 的 `dist/` 结构。
   - **dist 产物结构（参照）**：`dist/{grade}/{courseId}/courseware/` → `course.json`、`course.lock.json`、`debug.html`、`engine.version.json`、`README.md`、`content/{problemId}/plan.json`、`runtime/`（`lesson/` 生成脚本 + `src/` 引擎全量 + `vendor/`）、`scripts/smoke-test.mjs`。无 `index.html`，运行时由宿主加载。
   - **产出物结构有硬性要求**（下游宿主按此消费），当前以 templates 结构为参照基准。
8. **组织方式（已细化）**：**统一 engine 基础 + 图展示附加层**。两模板除「图的展示部分」外全部一致（已核对源码：仅 styles×2 + components×4 + figure-host + figures×6 + figure 模板为 AIClass 独有）。`engine/` 收录两模板 **100% 共有**内容（全部样式/组件/widget/core/session/容器/滚动）；`profiles/AIClass_figure/` = **仅图展示附加层**；`profiles/AIClass_text/` = 几乎空（handwriting-demo.mp4 + config.local.js）。
   - **⚠️ 合并真相（执行期发现）**：核心文件双向发散（figure 版：rem 尺寸/图布局/拍照；text 版：新版引导轨 `cc-guide-track`/键盘守卫/interleaved 默认）。统一方案：**以 figure 版为底 + 并入 text 新版引导轨与键盘守卫**；尺寸系统统一 rem；引导轨统一新版。
   - **布局（已定）**：引擎只实现 **2 种布局**——`text-only`（AIClass_text）+ `left-right`（左图右文，AIClass_figure）。去掉 figure-text/text-over-figure/top-split。
9. **主编排文件 `plan.json`（主驱动文件核心）**：每个课件保留**一个手写的 `plan.json`**，编排**所有 action 步骤、动画、以及画面上展示的一切内容**（含正文区、大纲、题干、图形状态/动作）。运行时**直接读取 `plan.json` 驱动课件**（file:// 即运行，无构建）。它取代现有「course.json + 每 problem 一个 plan.json + 生成模块」的 skills 链。
   - 去掉的只是：schema 校验、`.generated/`、`tools/aiclass.mjs` 生成管线、per-problem 多 plan.json 拆分。
   - **新运行时组件**：需要新增一个「`plan.json` 加载器/驱动器」，把 plan.json 解释成引擎 API 调用（container / scheduler / widget / 动画）——这是源仓库没有的、需新建的逻辑。
   - **⚠️ 形态重新设计（第五轮确认）**：新模板**引擎驱动方式可能改变**，`plan.json` 不沿用现有 vocabulary，**按新需求重新设计**。具体形态待用户提供新需求。

### 新驱动模型（第六轮：时间线 + 状态导航）

- **时间线推进**：课件沿一条 action 时间线推进，**每个 action 对应课件的一个状态**。
- **任意跳回**：任何时候点击某个 action，都能回到该状态 → 需支持 `renderState(N)`（按状态索引**确定性重建整屏**），而非现有"只增不减"的渐显。
- **可实现性**：可行（小规模整屏重建/快照缓存 + 数据驱动状态）。**难点**：① 交互/判题过程态如何随状态呈现；② 图形/3D 动画中间态；③ 滚动位置与焦点。
- **影响**：`plan.json` 的状态是**一等的寻址单元**；引擎渲染模型从"向前渐显"改为"按状态重建"。
- **使用方（第七轮确认）**：**作者预览 + 学生端都要**。状态导航做成**通用运行时能力**（`renderState(N)`），作者预览与学生端复用；交互/判题过程态如何随状态呈现是待设计点。
- **推进方式（第八轮确认）**：**action 触发式** —— 每个 action 由事件触发（下一步点击 / 提交答案 / 宿主页下发 action），**时间线 = 有序状态列表**，**动画 = 状态切换过渡**。非时间自动播放。
- **长动画处理（第九轮讨论，第十轮定案）**：课件动画很长，跳回旧状态**不得重放动画**。定案规则（最简）：
  - **顺序推进**（下一步、未跳步）：**正常播放**该步的 push 内容/动画。
  - **回退**：**瞬间展示**该步**终态**。
  - **跳步**（任意方向，含"回退后再跳步"——跳到已播放或未来的步骤）：**瞬间展示**目标步**终态**。
  - 即：**只有"严格顺序 +1 前进"播放动画，其余一律快照终态**。无跳过按钮、无播放条。
11. **命名（第十三轮确认）**：两个 profile 命名为 **`AIClass_figure`**（带图，原 AIClass）与 **`AIClass_text`**（文本），与源模板命名对齐；`plan.json` 的 `profile` 字段用此二值。
12. **postMessage 协议（定稿，父容器驱动）**：课件**完全由父容器下发 action 驱动**；每个 action = 时间线一个状态 → `renderState`。冻结不变：`user_submitted`（kind∈course_fill/course_choice/course_photo/voice + value；拍照无 value）与 `photo_result`（value）；保留 `ready`、`step_ok`（精简版，无进度字段）；移除其余全部（step_ok 进度/side_effect/replay/scroll/pause/resume/switch/scheduler_error/help/course_reset/concept/quick_qa/answer_result_shown 及旧特殊 action）。父容器从发布包 **`courseware.json`** 读推进步骤。详见 [postmessage-protocol.md](./postmessage-protocol.md)。
13. **统一设计（plan.json = courseware.json 超集，用户已确认）**：master `plan.json` 的 `timeline[]` 每个状态 = 一个 courseware 节点（`id/flow_id/type/text/action[]/next/test[]/question_type?/answer_type?/answer[]`）**＋渲染信息**（`blocks[]/figureState/figureActions/animation`）；顶层含 `problem_source`（原题留档，新 courseware.json 结构的新增节点）。编译时**双投影**：父容器 ← `courseware.json`（去渲染字段），引擎 ← 读 `plan.json` timeline 渲染。
14. **兼容性约束（必须遵守）**：`G:\A-tem\templates\COMPATIBILITY.md`（基线 Chrome 51 / iOS 13）：禁用 CSS（grid/gap/sticky/:has()/aspect-ratio/逻辑属性/clamp 等）、禁用 Web API（flat/at/structuredClone/Web Animations 等）、运行时脚本**纯 ES5**、rem 单位、热区 ≥44px、软键盘处理、图片 @2x/@3x。**编译导出课件时跑一遍兼容门禁**：沿用 `shared/engine/tools/compat-check.mjs`（postcss + doiuse 扫描引擎+shared CSS，含已评审 `IGNORE` 放行清单），失败即中断导出。
15. **CI 兼容门禁**：Math-Manual 新增 GitHub Actions workflow——**PR 到 main 必须通过兼容性检查**（跑 `compat-check.mjs`，基线 Chrome ≥51 / iOS ≥13），失败即拦截合并。参考 templates 的 `.github/workflows/ci.yml`（node 24 + npm ci 装 doiuse/postcss）。注意：Math-Manual 将 shared 并入 engine，`compat-check.mjs` 的路径逻辑（`engineRoot/src` + 独立 `sharedSrc`）需相应适配。

## 待澄清（按重要性排序）

> 用户当前有**新的澄清内容**要提（第 22 轮起），执行暂缓。以下为已收敛/剩余项。

- 关联文档：**[postmessage-protocol.md](./postmessage-protocol.md)**（协议定稿）｜**[field-design.md](./field-design.md)**（全部交互/内容字段现状 + courseware.json 结构）
- **✅ 已收敛**：postMessage 协议（父驱动、精简）、plan.json=courseware.json 超集统一设计、双投影、`problem_source` 确认、profile 命名。
- [ ] **用户后续澄清内容**：待用户提出（**当前进行中**）
- [ ] 作者源文件位置（master plan.json 与资产的源真目录）：建议 `courses/{courseId}/plan.json` + `courses/{courseId}/assets/`——待确认
- [ ] 状态还原的程度：只还原画面 vs 连同交互/判题结果——建议：跳回重建画面、交互态清空可重做（不保存过程态）——待确认
- [ ] 共享组件/widget 的纳入范围：默认**全部纳入**（机制不能少）——待确认
- [ ] `vendor/`（katex / jsxgraph）：默认**纳入**——待确认
- [ ] 宿主调试壳 `debug/parent-shell`：默认**带**——待确认
- [ ] 手写示例课件：默认 **1–2 个**（AIClass_figure + AIClass_text 各一）——待确认

## 可提取清单（草案）

### A. `AIClass/` 独有（几何/图形）
- 即「图展示附加层」，见 C′（figures/ + calc-line-fit/calc-tex-split/problem-brief/sticky-fallback + figure-host + calc-explain/problem-brief 样式 + figure-preview 模板）

### B. `AIClass_text/` 独有（文本）
- 资源：`src/assets/handwriting-demo/`（MP4）
- 模板：`lesson/config.local.js`（text 独有）
- 其余与 AIClass 重复 → 归入 C 合并

### C. 两模板共有的统一基础（**合并为单一 `engine/`，不重复**）
- `boot/engine-manifest.js`、`boot/loader.js`、`bridge/courseware-submit.js`
- `core/scroll/scroll-follow.js`、`core/session/*`（action-router、course-scheduler、execution-log）、`core/shell/*`（container-host、course-container）
- `components/`：choice.js、course-stem-head.js
- 样式：course-container、course-presentation、text-explain、scrollbar、stem-zoom、tokens、widgets、choice、fill、choice-card、engine.css
- `templates/course/*`、`templates/lesson-runtime/*`、`templates/module/*`

### C′. 图展示附加层（`profiles/AIClass_figure/`，AIClass 独有）
- 样式：`calc-explain.css`、`problem-brief.css`
- 组件：`calc-line-fit.js`、`calc-tex-split.js`、`problem-brief.js`、`sticky-fallback.js`
- `core/shell/figure-host.js`
- `figures/`：jxg-kit-2d/3d、jxg-loader、kit、registry、view3d-animate
- 模板：`templates/figure-preview/*`、`templates/figure/stateful.figure.js`

### D. `shared/` 共享核心（唯一权威源）
- 组件 18：button、choice-card、difficulty-stars、dom、file-postmessage-compat、hand-hint、image-zoom、latex、mathlive、option、oral-card、oral-input、overlay-scrollbar、quick-qa、recognition-result、stem-zoom、toast、viewport-scale
- widgets 9：chain、choice、fill、intro-gallery、oral、read-list、registry、solve-step、stem-choice
- 样式 19：board、button、chain、difficulty-stars、fill-card、hand-hint、image-zoom、intro-gallery、mathlive-keyboard、oral-card、oral-input、overlay-scrollbar、quick-qa、read-list、recognition-result、scene-background、stem-choice、toast + concept-sheet
- core：layout 5 + scroll 2 + session 3 ｜ config 2 ｜ boot ｜ bridge ｜ screens ｜ assets（stars ×3）
- **编译/校验工具**：`tools/compat-check.mjs`（兼容门禁，含 `IGNORE` 放行清单）+ 依赖 `postcss`/`doiuse`；`tests/*`、`output-paths.mjs`

### E. 明确排除
- `AIClass_calculation/`、`dist/`、`_output_/`、`node_modules/`、`.codegraph/`、`.github/`、`.idea/`、`.reasonix/`

## 目标文档结构（截至第四轮已确认的形态）

```
Math-Manual/
├── README.md
├── docs/
│   └── extraction-plan.md      ← 本文件
├── engine/                     ← 单一引擎核心（共享 + 两模板合并的公共逻辑，只留一份）
│   ├── src/
│   │   ├── styles/             tokens / 容器 / 滚动 / 组件样式（共享 19 + 公共 11）
│   │   ├── components/         通用 UI 组件（共享 18 + 公共 choice、course-stem-head）
│   │   ├── widgets/            块渲染器 + registry（9）
│   │   ├── core/
│   │   │   ├── layout/         layout-stage、background-board、scene-background…
│   │   │   ├── scroll/         scroll-index、scroll-follow、overlay-scrollbar、stem-zoom
│   │   │   ├── shell/          course-container、container-host、figure-host
│   │   │   └── session/        action-router、course-scheduler、interaction-gate、execution-log、submit-text
│   │   ├── boot/ bridge/ config/ screens/
│   │   ├── figures/            AIClass_figure 图形能力（jxg-kit 2D/3D、registry）
│   │   └── assets/             难度星级等
│   ├── templates/              lesson-runtime 骨架（index.template.html、bootstrap、handlers、module）
│   └── profiles/               ← 两模板差异层（命名与源模板对齐）
│       ├── AIClass_figure/     AIClass 独有：calc-explain/problem-brief 样式、figure-preview、sticky-fallback
│       └── AIClass_text/       AIClass_text 独有：handwriting-demo、config.local.js
├── examples/                   手写示例课件（AIClass_figure + AIClass_text 各一）
└── vendor/                     katex + jsxgraph
```

## 备注 / 风险

- `shared/.extract-manifest.json` 已过期（149 项含已删除的 `screens/pre-lesson/*`），最终以实际文件树为准。
- session 层去留已定（保留），故 `core/session/*` 与 `bridge/courseware-submit.js` 必须原样纳入。
