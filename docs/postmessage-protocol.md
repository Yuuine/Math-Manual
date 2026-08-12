# postMessage / Agent 交互协议（定稿 v2，父容器驱动，Math-Manual）

> 新引擎（时间线 + 状态机），**课件完全由父容器下发 action 驱动**。
> 每个 action 对应时间线一个状态；父容器 `dispatch(action)` → 引擎 `renderState(该状态)`。

## 驱动模型

```
父容器 ──postMessage──> {action:'s1'}          ① 下发 action（= 时间线状态名）
                        ──> renderState(s1)     ② 渲染该状态（跳转/回退/前进同一入口）
                        <── {type:'step_ok'}    ③ 渲染完成确认（待定，见下）
父容器 ──postMessage──> {action:'s2'}          ④ 下发下一步 action
```

## 协议类型清单（全部）

### 入站（父容器 → 课件）

| 类型 | 字段 | 说明 | 状态 |
|---|---|---|---|
| action 分发 | `{action:<状态action>, params?}` | **核心驱动**：导航到该 action 对应状态并渲染。前进/回退/跳转同一入口 | **保留（核心）** |
| `photo_result` | `{type:'photo_result', value}` | 拍照结果回显；`value` 支持 **Markdown 常用子集**（标题 `#`/`##`、`$...$` 行内公式、`$$...$$` 块公式、粗体/斜体、无序列表，其余按纯文本），安全渲染 + 本地 KaTeX | **冻结**（消息/字段不变；渲染能力升级为 Markdown 子集，新确认） |
| `course:reset` | `{action:'course:reset'}` | 重置到初始状态 | 移除（99% 顺序推进，无需显式重置） |

### 出站（课件 → 父容器）

| 类型 | 字段 | 说明 | 状态 |
|---|---|---|---|
| `ready` | `{type:'ready'}` | 课件加载就绪，父容器可开始下发 | **保留（必要）** |
| `user_submitted` | `{type, kind, value}` | 作答提交 / 拍照通知（kind ∈ course_fill/course_choice/course_photo/voice） | **冻结** |
| `step_ok` | `{type:'step_ok', action?, state?}` | 每步渲染完成确认，供父容器串步（**精简版**，无 session/nextAction/scrollIndex） | **保留** |
| `user_submitted`（拍照） | `{type:'user_submitted', kind:'course_photo'}` | 调用拍照通知（无 value） | **冻结** |

### 移除（确认不再需要）

| 类型 | 方向 | 理由 |
|---|---|---|
| `side_effect_ok` / `step_replay` / `scroll_ok` | 上行 | 时间线取代模块/side-effect/滚动定位 |
| `scheduler_paused` / `scheduler_resumed` | 上行 | 父容器控制节奏，无需协议 |
| `module_switched` | 上行 | 时间线取代 module |
| `scheduler_error` | 上行 | 新引擎自渲染、无外部校验错误；错误内部化 |
| `help` | 上行 | 父容器从发布包 `courseware.json` 读全部推进步骤（已定） |
| `course_reset` | 上行 | 移除（已定：99% 顺序推进，无需显式重置） |
| `concept_sheet_*` / `quick_qa_*` / `answer_result_shown` | 上行 | 功能内部化/无需回执 |
| `<step action>` 旧校验分发 | 下行 | 已由「action 分发（无校验）」取代 |
| `_pause`/`_resume`/`_scrollTo`/`_switchModule`/`_getScrollIndex` | 下行 | 内部化/状态跳转替代 |

## 父容器如何知道 action 列表（已定）

- 父容器从发布包的 **`courseware.json`** 读取全部推进步骤（沿用旧引擎机制）：
  - 每个 `node` 含 `action`（父容器要下发的 action 名）、`type`（text/question）、`next`（顺序推进）、`test[]`（答对/答错分支）、`answer_type`/`answer`（判题）。
  - 父容器按此图逐个下发 `action`，无需 `help` 消息。
- **新设计问题**：master `plan.json` 与父容器 `courseware.json` 的关系（谁派生谁），待确认——见待定 3。

## 传输层（保留）

- 目标源：`window.__COURSE_BOOT.targetOrigin || '*'`
- 同页透传钩子：`window.__onCourseMessage(payload)`
- `file://` 补丁：`targetOrigin='null'`→`'*'`

## 待定（需你拍板）

1. **`step_ok`**：**保留**精简版 `{type:'step_ok'}`（已定——父容器串步确认，无进度字段）
2. **`course:reset`**：**移除**（已定）
3. **`plan.json` 与 `courseware.json` 的关系**（新设计核心问题，见下）
