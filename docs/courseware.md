# courseware.json —— 父容器驱动图：结构示例

**驱动模型**：父容器下发 `{action}` 驱动，引擎只按收到的 action 渲染对应状态
（协议见 [postmessage-protocol.md](./postmessage-protocol.md)）。

**运行时语义**：进入节点 → 依次下发 `action[]` → 口播 `text` →（question）判题 → 按 `test`/`next` 跳转。`test` 的 true/false 指向节点不口播（`text` 为空）。

## 顶层字段

| 字段 | 说明 |
|---|---|
| `id` | 课件标识（例 `4-1-2star`） |
| `title` | 课件标题 |
| `child_title` | 固定三条 flow：学习例题 / 快速复习 / 自己练习，父容器据此分组 |
| `problem_source` | 每题一条原题留档；`images` 为 `[{url, description}]`。原题 markdown 与图片在 `problem/` |
| `nodes` | 链表式驱动图（主链三段 flow 连续），父容器逐个下发 action |
| `globals` | 固定空 |

## node 字段

- **通用**：`id` · `flow_id` · `type`(text/question) · `text`(口播，空串=无) · `action[]` · `next` · `test[]`
- **question 额外**：`question_type`(practice/…) · `answer_type`(voice/course_choice/course_fill/course_photo) · `answer[]`(判题口径)
- **`test`**：`[{when:true/false, next}]`，`true`=答对 / `false`=答错，命中优先于 `next`。口答、选择、填空、拍照等互动的 **true/false 指向节点 `text` 必须为空**（揭晓/下一拍不口播）
- **`next`**：顺序推进的下一节点；末节点为 `null`

## action[] 的两种写法

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

- `name` —— 要下发的 action（整体流程的下一个 action，制作时按流程线性排列）
- `at` —— 口播触发点（父容器指令）：口播读到该子串时下发 `{ "action": "例-审题", "params": {} }`

## 原题留档（problem/）

只放原题 markdown 和题干用到的图片（不写 `problems.json`）。`courseware.json` 的 `images` 与原项目一致：`{ url, description }`。

```
problem/
├── 1-3star.md      # 原题 markdown（`![](文件名.png)` 与 url 一致）
└── 题1.png         # 用到的图片
```

```json
"images": [
  { "url": "题1.png", "description": "……图意（面向看不到图的模型）" }
]
```

- **`url`**：与正文 `![](文件名.png)` 完全一致的文件名（无路径）；无图写 `[]`
- **`description`**：该图的文字描述；同图在题干/解析重复出现时 `images` 只登记一条
- 图片实体按 `url` 放在 `problem/`

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
      "action": ["例-审题"],
      "next": "n1-sync",
      "test": []
    },
    {
      "id": "n1-sync",
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
      "next": "n1-hl2",
      "test": []
    },
    {
      "id": "n1-hl2",
      "flow_id": "flow_1",
      "type": "text",
      "text": "",
      "action": ["例-审题-高亮2"],
      "next": "n2",
      "test": []
    },
    {
      "id": "n2",
      "flow_id": "flow_1",
      "type": "text",
      "text": "八位数有八个数位。要最大，每一位都填最大的数字 9。",
      "action": ["例-最大八位数"],
      "next": "n2-nines",
      "test": []
    },
    {
      "id": "n2-nines",
      "flow_id": "flow_1",
      "type": "text",
      "text": "",
      "action": ["例-出现八个9"],
      "next": "n2-merge",
      "test": []
    },
    {
      "id": "n2-merge",
      "flow_id": "flow_1",
      "type": "text",
      "text": "",
      "action": ["例-写成99999999"],
      "next": "n3",
      "test": []
    },
    {
      "id": "n3",
      "flow_id": "flow_1",
      "type": "question",
      "text": "1 个一百万是 1000000。100 个一百万是多少？",
      "action": ["例-口答一百万"],
      "next": "n3-reveal",
      "test": [
        { "when": true, "next": "n3-reveal" },
        { "when": false, "next": "n3-reveal" }
      ],
      "question_type": "practice",
      "answer_type": "voice",
      "answer": ["1亿", "一亿", "100000000", "1 亿"]
    },
    {
      "id": "n3-reveal",
      "flow_id": "flow_1",
      "type": "text",
      "text": "",
      "action": ["例-口答一百万-揭晓"],
      "next": "n3-eq",
      "test": []
    },
    {
      "id": "n3-eq",
      "flow_id": "flow_1",
      "type": "text",
      "text": "1 个一百万是 1000000，100 个一百万就是 100 × 1000000 = 100000000，也就是 1 亿。",
      "action": ["例-一百万算式"],
      "next": "n3-eq2",
      "test": []
    },
    {
      "id": "n3-eq2",
      "flow_id": "flow_1",
      "type": "text",
      "text": "",
      "action": ["例-一百万算式2"],
      "next": "n3-eq3",
      "test": []
    },
    {
      "id": "n3-eq3",
      "flow_id": "flow_1",
      "type": "text",
      "text": "",
      "action": ["例-标注1亿"],
      "next": "n4",
      "test": []
    },
    {
      "id": "n4",
      "flow_id": "flow_1",
      "type": "text",
      "text": "现在一边是 99999999，一边是 100000000。一个是 8 位数，一个是 9 位数。正整数位数不同时，位数多的更大。",
      "action": ["例-比较位数"],
      "next": "n4-row2",
      "test": []
    },
    {
      "id": "n4-row2",
      "flow_id": "flow_1",
      "type": "text",
      "text": "",
      "action": ["例-比较位数-行2"],
      "next": "n4-hl",
      "test": []
    },
    {
      "id": "n4-hl",
      "flow_id": "flow_1",
      "type": "text",
      "text": "",
      "action": ["例-高亮9位数"],
      "next": "n4-q",
      "test": []
    },
    {
      "id": "n4-q",
      "flow_id": "flow_1",
      "type": "question",
      "text": "两个正整数的位数不同时，哪个更大？",
      "action": ["例-位数选择"],
      "next": "n4-q-reveal",
      "test": [
        { "when": true, "next": "n4-q-reveal" },
        { "when": false, "next": "n4-q-reveal" }
      ],
      "question_type": "practice",
      "answer_type": "course_choice",
      "answer": ["A"]
    },
    {
      "id": "n4-q-reveal",
      "flow_id": "flow_1",
      "type": "text",
      "text": "",
      "action": ["例-位数选择-揭晓"],
      "next": "n5",
      "test": []
    },
    {
      "id": "n5",
      "flow_id": "flow_1",
      "type": "text",
      "text": "100000000 是 9 位数，99999999 是 8 位数，所以 99999999 小于 100000000。最大的八位数小于 100 个一百万，○里填小于号。",
      "action": ["例-结论"],
      "next": "n5-stem",
      "test": []
    },
    {
      "id": "n5-stem",
      "flow_id": "flow_1",
      "type": "text",
      "text": "",
      "action": ["例-填入小于号"],
      "next": "n5-end",
      "test": []
    },
    {
      "id": "n5-end",
      "flow_id": "flow_1",
      "type": "text",
      "text": "",
      "action": ["例-结论句"],
      "next": null,
      "test": []
    }
  ],
  "globals": []
}
```

## 关联

- 协议与消息字段：[postmessage-protocol.md](./postmessage-protocol.md)
