# courseware.json —— 父容器驱动图：完整字段说明

**驱动模型**：父容器下发 `{action}` 驱动，引擎只按收到的 action 渲染对应状态
（协议见 [postmessage-protocol.md](./postmessage-protocol.md)）。

**运行时语义**：进入节点 → 依次下发 `action[]` → 口播 `text` →（question）判题 → 按 `test`/`next` 跳转。`test` 的 true/false 指向节点不口播（`text` 为空）。

## 顶层字段

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | string | 课件标识（例 `4-1-2star`） |
| `title` | string | 课件标题 |
| `child_title` | array | 固定三条 flow：`学习例题的解题思路`(flow_1) / `快速复习例题的解题思路`(flow_2) / `自己来做做练习题`(flow_3) |
| `problem_source` | array | 原题留档，一题一条（见 [problem_source](#problem_source原题留档)） |
| `nodes` | array | 链表式驱动图（见 [node 字段](#node-字段)） |
| `globals` | array | 固定空 `[]` |

### flow 划分（三条 flow 的聚合语义）

| `flow_id` | 聚合内容 |
|---|---|
| `flow_1` | 例题讲解（example 的完整讲解步骤，多题按顺序串联） |
| `flow_2` | 快问快答（example 的 quickQA，展开规则见 [快问快答](#快问快答flow_2展开)） |
| `flow_3` | 练习（practice 的拍照 + 讲解，展开规则见 [练习](#练习flow_3展开)） |

**主链路连续**：三条 flow 构成一条连续主链——flow_1 末节点 `next` 指向 flow_2 首节点；flow_2 末节点 `next` 指向 flow_3 首节点；flow_3 末节点 `next: null` 结束。所有节点必须带 `flow_id`，归属以上三者之一。

## node 字段

### 通用字段（text 与 question 节点共有）

| 字段 | 类型 | 必需 | 说明 |
|---|---|---|---|
| `id` | string | 是 | 唯一标识，小写字母/数字/连字符（例 `ex-1`、`qa-1-q`、`pr-photo`）；不得重复 |
| `flow_id` | string | 是 | `flow_1` / `flow_2` / `flow_3`（缺省 `flow_1`） |
| `type` | string | 是 | `text`（纯展示/口播）或 `question`（需作答，有交互） |
| `text` | string | 是 | 口播正文；空字符串 `""` = 无口播。**被 `test` 指向的节点 `text` 必须为空**（揭晓/下一拍不口播） |
| `action` | array | 是 | 派发给课件调度器的动作数组；无动作时 `[]`（写法见 [action[] 的两种写法](#action-的两种写法)） |
| `next` | string\|null | 是 | 默认下一节点 id；**仅主链最后节点**（flow_3 末）为 `null`，其余必须指向存在的节点 |
| `test` | array | 是 | 条件分支数组；无条件分支则 `[]`（text 节点恒 `[]`）。元素 `{ when: true\|false, next }`，`next` 不得为 `null` |

### question 节点额外字段

| 字段 | 类型 | 必需 | 说明 |
|---|---|---|---|
| `question_type` | string | 是 | `practice` / `practice_quick` / `practice_main`（见下） |
| `answer_type` | string | 是 | `voice` / `course_choice` / `course_fill` / `course_photo`（见下） |
| `answer` | array | 是 | 判题口径数组（语义见 [answer 数组语义](#answer-数组语义)） |

### 运行时语义

```
进入 id → 依次执行全部 action → 口播 text →（question 节点）判题 → 按 test / next 跳转
```

- `text` 为空字符串：跳过口播步骤。
- `type=text` 节点：无判题，口播结束后直接按 `next` 推进（`test` 恒 `[]`）。
- `type=question` 节点：口播后等待学生作答，课件上报 `user_submitted`，父容器按 `answer` 判题，再按 `test`（命中优先）或 `next` 跳转。
- **不设 retry**：`test` 的 true/false 分支都往下走，分支指向由 plan 设计（练习问步可 true/false 同指揭晓节点）。

### question_type（3 种）

| 值 | 语义 | 来源 |
|---|---|---|
| `practice` | 讲解过程中的小题（口答/选择/填空） | example / practice 讲解 steps 中的互动问步 |
| `practice_quick` | 快问快答 | flow_2 的 quickQA 问节点 |
| `practice_main` | 练习自主作答（整题作答，拍照） | flow_3 开头的拍照节点 |

### answer_type（4 种）

| 值 | 作答形式 | 上报 `user_submitted.kind` |
|---|---|---|
| `voice` | 口答（语音识别） | `voice` |
| `course_choice` | 选择 | `course_choice` |
| `course_fill` | 填空 | `course_fill` |
| `course_photo` | 拍照 / 手写 | `course_photo` |

### 合法组合

| question_type | 允许的 answer_type |
|---|---|
| `practice` | `voice` / `course_choice` / `course_fill` / `course_photo` |
| `practice_quick` | `course_fill`（口答可预留 `voice`） |
| `practice_main` | `course_photo` |

### answer 数组语义

`answer` 是**判题口径数组**，父容器据此判题（任一命中即判对）：

| answer_type | answer 数组元素 | 示例 |
|---|---|---|
| `voice` | 可接受的口答口径（语义相近均可） | `["相等", "一样长"]` |
| `course_choice` | 正确选项的**值**（非文案） | `["B"]` |
| `course_fill` | **可接受口径列表，任一命中即对**（多空题的每空一组写法，后续扩展约定） | `["十六分之三", "3/16"]` |
| `course_photo` | 判题口径；拍照节点通常为空数组 `[]` | `[]` |

## action 的两种写法

### ① 字符串 —— 进入节点即下发

```json
"action": ["例-审题"]
```

### ② 扩展对象 —— 随口播触发

```json
"action": [
  { "name": "例-审题", "at": "比较" },
  { "name": "出现图形", "at": "具体" }
]
```

- `name` —— 要下发的 action（时间线状态名，整体流程线性排列）
- `at` —— 口播触发点（父容器指令）：口播读到该子串时下发 `{ "action": "例-审题", "params": {} }`；`at` 应出现在同一节点 `text` 的口播中

## 快问快答（flow_2）展开

每条 quickQA 展开为：`open` 节点 → 问节点 → 揭晓节点 →（多条重复）→ `close` 节点：

```
open 节点（text 节点，text 可为空串）        action=[{前缀}_快问快答_打开]
  ├─ 问节点（question 节点）                 question_type=practice_quick, answer_type=course_fill
  │      text=口播问题, action=[{前缀}_快问快答{序号}_显示问题], answer=口径列表
  │      test: true/false → 揭晓节点
  ├─ 揭晓节点（text 节点，text=""）           action=[{前缀}_快问快答{序号}_显示答案]
  ├─（下一条 quickQA 重复「问 → 揭晓」…）
close 节点（text 节点，text=""）              action=[快问快答_关闭]
```

- action 名按 runtime 约定：打开 `{前缀}_快问快答_打开`、显示问题 `{前缀}_快问快答{序号}_显示问题`（第二题起序号延续）、显示答案同规律、关闭固定 `快问快答_关闭`。
- 问节点必须是 `question` 节点（有判题）；揭晓节点是 `text` 节点（`text=""`，只执行 `显示答案` action）。

## 练习（flow_3）展开

```
practice_main 拍照节点（question 节点）   question_type=practice_main, answer_type=course_photo
      text=口播（可空）, action=[练习-作答-拍照], answer=[]（判题口径通常留空）
      next → 讲解第一步
  └─ 讲解流程：该 practice plan 的 steps 按顺序转换为 text / question 节点
```

- 拍照节点是 flow_3 内每个练习的开头节点；题干由拍照节点自身展示，不另设题干节点。
- 多道练习时按 plan 顺序逐题展开（每题一个拍照节点 + 各自的讲解流程）。

## problem_source（原题留档）

一题一条；`flow_id` 与讲解位置对应：例题讲解 → `flow_1`，练习 → `flow_3`（快问快答不另登记，例题只登记一条）。数组顺序 = flow 顺序。

```json
"problem_source": [
  {
    "flow_id": "flow_1",
    "stem": "在○里填上 “>” “<” 或 “=”。最大的八位数○100个一百万",
    "answer_short": "<",
    "answer_detail": "最大的八位数是 99999999（8 位），100 个一百万是 100000000（9 位，也就是 1 亿）。正整数位数多的更大，所以 99999999 < 100000000，最大的八位数 < 100个一百万。",
    "images": []
  }
]
```

| 字段 | 类型 | 必需 | 说明 |
|---|---|---|---|
| `flow_id` | string | 是 | 该题被讲解的 flow（例→`flow_1`，练→`flow_3`） |
| `stem` | string | 是 | 原题题干，逐字保真（含 `$…$` 与图片占位符） |
| `answer_short` | string | 是 | 原题答案 |
| `answer_detail` | string | 是 | 原题解析，逐字保真；多段用 `\n` 连接 |
| `images` | array | 是 | 该题正文引用到的全部图片，元素为 `{ url, description }`；无图写 `[]` |

### images 规则

- **`url`**：与正文 `![](文件名.png)` 完全一致的文件名（无路径）；同图重复出现时 `images` 只登记一条
- **`description`**：该图的文字描述，**必写**——面向看不到图的大模型（图形整体、点的位置与顺序、线的画法、图上标记与文字、区域划分；不写解题步骤或答案）

## 完整示例

```json
{
  "id": "4-1-2star",
  "title": "最大的八位数与100个一百万",
  "child_title": [
    { "title": "学习例题的解题思路", "flow_id": "flow_1" },
    { "title": "快速复习例题的解题思路", "flow_id": "flow_2" },
    { "title": "自己来做做练习题", "flow_id": "flow_3" }
  ],
  "problem_source": [
    {
      "flow_id": "flow_1",
      "stem": "在○里填上 “>” “<” 或 “=”。最大的八位数○100个一百万",
      "answer_short": "<",
      "answer_detail": "最大的八位数是 99999999（8 位），100 个一百万是 100000000（9 位，也就是 1 亿）。正整数位数多的更大，所以 99999999 < 100000000，最大的八位数 < 100个一百万。",
      "images": []
    }
  ],
  "nodes": [
    {
      "id": "n1",
      "flow_id": "flow_1",
      "type": "text",
      "text": "两边还不是具体的数。比较之前，先把两边都表示成具体的数。",
      "action": [
        { "name": "例-审题", "at": "比较" },
        { "name": "出现图形", "at": "具体" }
      ],
      "next": "n1-hl1",
      "test": []
    },
    {
      "id": "n1-hl1",
      "flow_id": "flow_1",
      "type": "text",
      "text": "",
      "action": ["例-审题-高亮1"],
      "next": "n2",
      "test": []
    },
    {
      "id": "n2",
      "flow_id": "flow_1",
      "type": "question",
      "text": "两个正整数的位数不同时，哪个更大？",
      "action": ["例-位数选择"],
      "next": "n2-reveal",
      "test": [
        { "when": true, "next": "n2-reveal" },
        { "when": false, "next": "n2-reveal" }
      ],
      "question_type": "practice",
      "answer_type": "course_choice",
      "answer": ["A"]
    },
    {
      "id": "n2-reveal",
      "flow_id": "flow_1",
      "type": "text",
      "text": "",
      "action": ["例-位数选择-揭晓"],
      "next": "qa-open",
      "test": []
    },
    {
      "id": "qa-open",
      "flow_id": "flow_2",
      "type": "text",
      "text": "",
      "action": ["例_快问快答_打开"],
      "next": "qa-1-q",
      "test": []
    },
    {
      "id": "qa-1-q",
      "flow_id": "flow_2",
      "type": "question",
      "text": "位数相同比大小，从哪一位开始比？",
      "action": ["例_快问快答_显示问题"],
      "next": "qa-1-a",
      "test": [
        { "when": true, "next": "qa-1-a" },
        { "when": false, "next": "qa-1-a" }
      ],
      "question_type": "practice_quick",
      "answer_type": "course_fill",
      "answer": ["最高位"]
    },
    {
      "id": "qa-1-a",
      "flow_id": "flow_2",
      "type": "text",
      "text": "",
      "action": ["例_快问快答_显示答案"],
      "next": "qa-close",
      "test": []
    },
    {
      "id": "qa-close",
      "flow_id": "flow_2",
      "type": "text",
      "text": "",
      "action": ["快问快答_关闭"],
      "next": "pr-photo",
      "test": []
    },
    {
      "id": "pr-photo",
      "flow_id": "flow_3",
      "type": "question",
      "text": "",
      "action": ["练习-作答-拍照"],
      "next": "pr-1",
      "test": [],
      "question_type": "practice_main",
      "answer_type": "course_photo",
      "answer": []
    },
    {
      "id": "pr-1",
      "flow_id": "flow_3",
      "type": "text",
      "text": "看第一个条件，把单位“1”找出来。",
      "action": ["练-审题"],
      "next": null,
      "test": []
    }
  ],
  "globals": []
}
```

## 关联

- 协议与消息字段：[postmessage-protocol.md](./postmessage-protocol.md)
