# postMessage 协议

课件由父容器下发 `action` 驱动。每个 `action` 对应时间线一个状态；引擎收到后 `renderState`。推进步骤从发布包 **`courseware.json`** 读取（结构见 [courseware.md](./courseware.md)）。

```
父容器 ── { action: "例-审题", params: {} } ──> 课件渲染
课件   ── { type: "step_ok", action: "例-审题" } ──> 父容器
```

引擎入站的 `action` **必须是字符串**（时间线状态名）。`params` **始终带上**：无参数时为 `{}`。`courseware.json` 里的 `{ name, at }` 只给父容器决定何时下发；`at` 不进 postMessage。

## 入站（父容器 → 课件）

| 消息 | 说明 |
|---|---|
| `{ action: "<状态名>", params }` | 渲染该 action 对应状态。前进 / 回退 / 跳转同一入口。`params` 固定为对象，无参数时 `{}` |
| `{ type: "photo_result", value }` | 拍照结果回显。`value` 为 Markdown 常用子集（`#`/`##`、`$…$` / `$$…$$`、粗体/斜体、无序列表，其余按纯文本） |

```json
{ "action": "例-审题", "params": {} }
```

```json
{ "type": "photo_result", "value": "识别到：$x=3$" }
```

口播读到 `at` 时同样下发，`params` 仍在：

```json
{ "action": "例-审题-高亮1", "params": {} }
```

## 出站（课件 → 父容器）

| 消息 | 说明 |
|---|---|
| `{ type: "ready", status }` | 加载完成。`status` 为 `"ok"` 或 `"error"`；失败时可带 `message` |
| `{ type: "step_ok", action }` | 该步已渲染，`action` 为刚完成的状态名 |
| `{ type: "user_submitted", kind, value? }` | 学生作答。`kind` ∈ `course_choice` / `course_fill` / `voice` / `course_photo`。拍照无 `value` |

```json
{ "type": "ready", "status": "ok" }
```

```json
{ "type": "step_ok", "action": "例-审题" }
```

```json
{ "type": "user_submitted", "kind": "course_choice", "value": "B" }
```

```json
{ "type": "user_submitted", "kind": "course_photo" }
```

父容器收到 `user_submitted` 后按 `courseware.json` 的 `answer` / `test` 判题，再下发 `test` 指向节点的 `action`（该节点 `text` 为空，不口播）。

## 驱动图

父容器读 `courseware.json` 的 `nodes[]`：

- `action[]`：要下发的名字（字符串 = 进入即发；`{name, at}` = 口播读到 `at` 再发 `name`）
- `type`：`text` / `question`
- `text`：口播（空串 = 无）
- `next`：顺序下一节点
- `test[]`：答对 / 答错分支（优先于 `next`）
- `answer_type` / `answer`：判题口径

无需 `help` 消息。

## 传输

- 目标源：`window.__COURSE_BOOT.targetOrigin || '*'`
- 同页钩子：`window.__onCourseMessage(payload)`
- `file://` 时 `targetOrigin` 为 `'null'`，改用 `'*'`
