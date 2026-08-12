# 现有交互/内容字段设计（全量，供审阅决策）

> 从 `G:\A-tem\templates` 运行时、生成模块、widget 枚举出的完整字段。**这是"现状"**，供你决定哪些要变。

## L0 运行配置

| 字段 | 位置 | 说明 |
|---|---|---|
| `__COURSE_BOOT.srcRoot/lessonRoot` | 页面全局 | 引擎/课程脚本相对根 |
| `__COURSE_BOOT.targetOrigin` | 页面全局 | postMessage 目标源（默认 `*`） |
| `__onCourseMessage(payload)` | 页面全局钩子 | 非 iframe 透传 |

## L1 课程元数据（course.json）

`courseId` `grade` `title` `version` `profile`(figure/text/calculation)
`engine.range` `engine.requiredCapabilities[]`(file-runtime/post-message/text-only/left-right/latex/choice/fill/replace-key/figure-state/stem-choice…)
`authoring.rootKey` `authoring.problems[{problemId,order,actionPrefix,planPath}]`
`authoredModules[]` `extensions[]`

## L2 内容/编排（plan.json → output.json）

`schemaVersion` `problemId` `title` `moduleType` `difficulty` `layout` `quickQALayout` `figureTemplate`
`problemBrief{known[], ask, key}`
`guidanceChain[{title, desc}]`
`quickQA[{id, question, promptText, answer, correctText, wrongText}]`

**step**：`stepId` `action` `phase` `group` `agent{type, description}`
`figure{state, note, actions[{op,targets}], animate}`
`push[]`（内容块，见 L5）

## L3 运行时模块（generated）

**module**：`id` `title` `sideEffects[]` `containers[]`
**sideEffect**：`id` `action` `kind`(example/practice…) `containerIdx` `group` `description` `problemBrief{known,ask,key}` `figure{…}` `push[]`
**container**：`id` `label` `head` `difficulty` `difficultyMax` `layout` `figure`(模板名)
`problemBrief{known[],ask,key}` `guidanceChain[{title}]` `guidanceLayout`(stacked/interleaved) `quickQALayout` `textAccumulate`
`steps[]`
**container.step**：`id` `action` `kind` `phase` `group` `figure{…}` `push[]`

## L4 布局/外观

**layout 类型**：`text-only` `figure-text` `text-over-figure` `top-split` `left-right`
**layoutParams**：`edgePad` `scrollPadding` `gap` `textMaxWidth` `textAlign` `figureWidth` `figureMaxWidth` `figureSvgWidth` `figureHeight` `splitLeftWidth` `splitMinHeight`
**style**：`fontFamily` `bodySize` `titleSize` `sectionSize` `lineHeight` `ink` `muted`

## L5 内容块字段（push[]，按 type）

**通用**：`type` `id` `region`(top/main/left/right) `class` `replaceKey`（+引擎注入 `__stepId` `__stepIndex` `__isCurrentStep` `__localIndex`）
| type | 字段 |
|---|---|
| `text` | `lines[]` `align` `size`(large) |
| `section` | `title` `color` |
| `choice` | `id` `badge` `prompt/question` `options[{label,value}]` `answer` `value` `multiple` `required` `variant`(paper) `actions[]` `submitText` `resetText` `requiredText` `revealed` `onSubmit` |
| `stem-choice` | `stemImage` `options[]` |
| `chain` | `nodes[]` `reverse` `prompt` |
| `oral` | `id` `badge` `question` `text` `answer` `lead` `action` `attachStepId` |
| `fill` | `id` `value` `parts[]` `required` `card` `class` `submitText` `animateValue` |
| `solve-step` | `title` `lines[]` `highlightAnswer` |
| `intro-gallery` | `title` `lines[]` `items[]` |
| `read-list` | `kind` `items[]` |
| `latex` | 公式内容 |

## L6 图形/动画

`figure{state, note, actions[{op,targets}], animate}`
`op`：`show` `highlight` 等（figure 动作）
入场动画：`.lf-enter`（块级，按 `__localIndex` 级联 delay）

## L7 提交/判题

| 交互 | 上报 kind | value 格式 |
|---|---|---|
| choice（单选/多选） | `course_choice` | 所选选项值；多选用 `；` 连接 |
| fill / matching | `course_fill` | 文本；多项 `；`；matching `值｜id` |
| oral（口答） | `voice` | 文本 |
| 拍照作答 | `course_photo` | — |
`onSubmit`：handler 名（如 `reportSingleChoice`），经 `handlers.js` 分发

## L8 postMessage 协议

见 [postmessage-protocol.md](./postmessage-protocol.md)（入站 action / 出站消息全量字段）。

## L9 courseware.json（父容器驱动图 + Agent 原题留档）

> 新结构（skills `make/courseware.md` 设计）：顶层多一个 `problem_source` 节点。父容器据此逐个下发 action 驱动课件。

**顶层**：`id` `title` `child_title`（固定三条 flow：学习例题解题思路/快速复习/自己来做练习题）`problem_source`（★新增）`nodes` `globals`（固定空）

**node**（链表式，主链三段 flow 连续）：
- 通用：`id` `flow_id` `type`(text/question) `text`(口播，空串=无) `action[]`(下发的 action 名) `next`(默认下一节点) `test[]`(条件分支)
- question 额外：`question_type`(practice/practice_quick/practice_main) `answer_type`(voice/course_choice/course_fill/course_photo) `answer[]`(判题口径)
- `test`: `[{when:true/false, next}]`，true=答对/false=答错，命中优先于 next；不设 retry

**problem_source**（★新增，每题一条）：`flow_id` `stem`(原题题干逐字保真) `answer_short` `answer_detail` `images[{url,description}]`（description 面向看不见图的大模型）

**运行时语义**：进入节点 → 依次执行全部 action → 口播 text →（question）判题 → 按 test/next 跳转

