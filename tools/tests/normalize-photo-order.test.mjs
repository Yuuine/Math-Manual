// 拍照练习流程解耦回归测试：题干 → 拍照 → 审题。
// 题干步只显示题干（outlineIndex 缺省 → 引导链收起），拍照步仍收起，审题步激活引导节。
import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizePlan } from '../normalize-plan.mjs'

function makePlan() {
  return {
    profile: 'AIClass_text',
    problem_source: [{ flow_id: 'flow_1' }, { flow_id: 'flow_3' }],
    timeline: [
      { id: 'e1', flow_id: 'flow_1', type: 'text', action: ['例-审题'], text: '例题', blocks: [{ id: 'stem-e', type: 'text', region: 'top', class: 'tx-stem', lines: ['例'] }] },
      { id: 'pr-stem', flow_id: 'flow_3', type: 'text', action: ['练-开始'], text: '', blocks: [
        { id: 'stem-pr', type: 'text', region: 'top', class: 'tx-stem', replaceKey: 'stem', lines: ['练习题'] },
        { id: 'sec-1', type: 'section', title: '审题', lines: ['先看题'] }
      ] },
      { id: 'pr-n1', flow_id: 'flow_3', type: 'text', action: ['练-审题'], text: '审题口播', blocks: [{ id: 't-pr', type: 'text', region: 'main', lines: ['审题内容'] }] }
    ]
  }
}

test('拍照练习解耦：题干步(收起) → 拍照步(收起) → 审题步(激活)', () => {
  const out = normalizePlan(makePlan())
  const ids = out.timeline.map((s) => s.id)
  const stemIdx = ids.indexOf('pr-stem')
  const photoIdx = ids.indexOf('p-photo')
  assert.ok(stemIdx >= 0, '题干步存在')
  assert.ok(photoIdx >= 0, '拍照步存在')
  assert.ok(stemIdx < photoIdx, '题干步先于拍照步')

  const stemStep = out.timeline[stemIdx]
  const photo = out.timeline[photoIdx]
  const reviewStep = out.timeline[photoIdx + 1]

  // 题干步：只显示题干，引导链收起（outlineIndex 缺省）
  assert.equal(stemStep.head, '练', '题干步保留练习标签')
  assert.ok(Array.isArray(stemStep.outline) && stemStep.outline.length > 0, '题干步保留 outline（guide panel 靠它挂载）')
  assert.equal(stemStep.outlineIndex, undefined, '题干步 outlineIndex 缺省 → 引导链收起，只显示题干')
  assert.ok((stemStep.blocks || []).every((b) => b.region === 'top'), '题干步只含题干块')

  // 拍照步：无判题（test 空），指向审题步
  assert.equal(photo.action[0], '练习-作答-拍照')
  assert.equal(photo.answer_type, 'course_photo')
  assert.deepEqual(photo.test || [], [], '拍照步 test 为空（course_photo 无判题）')
  assert.equal(photo.next, 'pr-n1', '拍照步 next 指向审题步')

  // 审题步：outlineIndex 0 激活审题引导节，口播保留
  assert.equal(reviewStep.id, 'pr-n1')
  assert.equal(reviewStep.outlineIndex, 0, '审题步激活首引导节')
  assert.equal(reviewStep.text, '审题口播', '审题步口播不被清空')
})

test('拍照练习解耦：首题干步无自身 section 时，outline 仍保留但 outlineIndex 缺省，审题步激活', () => {
  const p = makePlan()
  // pr-stem 无 section 块（outline 靠后续 state 的 section 构建，等同「练-开始」形态）
  p.timeline[1].blocks = [{ id: 'stem-pr', type: 'text', region: 'top', class: 'tx-stem', replaceKey: 'stem', lines: ['练习题'] }]
  // pr-n1 提供 section + 审题内容
  p.timeline[2].blocks = [
    { id: 't-pr', type: 'text', region: 'main', lines: ['审题内容'] },
    { id: 'sec-1', type: 'section', title: '审题', lines: ['先看题'] }
  ]
  const out = normalizePlan(p)
  const stemIdx = out.timeline.findIndex((s) => s.id === 'pr-stem')
  const photoIdx = out.timeline.findIndex((s) => s.id === 'p-photo')
  assert.ok(Array.isArray(out.timeline[stemIdx].outline) && out.timeline[stemIdx].outline.length > 0,
    'outline 从后续 section 构建并保留在首题干步')
  assert.equal(out.timeline[stemIdx].outlineIndex, undefined, '题干步引导链收起')
  const review = out.timeline[photoIdx + 1]
  assert.equal(review.id, 'pr-n1')
  assert.equal(review.outlineIndex, 0, '审题步激活首引导节')
})

test('拍照练习解耦：已含 p-photo 的手写形态，重排后仍题干在前、拍照后进审题', () => {
  const p = makePlan()
  // 模拟手写形态：quickQA 非空走轻量路径，timeline 里已有 p-photo 且顺序错误（拍照在前）
  p.quickQA = [{ id: 'qa-1', question: '问', answer: '答' }]
  p.timeline = [
    p.timeline[0],
    { id: 'p-photo', flow_id: 'flow_3', type: 'question', head: '练', action: ['练习-作答-拍照'], next: 'pr-stem', question_type: 'practice_main', answer_type: 'course_photo', answer: [], blocks: [p.timeline[1].blocks[0]] },
    { id: 'pr-stem', flow_id: 'flow_3', type: 'text', action: ['练-开始'], text: '', blocks: [p.timeline[1].blocks[0]] },
    p.timeline[2]
  ]
  p.timeline[0].next = 'p-photo'
  const out = normalizePlan(p)
  const ids = out.timeline.map((s) => s.id)
  assert.ok(ids.indexOf('pr-stem') < ids.indexOf('p-photo'), '轻量路径下题干步仍在拍照步之前')
  const photo = out.timeline[ids.indexOf('p-photo')]
  assert.equal(photo.next, 'pr-n1', '拍照步 next 指向审题步')
  const stemStep = out.timeline[ids.indexOf('pr-stem')]
  assert.equal(stemStep.outlineIndex, undefined, '题干步引导链收起')
  assert.equal(out.timeline[0].next, 'pr-stem', '上一拍若指向拍照，改挂到题干步')
})

test('拍照练习解耦：左栏插图算题干，不把读题步拆成审题', () => {
  const p = makePlan()
  p.quickQA = [{ id: 'qa-1', question: '问', answer: '答' }]
  p.timeline[0].next = 'p-photo'
  p.timeline[1].blocks = [
    p.timeline[1].blocks[0],
    {
      id: 'p-illus',
      type: 'text',
      region: 'left',
      class: 'tx-illus tx-illus-vertical',
      replaceKey: 'p-illus',
      lines: [{ html: true, text: '<img src="assets/a.png" alt="插图">' }]
    }
  ]
  p.timeline[2].blocks = [
    { id: 't-pr', type: 'text', region: 'main', lines: ['审题内容'] },
    { id: 'sec-1', type: 'section', title: '审题', lines: ['先看题'] }
  ]
  p.timeline.splice(1, 0, {
    id: 'p-photo',
    flow_id: 'flow_3',
    type: 'question',
    head: '练',
    action: ['练习-作答-拍照'],
    next: 'pr-stem',
    question_type: 'practice_main',
    answer_type: 'course_photo',
    answer: [],
    blocks: [p.timeline[1].blocks[0]]
  })
  const out = normalizePlan(p)
  const ids = out.timeline.map((s) => s.id)
  assert.equal(ids.includes('pr-stem-stem'), false, '不因插图拆出额外题干步')
  assert.ok(ids.indexOf('pr-stem') < ids.indexOf('p-photo'), '题干仍在拍照前')
  const stemStep = out.timeline[ids.indexOf('pr-stem')]
  assert.equal(stemStep.outlineIndex, undefined, '读题步引导链收起')
  assert.ok((stemStep.blocks || []).some((b) => b.id === 'p-illus'), '插图留在题干步')
  assert.equal(out.timeline[0].next, 'pr-stem')
})
