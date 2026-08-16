#!/usr/bin/env node
// courseware.json 校验：结构完整性（硬规则，fail）+ 设计规范（软规则，warn）。
// 用法：node tools/courseware-check.mjs [path...]
//   - 无参数：递归扫描 dist/ 下全部 courseware.json
//   - path 为文件：校验该文件；为目录：递归扫描其中的 courseware.json
// 硬规则违规 → 打印并以 exit 1 退出；软规则仅打印 warn。
// 也供 tools/export.mjs 导入（checkCoursewareFile）在导出后即时校验。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')

export const HARD_RULES = [
  'H1 节点 id 非空且唯一',
  'H2 next/test[].next 引用必须存在',
  'H3 test 分支 next 不能为 null',
  'H4 child_title 恰为三条 flow（flow_1/flow_2/flow_3）',
  'H5 主链末节点 next 必须为 null 且主链无环',
  'H6 question 节点必须有 question_type/answer_type/answer[]',
  'H7 question_type/answer_type 枚举与组合合法',
  'H8 action 元素格式合法（非空字符串 或 {name, at} 非空）',
  'H9 text 节点 test 必须为空数组',
  'H10 test 指向节点 text 必须为空（揭晓/下一拍不口播）',
  'H11 problem_source[].flow_id 必须出现在节点 flow_id 中'
]

export const SOFT_RULES = [
  'S1 主链 flow 顺序应为 flow_1 → flow_2 → flow_3',
  'S2 三条 flow 均应有节点',
  'S3 不应存在链上不可达节点',
  'S4 快问快答应使用 question 节点形态（practice_quick）',
  'S6 problem_source.images[].description 应为非空文字描述',
  'S8 拍照节点（course_photo）应位于主链上'
]

const FLOW_IDS = ['flow_1', 'flow_2', 'flow_3']
const QUESTION_TYPES = ['practice', 'practice_quick', 'practice_main']
const ANSWER_TYPES = ['voice', 'course_choice', 'course_fill', 'course_photo']
const QA_ACTION = /快问快答/

/** 校验单个 courseware 对象，返回违规列表 [{ level, rule, node, message }] */
export function checkCourseware(cw, opts) {
  opts = opts || {}
  const file = opts.file || ''
  const violations = []
  const fail = (rule, message, node) => violations.push({ level: 'hard', rule, node, message, file })
  const warn = (rule, message, node) => violations.push({ level: 'soft', rule, node, message, file })

  const nodes = Array.isArray(cw.nodes) ? cw.nodes : []
  const byId = new Map()

  // ---- H1: id 非空且唯一 ----
  for (const node of nodes) {
    if (!node || typeof node !== 'object') {
      fail('H1', '节点不是对象', String(node))
      continue
    }
    if (typeof node.id !== 'string' || !node.id) {
      fail('H1', '节点缺少非空 id', node.id)
    } else if (byId.has(node.id)) {
      fail('H1', `节点 id 重复: ${node.id}`, node.id)
    } else {
      byId.set(node.id, node)
    }
  }

  // ---- 引用收集 ----
  const refs = [] // [fromId, target, kind]
  for (const node of nodes) {
    if (node.next != null) refs.push([node.id, node.next, 'next'])
    for (const branch of node.test || []) {
      if (branch && branch.next == null) {
        fail('H3', `${node.id} 的 test 分支 next 不能为 null（不设 retry）`, node.id)
      } else if (branch) {
        refs.push([node.id, branch.next, 'test'])
      }
    }
  }
  // ---- H2: 引用存在 ----
  for (const [from, target, kind] of refs) {
    if (!byId.has(target)) fail('H2', `${from} 的 ${kind} 引用了不存在的节点 ${target}`, from)
  }

  // ---- H4: child_title 恰三条 flow ----
  const flowIds = (Array.isArray(cw.child_title) ? cw.child_title : []).map((x) => x && x.flow_id)
  const flowSet = [...new Set(flowIds)].filter(Boolean).sort()
  if (flowSet.length !== 3 || flowSet.join(',') !== FLOW_IDS.join(',')) {
    fail('H4', `child_title 必须恰含三条 flow（flow_1/flow_2/flow_3），实际 ${JSON.stringify(flowIds)}`)
  }

  // ---- 主链：从 nodes[0] 沿 next 遍历 ----
  const chain = []
  const seen = new Set()
  let cur = nodes.length ? nodes[0].id : null
  while (cur && !seen.has(cur)) {
    const node = byId.get(cur)
    if (!node) break
    seen.add(cur)
    chain.push(cur)
    cur = node.next
  }
  if (cur) {
    fail('H5', `主链成环（回到 ${cur}）`)
  } else if (nodes.length) {
    const tail = byId.get(chain[chain.length - 1])
    if (!tail || tail.next !== null) {
      fail('H5', `主链末节点 ${tail && tail.id} 的 next 应为 null（仅主链最后节点为 null）`, tail && tail.id)
    }
  }

  const chainSet = new Set(chain)
  const flowNodes = FLOW_IDS.map((fid) => nodes.filter((n) => n.flow_id === fid))

  // ---- H7 枚举与组合 / H6 question 字段 / H9 / H10 / S4 / S8 ----
  const testTargets = new Set()
  for (const node of nodes) {
    for (const t of node.test || []) if (t && t.next != null) testTargets.add(t.next)
  }
  for (const node of nodes) {
    const acts = (node.action || []).map((a) => (typeof a === 'object' && a ? a.name : a)).filter(Boolean)

    // H8: action 元素格式
    for (const a of node.action || []) {
      if (typeof a === 'string') {
        if (!a) fail('H8', `${node.id} 的 action 含空字符串`, node.id)
      } else if (a && typeof a === 'object') {
        if (typeof a.name !== 'string' || !a.name || typeof a.at !== 'string' || !a.at) {
          fail('H8', `${node.id} 的 action 对象必须含非空 name 与 at`, node.id)
        }
      } else {
        fail('H8', `${node.id} 的 action 元素必须是字符串或 {name, at} 对象`, node.id)
      }
    }

    // H9: text 节点 test 恒 []
    if (node.type !== 'question' && Array.isArray(node.test) && node.test.length) {
      fail('H9', `${node.id} 是 text 节点，test 应为 []`, node.id)
    }

    if (node.type === 'question') {
      // H6: question 三字段
      if (!node.question_type) fail('H6', `${node.id} 缺 question_type`, node.id)
      if (!node.answer_type) fail('H6', `${node.id} 缺 answer_type`, node.id)
      if (!Array.isArray(node.answer)) fail('H6', `${node.id} 缺 answer[]`, node.id)
      // H7: 枚举
      if (node.question_type && !QUESTION_TYPES.includes(node.question_type)) {
        fail('H7', `${node.id} 的 question_type 非法: ${node.question_type}`, node.id)
      }
      if (node.answer_type && !ANSWER_TYPES.includes(node.answer_type)) {
        fail('H7', `${node.id} 的 answer_type 非法: ${node.answer_type}`, node.id)
      }
      // H7: 组合
      if (node.question_type === 'practice_main' && node.answer_type !== 'course_photo') {
        fail('H7', `${node.id} 的 practice_main 必须配 answer_type=course_photo，实际 ${node.answer_type}`, node.id)
      }
      if (node.question_type === 'practice_quick' && node.answer_type !== 'course_fill' && node.answer_type !== 'voice') {
        fail('H7', `${node.id} 的 practice_quick 应配 answer_type=course_fill（或 voice），实际 ${node.answer_type}`, node.id)
      }
    }

    // H10: test 指向节点 text 必须为空
    if (testTargets.has(node.id) && node.text) {
      fail('H10', `${node.id} 被 test 指向，text 必须为空（揭晓/下一拍不口播）`, node.id)
    }

    // S4: 快问快答的「问步」应为 question 节点形态（打开/关闭/揭晓节点是 text 属正常）
    if (node.type !== 'question' && acts.some((a) => QA_ACTION.test(a) && /问题|显示问题/.test(a))) {
      warn('S4', `${node.id} 的快问快答问步是 text 节点（action=[${acts.join('|')}]），建议 question 节点 + question_type=practice_quick`, node.id)
    }

    // S8: 拍照节点必须在主链上
    if (node.answer_type === 'course_photo' && !chainSet.has(node.id)) {
      warn('S8', `${node.id} 是拍照节点（course_photo）但不在主链上`, node.id)
    }
  }

  // ---- S3: 链上不可达 ----
  for (const node of nodes) {
    if (!chainSet.has(node.id)) warn('S3', `${node.id} 不在主链上（链上不可达）`, node.id)
  }

  // ---- S1: 主链 flow 顺序 ----
  if (chain.length) {
    const seq = []
    let lastFlow = null
    for (const id of chain) {
      const f = byId.get(id).flow_id
      if (f !== lastFlow) {
        seq.push(f)
        lastFlow = f
      }
    }
    const idx = seq.map((f) => FLOW_IDS.indexOf(f))
    const expected = [0, 1, 2].slice(0, seq.length)
    if (idx.some((v, i) => v !== expected[i])) {
      warn('S1', `主链 flow 顺序异常: ${seq.join(' → ')}（应为 flow_1 → flow_2 → flow_3）`)
    } else if (seq.length < 3) {
      warn('S1', `主链只经过 ${seq.join(' → ')}，未到 flow_3（flow_3 无节点）`)
    }
  }

  // ---- S2: 三条 flow 均非空 ----
  for (let i = 0; i < FLOW_IDS.length; i++) {
    if (!flowNodes[i].length) warn('S2', `${FLOW_IDS[i]} 无节点（child_title 仍声明该 flow）`, FLOW_IDS[i])
  }

  // ---- H11: problem_source flow 交叉校验 ----
  const nodeFlowIds = new Set(nodes.map((n) => n.flow_id).filter(Boolean))
  for (const ps of Array.isArray(cw.problem_source) ? cw.problem_source : []) {
    if (ps && ps.flow_id && !nodeFlowIds.has(ps.flow_id)) {
      fail('H11', `problem_source 的 flow_id=${ps.flow_id} 未出现在任何节点的 flow_id 中`, ps.flow_id)
    }
  }

  // ---- S6: images description 非空 ----
  for (const ps of Array.isArray(cw.problem_source) ? cw.problem_source : []) {
    for (const img of Array.isArray(ps && ps.images) ? ps.images : []) {
      if (typeof img === 'object' && img && img.url && !img.description) {
        warn('S6', `problem_source(${ps.flow_id}) 图片 ${img.url} 缺 description`, img.url)
      }
    }
  }

  return violations
}

/** 校验单个 courseware.json 文件，返回违规列表 */
export function checkCoursewareFile(file) {
  let cw
  try {
    cw = JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch (e) {
    return [{ level: 'hard', rule: 'H0', node: null, message: `无法解析 ${file}: ${e.message}`, file }]
  }
  return checkCourseware(cw, { file })
}

/** 递归收集目录下全部 courseware.json */
export function collectCoursewareFiles(input) {
  const files = []
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name)
      if (e.isDirectory()) walk(p)
      else if (e.name === 'courseware.json') files.push(p)
    }
  }
  for (const item of input) {
    if (!fs.existsSync(item)) {
      console.warn(`[courseware-check] 路径不存在，跳过: ${item}`)
      continue
    }
    const st = fs.statSync(item)
    if (st.isFile()) files.push(item)
    else if (st.isDirectory()) walk(item)
  }
  return files.sort()
}

function main() {
  const args = process.argv.slice(2)
  const inputs = args.length ? args : [path.join(ROOT, 'dist')]
  const files = collectCoursewareFiles(inputs)
  if (!files.length) {
    console.log('[courseware-check] 未找到 courseware.json')
    process.exit(0)
  }
  let hard = 0
  let soft = 0
  for (const file of files) {
    const v = checkCoursewareFile(file)
    for (const it of v) {
      const tag = it.level === 'hard' ? 'FAIL' : 'warn'
      const where = it.node ? ` [${it.node}]` : ''
      const rel = path.relative(ROOT, file).replace(/\\/g, '/')
      console.log(`[courseware-check] ${tag} ${it.rule}${where} ${it.message} (${rel})`)
      if (it.level === 'hard') hard++
      else soft++
    }
  }
  console.log(`[courseware-check] ${files.length} 个文件：硬规则违规 ${hard}，软规则提示 ${soft}`)
  process.exit(hard ? 1 : 0)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}
