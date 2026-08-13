# Math-Manual

基础课件模板仓库。用户在**手写一份主编排 `plan.json`** 的基础上制作数学课件，复用已有的样式、滚动机制、图形渲染与交互能力。

## 定位

- **统一基础**：`engine/` 收录两模板（图形 / 文本）100% 共有内容——组件、widget、样式、会话、容器、滚动。
- **两个 profile**：`AIClass_figure`（左图右文 + JSXGraph 图形）、`AIClass_text`（单栏纯文本）。差异仅是「图的展示部分」。
- **父容器驱动**：课件完全由父容器下发 `action` 驱动；每个 action = 时间线一个状态。
- **编译产出**：`tools/export.mjs` 把 `_output_` 的手写 plan.json 装配成发布包（严格 3 项产物结构）。
- **作者真源不入库**：`_output_` 是作者本地维护课件的主编排源（plan.json + assets + figure-spec.json）。它属于使用方内容、不属于模板仓库，整体写入 `.gitignore`；本仓库只收录框架（engine / profiles / tools / vendor / docs）。
- **兼容约束**：运行时遵循 Chrome ≥51 / iOS ≥13（见 `COMPATIBILITY.md`）；导出时跑兼容门禁。

## 目录结构

```
Math-Manual/
├── engine/                     统一引擎基础（两模板共有）
│   ├── src/
│   │   ├── styles/             样式（tokens / 容器 / 组件 / 引导轨）
│   │   ├── components/         通用 UI 组件
│   │   ├── widgets/            块渲染器 + 注册表
│   │   ├── core/               layout / scroll / shell / session / timeline
│   │   ├── bridge/             message-bridge（协议入口）/ courseware-submit
│   │   └── boot/               engine-manifest（base）/ loader
│   └── templates/              lesson-runtime 骨架 + debug 调试壳
├── profiles/AIClass_figure/    图展示附加层：figures/ + figure-host + calc/problem-brief + 图模板
│   │                           （JS/CSS 附加层清单：engine-manifest.figure.json + engine-css.figure.json，export 时按 profile 注入）
├── profiles/AIClass_text/      text 差异：config.local.js
├── _output_/{grade}/{courseId}/  作者真源（作者本地，不入库）：plan.json + assets/ + figure-spec.json
├── dist/{grade}/{lesson}/{grade}-{lesson}-{star}star/  编译产物（如 dist/4/1/4-1-3star）
├── tools/                      export.mjs（编译）/ compat-check.mjs（兼容门禁）
└── vendor/                     katex + jsxgraph
```

## 制作一个课件

1. 建目录 `_output_/{grade}/{courseId}/`
2. 写 `plan.json`（主编排，见下）
3. （图形模板）写 `figure-spec.json`
4. 放 `assets/`（图片等）
5. 编译：`node tools/export.mjs [courseId]`
6. 调试：浏览器打开 `dist/{grade}/{lesson}/{grade}-{lesson}-{star}star/courseware/debug.html`

> 注：`_output_`（作者本地真源）与 `dist/`（编译产物）均在 `.gitignore` 中，不入库。

## plan.json 主编排格式

顶层 + `timeline[]`（时间线 = 有序状态列表，每个状态 = 一个 courseware 节点 + 渲染信息）：

```jsonc
{
  "courseId": "ex-1", "title": "…", "grade": 8,
  "profile": "AIClass_figure",            // 或 AIClass_text
  "head": "例",                            // 标题栏题号标签（可空 → 不显示标题栏）
  "difficulty": 3, "difficultyMax": 8,     // 难度星级（difficulty 缺省 → 不渲染星星）
  "layout": { "type": "left-right", "params": {}, "style": {} },
  "figure": "figure-template-id",          // 图形模板（figure profile）
  "outline": [ { "title": "审题" } ],       // 可选大纲
  "problem_source": [ { "flow_id": "flow_1", "stem": "…", "answer_short": "…", "answer_detail": "…", "images": [] } ],
  "timeline": [
    {
      "id": "start", "flow_id": "flow_1", "type": "text",
      "action": ["开始"], "next": "s1", "test": [],
      "text": "口播稿…",
      "figureState": "default",
      "blocks": [
        { "id": "stem", "type": "text", "region": "top", "class": "tx-stem", "replaceKey": "stem", "lines": ["题干…"] },
        { "id": "t1", "type": "text", "region": "right", "lines": ["…"] }
      ],
      "animation": [ { "type": "fade-in", "target": "stem" } ]
    },
    { "id": "s1", "type": "question", "action": ["步骤01"], "next": "s2",
      "test": [{ "when": true, "next": "s2" }, { "when": false, "next": "s2" }],
      "question_type": "practice", "answer_type": "course_choice", "answer": ["A"],
      "blocks": [ { "type": "choice", "region": "right", "options": [], "answer": "A" } ] }
  ]
}
```

**语义**：
- 每个状态是**自包含完成态快照**（`blocks` 描述该状态画面）；也可写成增量块，引擎前进时累积、跳转时按 0..index 重建。
- **顶栏题干**（与旧模板一致）：`region: "top"` + `class: "tx-stem"` 进入 `.course-scroll-top`，与题号/难度同行；StemExpand 限高约 3 行，超出显示「展开/收起」。
- 动画规则：**只有顺序 +1 前进播放动画**；回退 / 跳步瞬间呈现终态。
- 每个 action 对应一个状态；前进 / 回退 / 跳转都是父容器下发同一个 `{action}` 入口。

## postMessage 协议（父容器驱动）

见 `docs/postmessage-protocol.md`。核心：

- **入站**：`{ action }`（驱动/跳转）、`{ type: 'photo_result', value }`（拍照回显，value 支持 Markdown 子集 + `$…$`/`$$…$$`）
- **出站**：`ready`、`step_ok`、`user_submitted`（kind: course_fill/course_choice/course_photo/voice）
- 父容器从 `courseware.json` 读驱动图（节点：action/type/text/next/test/answer）

## 编译 / 校验

```bash
npm install          # postcss / doiuse（兼容门禁）
npm run export       # 编译 _output_ 全部课件 → dist
npm run compat       # 兼容门禁（Chrome ≥51 / iOS ≥13）
```

产物结构（严格 3 项）：
```
dist/{grade}/{lesson}/{grade}-{lesson}-{star}star/   # 例 dist/4/1/4-1-3star
├── courseware/       # 运行时包（plan.json 整体保留 + runtime + assets + debug）
├── index.html        # 入口
└── courseware.json   # 父容器驱动图
```

## 兼容性

运行时浏览器代码遵循 `COMPATIBILITY.md`（基线 Chrome 51 / iOS 13）：禁用 CSS 特性（grid/gap/sticky/:has()/aspect-ratio/clamp 等）、禁用 Web API、脚本**纯 ES5**、rem 单位、热区 ≥44px。CI（PR→main）跑兼容门禁。
