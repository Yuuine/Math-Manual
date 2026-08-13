#!/usr/bin/env node
// 将全量快照 plan.json 转为增量叠加形态：
//  - blocks 按 id 差分（同容器）
//  - section → outline + outlineIndex（引导轨；desc 恒空）
//  - choice / oral 拆成「提问 + 揭晓（无口播）」
//  - 【短语】→ 先出全文再逐步 highlights[]
//  - 含「｜」的多行表按行累加拆拍
//  - flow_2 正文 fill → 顶部 quickQA 夹层（question/answer/close）
//  - 练习进容器先拍照作答，再审题（不要挂在练习-action2）
//  - 「已知/求/问」开头的正文 → section 标签 + lead
// 用法：node tools/normalize-plan.mjs <plan.json>
import fs from 'node:fs'
import path from 'node:path'

const INTERACTIVE = new Set(['choice', 'oral'])
const SPLIT_TYPES = new Set(['choice', 'oral'])

function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj))
}

function stripSectionNumber(title) {
  return String(title || '').replace(/^\d+[.、．]\s*/, '').trim()
}

function blockKey(block) {
  if (!block) return null
  if (block.id != null && block.id !== '') return String(block.id)
  if (block.replaceKey != null && block.replaceKey !== '') return 'rk:' + block.replaceKey
  return null
}

function fingerprint(block) {
  try {
    return JSON.stringify(block)
  } catch {
    return String(block && block.id)
  }
}

function actionName(entry) {
  if (entry && typeof entry === 'object' && entry.name != null) return String(entry.name)
  if (entry != null && entry !== '') return String(entry)
  return ''
}

function primaryAction(state) {
  const a = state && state.action
  if (Array.isArray(a) && a.length) {
    const n = actionName(a[0])
    if (n) return n
  } else if (a != null && !Array.isArray(a)) {
    const n = actionName(a)
    if (n) return n
  }
  return state && state.id ? String(state.id) : ''
}

function buildFlowContainerMap(plan) {
  const sources = Array.isArray(plan.problem_source) ? plan.problem_source : []
  const problemFlows = {}
  sources.forEach((ps, i) => {
    if (ps && ps.flow_id) problemFlows[String(ps.flow_id)] = i
  })
  const flowMap = {}
  let active = 0
  for (const st of plan.timeline || []) {
    if (!st) continue
    const fid = st.flow_id != null ? String(st.flow_id) : ''
    if (fid && problemFlows[fid] != null) active = problemFlows[fid]
    if (fid && flowMap[fid] == null) flowMap[fid] = active
  }
  return { flowMap, problemFlows }
}

function containerIdx(state, maps) {
  const fid = state && state.flow_id != null ? String(state.flow_id) : ''
  if (fid && maps.flowMap[fid] != null) return maps.flowMap[fid]
  return 0
}

const LEAD_TAG_TONE = { 已知: 'known', 求: 'ask', 问: 'ask' }

/** 「已知万级是28…」→ section：已知进绿标，其余进 lead */
function promoteLeadTag(block) {
  if (!block || block.region === 'top') return block
  if (block.type === 'section' && block.tag) return block
  if (block.type !== 'text' && block.type !== 'section') return block
  const lines = block.lines || (block.text ? [block.text] : [])
  if (!lines.length) return block
  const first = typeof lines[0] === 'object' && lines[0]
    ? String(lines[0].text != null ? lines[0].text : lines[0].value || '')
    : String(lines[0] || '')
  const m = first.match(/^(已知|求|问)[：:、，]?\s*(.*)$/)
  if (!m) return block
  const extra = lines.slice(1)
  block.type = 'section'
  block.tag = m[1]
  block.tagTone = LEAD_TAG_TONE[m[1]] || 'known'
  block.lead = m[2] || ''
  if (extra.length) block.lines = extra
  else delete block.lines
  if (block.text != null) delete block.text
  return block
}

function ensureReplaceKey(block) {
  if (!block || !block.id) return block
  if (INTERACTIVE.has(block.type) || block.type === 'fill') {
    if (block.replaceKey == null || block.replaceKey === '') block.replaceKey = block.id
  }
  if ((block.type === 'text' || block.type === 'section') && block.region !== 'top' && block.id) {
    if (block.replaceKey == null || block.replaceKey === '') block.replaceKey = block.id
  }
  return block
}

function extractSections(blocks) {
  const sections = []
  const rest = []
  for (const b of blocks || []) {
    if (b && b.type === 'section' && b.title) {
      sections.push({
        title: stripSectionNumber(b.title),
        rawTitle: b.title,
        id: b.id || null
      })
    } else if (b) {
      rest.push(b)
    }
  }
  return { sections, rest }
}

function diffBlocks(prevMap, blocks) {
  const delta = []
  const nextMap = { ...prevMap }
  for (const b of blocks || []) {
    const key = blockKey(b)
    if (!key) {
      delta.push(b)
      continue
    }
    const prev = prevMap[key]
    if (!prev || fingerprint(prev) !== fingerprint(b)) delta.push(b)
    nextMap[key] = b
  }
  return { delta, nextMap }
}

function findInteractive(blocks) {
  return (blocks || []).filter((b) => b && SPLIT_TYPES.has(b.type))
}

function makeAskBlocks(blocks) {
  return (blocks || []).map((b) => {
    const c = deepClone(b)
    ensureReplaceKey(c)
    if (c.type === 'choice') delete c.revealed
    if (c.type === 'oral') delete c.answer
    return c
  })
}

function makeRevealBlocks(askBlocks, fullDeltaBlocks) {
  const out = []
  const seen = new Set()
  for (const b of askBlocks || []) {
    if (!b || !SPLIT_TYPES.has(b.type)) continue
    const c = deepClone(b)
    ensureReplaceKey(c)
    if (c.type === 'choice') {
      c.revealed = true
      const full = (fullDeltaBlocks || []).find((x) => x && x.id === b.id)
      if (full && full.answer != null) c.answer = full.answer
    }
    if (c.type === 'oral') {
      const full = (fullDeltaBlocks || []).find((x) => x && x.id === b.id)
      if (full && full.answer != null) c.answer = full.answer
      else if (b.answer != null) c.answer = b.answer
    }
    out.push(c)
    seen.add(blockKey(c))
  }
  let afterInteractive = false
  for (const b of fullDeltaBlocks || []) {
    if (!b) continue
    if (SPLIT_TYPES.has(b.type)) {
      afterInteractive = true
      continue
    }
    if (!afterInteractive) continue
    const key = blockKey(b)
    if (key && seen.has(key)) continue
    const c = deepClone(b)
    ensureReplaceKey(c)
    out.push(c)
    if (key) seen.add(key)
  }
  return out
}

function insertPracticePhotoFirst(states, maps) {
  const firstIdx = states.findIndex((s) => s && containerIdx(s, maps) > 0)
  if (firstIdx < 0) return states
  const practiceIdx = containerIdx(states[firstIdx], maps)
  const existingPhoto = states.find((s) =>
    s && containerIdx(s, maps) === practiceIdx && s.answer_type === 'course_photo')
  const rest = states.filter((s) => s !== existingPhoto)
  const first = rest.find((s) => s && containerIdx(s, maps) === practiceIdx)
  if (!first) return states

  const stem = (first.blocks || []).find((b) =>
    b && (b.region === 'top' || /\bstem\b/.test(String(b.class || ''))))
  const photo = existingPhoto ? deepClone(existingPhoto) : {}
  const photoId = photo.id || 'p-photo'
  photo.id = photoId
  photo.flow_id = first.flow_id
  photo.type = 'question'
  photo.head = first.head || '练'
  photo.text = ''
  photo.action = ['练习-作答-拍照']
  photo.next = first.id
  photo.test = [
    { when: true, next: first.id },
    { when: false, next: first.id }
  ]
  photo.question_type = 'practice_main'
  photo.answer_type = 'course_photo'
  photo.answer = []
  photo.blocks = stem ? [deepClone(stem)] : []
  delete photo.outlineIndex
  delete photo._sections
  if (first.outline) photo.outline = first.outline
  else delete photo.outline
  delete first.head
  delete first.outline

  const insertAt = rest.indexOf(first)
  rest.splice(insertAt, 0, photo)
  return rest
}

function lineText(line) {
  if (line == null) return ''
  if (typeof line === 'string') return line
  return line.text != null ? String(line.text) : String(line.value || '')
}

function mapLines(lines, fn) {
  return (lines || []).map((line) => {
    if (typeof line === 'string') return fn(line)
    const next = deepClone(line)
    next.text = fn(lineText(line))
    return next
  })
}

function extractBracketPhrases(text) {
  const re = /【([^】]+)】/g
  const out = []
  let m
  while ((m = re.exec(String(text || '')))) out.push(m[1])
  return out
}

function stripBrackets(text) {
  return String(text || '').replace(/【([^】]+)】/g, '$1')
}

function stateHasHighlights(st) {
  return (st.blocks || []).some((b) => Array.isArray(b.highlights) && b.highlights.length)
}

/** 【a】【b】→ 先出无高亮全文，再每圈一步累加 highlights。
 *  审题动画「高亮」优先打在题干（region:top），短语能在题干中找到时用 stem。 */
function expandHighlightBeats(states) {
  const out = []
  for (const st of states) {
    if (st.qa || stateHasHighlights(st)) {
      out.push(st)
      continue
    }
    let phrases = []
    let bodyId = null
    let stemBlock = null
    for (const b of st.blocks || []) {
      if (!b || b.type !== 'text') continue
      if (b.region === 'top') stemBlock = b
      for (const line of b.lines || []) {
        const found = extractBracketPhrases(lineText(line))
        if (found.length) {
          phrases = phrases.concat(found)
          if (b.region !== 'top') bodyId = b.id
        }
      }
    }
    if (!phrases.length) {
      out.push(st)
      continue
    }

    const strippedBlocks = deepClone(st.blocks || []).map((b) => {
      if (b && b.type === 'text' && b.lines) b.lines = mapLines(b.lines, stripBrackets)
      return ensureReplaceKey(b)
    })

    // 优先题干：全部短语都出现在 stem 文本里
    let targetId = bodyId
    if (stemBlock) {
      const stemTxt = (stemBlock.lines || []).map(lineText).join('')
      const stemPlain = stripBrackets(stemTxt)
      if (phrases.every((ph) => stemPlain.indexOf(ph) >= 0 || stemTxt.indexOf(ph) >= 0)) {
        targetId = stemBlock.id
      }
    }
    if (!targetId) {
      out.push(st)
      continue
    }

    const base = deepClone(st)
    base.blocks = deepClone(strippedBlocks)
    delete base._sections
    out.push(base)

    let acc = []
    phrases.forEach((ph, i) => {
      acc = acc.concat([ph])
      const beat = {
        id: st.id + '-hl' + (i + 1),
        flow_id: st.flow_id,
        type: 'text',
        text: '',
        action: [primaryAction(st) + '-高亮' + (i + 1)],
        next: null,
        test: [],
        outlineIndex: st.outlineIndex,
        blocks: deepClone(strippedBlocks)
          .filter((b) => b && b.id === targetId)
          .map((b) => {
            b.highlights = acc.slice()
            return ensureReplaceKey(b)
          })
      }
      if (String(st.text || '').indexOf(ph) >= 0) beat.at = ph
      out.push(beat)
    })
  }
  return out
}

/** 含「｜」且多行的表：按行累加拆拍（口播留在第一拍） */
function expandTableLineBeats(states) {
  const out = []
  for (const st of states) {
    if (st.qa || findInteractive(st.blocks).length) {
      out.push(st)
      continue
    }
    const table = (st.blocks || []).find((b) => {
      if (!b || b.type !== 'text' || b.region === 'top') return false
      const lines = b.lines || []
      if (lines.length < 2) return false
      return lines.some((l) => lineText(l).indexOf('｜') >= 0)
    })
    if (!table) {
      out.push(st)
      continue
    }
    // 已有逐步 highlights 的同块不拆行（避免与高亮拍冲突）
    if (Array.isArray(table.highlights) && table.highlights.length) {
      out.push(st)
      continue
    }

    const lines = table.lines.slice()
    const others = (st.blocks || []).filter((b) => b && b.id !== table.id)
    const first = deepClone(st)
    first.blocks = others.concat([{
      ...deepClone(table),
      lines: lines.slice(0, 1)
    }].map(ensureReplaceKey))
    delete first._sections
    out.push(first)

    for (let i = 1; i < lines.length; i++) {
      out.push({
        id: st.id + '-row' + (i + 1),
        flow_id: st.flow_id,
        type: 'text',
        text: '',
        action: [primaryAction(st) + '-行' + (i + 1)],
        next: null,
        test: [],
        outlineIndex: st.outlineIndex,
        blocks: [{
          ...deepClone(table),
          lines: lines.slice(0, i + 1)
        }].map(ensureReplaceKey)
      })
    }
  }
  return out
}

function fillPartIsBlank(part) {
  return !!(part && (part.type === 'blank' || part.kind === 'blank'))
}

function fillPartText(part) {
  if (!part) return ''
  if (fillPartIsBlank(part)) return '＿＿'
  if (part.text != null && part.text !== '') return String(part.text)
  if (part.value != null && part.value !== '') return String(part.value)
  return ''
}

function fillPartsToQuestion(fill) {
  let q = ''
  for (const p of fill.parts || []) {
    if (!p) continue
    q += fillPartText(p)
  }
  return q.replace(/（\s*＿＿\s*）/g, '＿＿').replace(/\(\s*＿＿\s*\)/g, '＿＿')
}

/** flow_2 正文 fill → quickQA 顶部夹层 */
function convertFlow2QuickQA(plan, states) {
  if (Array.isArray(plan.quickQA) && plan.quickQA.length) {
    return { states, quickQA: plan.quickQA, layout: plan.quickQALayout || 'above-body' }
  }

  const fills = []
  for (const st of states) {
    if (st.flow_id !== 'flow_2') continue
    const fill = (st.blocks || []).find((b) => b && b.type === 'fill')
    if (!fill) continue
    fills.push({ st, fill })
  }
  if (!fills.length) {
    return { states, quickQA: [], layout: plan.quickQALayout || null }
  }

  const quickQA = fills.map(({ st: src, fill }, i) => {
    const ans = Array.isArray(fill.answer) ? fill.answer[0] : fill.answer
    const fromParts = fillPartsToQuestion(fill)
    const spoken = src && src.text != null ? String(src.text).trim() : ''
    const question = spoken || fromParts || '（　　）'
    return {
      id: 'qa-' + (i + 1),
      question: question,
      answer: ans != null ? String(ans) : '',
      fillBlank: !spoken && /＿＿/.test(fromParts)
    }
  })

  const out = []
  let replaced = false
  for (const st of states) {
    if (st.flow_id !== 'flow_2') {
      out.push(st)
      continue
    }
    if (replaced) continue
    fills.forEach(({ st: src }, i) => {
      const id = quickQA[i].id
      out.push({
        id: src.id + '-q',
        flow_id: 'flow_2',
        type: 'text',
        text: src.text || '',
        action: src.action && src.action.length ? src.action.slice() : ['快问-' + (i + 1)],
        next: null,
        test: [],
        qa: 'question',
        qaId: id,
        blocks: []
      })
      out.push({
        id: src.id + '-a',
        flow_id: 'flow_2',
        type: 'text',
        text: '',
        action: [primaryAction(src) + '-揭晓'],
        next: null,
        test: [],
        qa: 'answer',
        qaId: id,
        blocks: []
      })
    })
    out.push({
      id: 'qa-close',
      flow_id: 'flow_2',
      type: 'text',
      text: '',
      action: ['快问-关闭'],
      next: null,
      test: [],
      qa: 'close',
      blocks: []
    })
    replaced = true
  }

  return { states: out, quickQA, layout: 'above-body' }
}

function rebuildOutlineFromTimeline(states, cIdx, maps) {
  const items = []
  const indexByTitle = {}
  for (const st of states) {
    if (containerIdx(st, maps) !== cIdx) continue
    for (const sec of st._sections || []) {
      const title = sec.title
      if (!title || title === '快问快答') continue
      if (indexByTitle[title] == null) {
        indexByTitle[title] = items.length
        items.push({ title, desc: '' })
      }
    }
  }
  return { items, indexByTitle }
}

function assignOutlineIndex(states, cIdx, maps, indexByTitle) {
  let current = null
  for (const st of states) {
    if (containerIdx(st, maps) !== cIdx) continue
    if (st._sections && st._sections.length) {
      const title = st._sections[st._sections.length - 1].title
      if (title && indexByTitle[title] != null) current = indexByTitle[title]
    }
    if (current != null && st.outlineIndex == null) st.outlineIndex = current
  }
}

function relink(expanded) {
  const idSet = new Set(expanded.map((s) => s.id))
  for (let i = 0; i < expanded.length; i++) {
    const st = expanded[i]
    const fallbackNext = i + 1 < expanded.length ? expanded[i + 1].id : null
    if (st.next != null && !idSet.has(st.next)) st.next = fallbackNext
    if (st.next === undefined) st.next = fallbackNext
    if (i < expanded.length - 1 && (st.next == null || !idSet.has(st.next))) {
      // 非末步：强制串到下一步（展开后插入的拍）
      if (!(st.type === 'question' && st.test && st.test.length)) st.next = fallbackNext
    }
    if (Array.isArray(st.test)) {
      st.test = st.test.map((t) => {
        if (!t) return t
        if (t.next != null && !idSet.has(t.next)) {
          return { ...t, next: st.next != null ? st.next : fallbackNext }
        }
        return t
      })
    }
    delete st._sections
  }
  // 顺序修正：无显式有效 next 的 text 步指向数组下一项
  for (let i = 0; i < expanded.length - 1; i++) {
    const st = expanded[i]
    const nxt = expanded[i + 1].id
    if (st.type === 'question' && st.test && st.test.length) {
      // question 的 test/next 应已指向揭晓
      if (st.next == null || !idSet.has(st.next)) st.next = nxt
      continue
    }
    st.next = nxt
  }
  if (expanded.length) expanded[expanded.length - 1].next = expanded[expanded.length - 1].next == null
    ? null
    : expanded[expanded.length - 1].next
  return expanded
}

/** 口答/选择/填空/拍照等：test 的 true/false 指向节点口播必须为空 */
function blankTestTargetTexts(states) {
  const byId = {}
  for (const st of states) {
    if (st && st.id) byId[st.id] = st
  }
  for (const st of states) {
    if (!st || !Array.isArray(st.test)) continue
    for (const t of st.test) {
      if (!t || t.next == null) continue
      const tgt = byId[t.next]
      if (tgt) tgt.text = ''
    }
  }
  return states
}

function normalizePlan(plan) {
  const out = deepClone(plan)
  // 已是圈号/快问弹窗手写形态：只做轻量校验字段，不二次拆拍
  if (Array.isArray(out.quickQA) && out.quickQA.length) {
    out.quickQALayout = out.quickQALayout || 'above-body'
    out.textAccumulate = out.textAccumulate !== false
    out.guidanceLayout = out.guidanceLayout || 'interleaved'
    if (Array.isArray(out.outline)) {
      out.outline = out.outline
        .filter((o) => o && o.title !== '快问快答')
        .map((o) => ({ title: stripSectionNumber(o.title), desc: '' }))
    }
    ;(out.timeline || []).forEach((st) => {
      ;(st.blocks || []).forEach((b) => {
        promoteLeadTag(b)
        ensureReplaceKey(b)
      })
      if (Array.isArray(st.outline)) {
        st.outline = st.outline.map((o) => ({ title: stripSectionNumber(o.title), desc: '' }))
      }
    })
    out.timeline = blankTestTargetTexts(relink(insertPracticePhotoFirst(
      out.timeline || [],
      buildFlowContainerMap(out)
    )))
    return out
  }

  const maps = buildFlowContainerMap(out)
  const timeline = out.timeline || []

  const prevMaps = {}
  let prepared = []

  for (const raw of timeline) {
    const st = deepClone(raw)
    const cIdx = containerIdx(st, maps)
    const { sections, rest } = extractSections(st.blocks || [])
    st._sections = sections
    rest.forEach((b) => {
      promoteLeadTag(b)
      ensureReplaceKey(b)
    })

    if (!prevMaps[cIdx]) prevMaps[cIdx] = {}
    const { delta, nextMap } = diffBlocks(prevMaps[cIdx], rest)
    prevMaps[cIdx] = nextMap
    st.blocks = delta
    if (Array.isArray(st.animation)) {
      const ids = new Set(delta.map((b) => b && b.id).filter(Boolean))
      st.animation = st.animation.filter((a) => a && ids.has(a.target))
      if (!st.animation.length) delete st.animation
    }
    prepared.push(st)
  }

  const containerIds = [...new Set(prepared.map((s) => containerIdx(s, maps)))].sort((a, b) => a - b)
  const outlinesByContainer = {}
  for (const cIdx of containerIds) {
    outlinesByContainer[cIdx] = rebuildOutlineFromTimeline(prepared, cIdx, maps)
    assignOutlineIndex(prepared, cIdx, maps, outlinesByContainer[cIdx].indexByTitle)
  }

  out.outline = (outlinesByContainer[0] ? outlinesByContainer[0].items : [])
    .filter((o) => o.title !== '快问快答')

  for (const st of prepared) {
    const cIdx = containerIdx(st, maps)
    if (cIdx === 0) continue
    const firstOfContainer = prepared.find((s) => containerIdx(s, maps) === cIdx)
    if (st === firstOfContainer) {
      st.outline = outlinesByContainer[cIdx].items
      if (st.head == null) st.head = '练'
    }
  }

  prepared = expandHighlightBeats(prepared)
  prepared = expandTableLineBeats(prepared)

  const qaConv = convertFlow2QuickQA(out, prepared)
  prepared = qaConv.states
  out.quickQA = qaConv.quickQA
  if (qaConv.layout) out.quickQALayout = qaConv.layout

  const expanded = []
  for (const st of prepared) {
    const act = primaryAction(st)
    const interactives = findInteractive(st.blocks)

    if (st.qa) {
      const plain = deepClone(st)
      delete plain._sections
      expanded.push(plain)
      continue
    }

    if (interactives.length) {
      const revealId = st.id + '-reveal'
      const revealAction = act + '-揭晓'
      const fullDelta = deepClone(st.blocks)
      let after = false
      const askOnly = []
      for (const b of st.blocks || []) {
        if (SPLIT_TYPES.has(b.type)) {
          after = true
          askOnly.push(b)
          continue
        }
        if (after && b.type === 'text') continue
        askOnly.push(b)
      }
      const ask = deepClone(st)
      ask.blocks = makeAskBlocks(askOnly)
      ask.next = revealId
      if (ask.type === 'question') {
        ask.test = [
          { when: true, next: revealId },
          { when: false, next: revealId }
        ]
      } else ask.test = []
      delete ask._sections
      expanded.push(ask, {
        id: revealId,
        flow_id: st.flow_id,
        type: 'text',
        text: '',
        action: [revealAction],
        next: st.next != null ? st.next : null,
        test: [],
        outlineIndex: st.outlineIndex,
        blocks: makeRevealBlocks(ask.blocks, fullDelta)
      })
      continue
    }

    const plain = deepClone(st)
    delete plain._sections
    expanded.push(plain)
  }

  out.timeline = blankTestTargetTexts(relink(insertPracticePhotoFirst(expanded, maps)))
  out.textAccumulate = out.textAccumulate !== false
  out.guidanceLayout = out.guidanceLayout || 'interleaved'
  return out
}

function main() {
  const args = process.argv.slice(2).filter((a) => a !== '--in-place' && a !== '--from-snapshot')
  const forceSnapshot = process.argv.includes('--from-snapshot')
  const planPath = path.resolve(args[0] || '')
  if (!planPath || !fs.existsSync(planPath)) {
    console.error('用法: node tools/normalize-plan.mjs <plan.json> [--from-snapshot]')
    process.exit(1)
  }
  const raw = JSON.parse(fs.readFileSync(planPath, 'utf8'))
  const snapshotPath = planPath.replace(/\.json$/i, '.snapshot.json')
  if (!fs.existsSync(snapshotPath)) {
    fs.writeFileSync(snapshotPath, JSON.stringify(raw, null, 2) + '\n', 'utf8')
    console.log('[normalize] 备份 snapshot →', snapshotPath)
  }

  const hasBeatForm = Array.isArray(raw.quickQA) && raw.quickQA.length > 0
  let source = raw
  if (forceSnapshot && fs.existsSync(snapshotPath)) {
    source = JSON.parse(fs.readFileSync(snapshotPath, 'utf8'))
    console.log('[normalize] --from-snapshot：从 snapshot 重建')
  } else if (!hasBeatForm && fs.existsSync(snapshotPath)) {
    source = JSON.parse(fs.readFileSync(snapshotPath, 'utf8'))
    console.log('[normalize] 使用 snapshot 作为源')
  } else if (hasBeatForm) {
    console.log('[normalize] 检测到 quickQA 手写形态，轻量规范化（不二次拆拍）')
  }

  const normalized = normalizePlan(source)
  fs.writeFileSync(planPath, JSON.stringify(normalized, null, 2) + '\n', 'utf8')

  const n = normalized.timeline.length
  const reveals = normalized.timeline.filter((s) => /揭晓$/.test(primaryAction(s))).length
  const photos = normalized.timeline.filter((s) => s.answer_type === 'course_photo').length
  const qaSteps = normalized.timeline.filter((s) => s.qa).length
  console.log(`[normalize] ${path.basename(planPath)} → ${n} states, ${reveals} 揭晓, ${photos} 拍照, ${qaSteps} 快问拍`)
  console.log(`[normalize] outline(例):`, (normalized.outline || []).map((o) => o.title).join(' / '))
  console.log('[normalize] 写出', planPath)
}

main()
