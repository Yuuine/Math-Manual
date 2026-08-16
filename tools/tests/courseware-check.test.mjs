// courseware-check 校验规则回归测试：硬规则（H1–H11）与软规则（S1–S4/S6/S8）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { checkCourseware } from '../courseware-check.mjs'

/** 最小合法课件：主链 flow_1 → flow_2 → flow_3，末节点 next=null */
function makeValidCourseware() {
  return {
    id: 'x-1star',
    title: '测试课',
    child_title: [
      { title: '学习例题的解题思路', flow_id: 'flow_1' },
      { title: '快速复习例题的解题思路', flow_id: 'flow_2' },
      { title: '自己来做做练习题', flow_id: 'flow_3' }
    ],
    problem_source: [
      { flow_id: 'flow_1', stem: '题', answer_short: '答', answer_detail: '解析', images: [] }
    ],
    nodes: [
      { id: 'e1', flow_id: 'flow_1', type: 'text', text: '例题', action: ['例-审题'], next: 'qa1', test: [] },
      { id: 'qa1', flow_id: 'flow_2', type: 'question', text: '问？', action: ['例_快问快答_显示问题'], next: 'qa1-a', test: [{ when: true, next: 'qa1-a' }, { when: false, next: 'qa1-a' }], question_type: 'practice_quick', answer_type: 'course_fill', answer: ['答一', '答二'] },
      { id: 'qa1-a', flow_id: 'flow_2', type: 'text', text: '', action: ['例_快问快答_显示答案'], next: 'pr-photo', test: [] },
      { id: 'pr-photo', flow_id: 'flow_3', type: 'question', text: '', action: ['练习-作答-拍照'], next: 'pr1', test: [], question_type: 'practice_main', answer_type: 'course_photo', answer: [] },
      { id: 'pr1', flow_id: 'flow_3', type: 'text', text: '练', action: ['练-审题'], next: null, test: [] }
    ],
    globals: []
  }
}

const levels = (v) => v.map((x) => x.level + ':' + x.rule)

test('合法课件零违规', () => {
  assert.deepEqual(checkCourseware(makeValidCourseware()), [])
})

test('H1: id 缺失/重复', () => {
  const cw = makeValidCourseware()
  cw.nodes[1].id = cw.nodes[0].id
  assert.ok(levels(checkCourseware(cw)).includes('hard:H1'))
  const cw2 = makeValidCourseware()
  cw2.nodes.push({ id: '', flow_id: 'flow_1', type: 'text', text: '', action: [], next: 'e1', test: [] })
  assert.ok(levels(checkCourseware(cw2)).includes('hard:H1'))
})

test('H2: 悬空引用（next 与 test）', () => {
  const cw = makeValidCourseware()
  cw.nodes[0].next = 'nope'
  assert.ok(levels(checkCourseware(cw)).includes('hard:H2'))
  const cw2 = makeValidCourseware()
  cw2.nodes[1].test[0].next = 'nope'
  assert.ok(levels(checkCourseware(cw2)).includes('hard:H2'))
})

test('H3: test 分支 next 为 null', () => {
  const cw = makeValidCourseware()
  cw.nodes[1].test[0].next = null
  assert.ok(levels(checkCourseware(cw)).includes('hard:H3'))
})

test('H4: child_title 非三条 flow', () => {
  const cw = makeValidCourseware()
  cw.child_title = cw.child_title.slice(0, 2)
  assert.ok(levels(checkCourseware(cw)).includes('hard:H4'))
})

test('H5: 主链末 next 非 null 与成环', () => {
  const cw = makeValidCourseware()
  cw.nodes[4].next = 'e1' // 回链成环
  assert.ok(levels(checkCourseware(cw)).includes('hard:H5'))
  const cw2 = makeValidCourseware()
  cw2.nodes[4].next = 'qa1' // 非 null 且不成环？qa1 在链中 → 成环
  assert.ok(levels(checkCourseware(cw2)).includes('hard:H5'))
})

test('H6: question 缺三字段', () => {
  const cw = makeValidCourseware()
  delete cw.nodes[1].question_type
  delete cw.nodes[1].answer
  assert.ok(levels(checkCourseware(cw)).includes('hard:H6'))
})

test('H7: 枚举与组合', () => {
  const cw = makeValidCourseware()
  cw.nodes[1].question_type = 'nonsense'
  assert.ok(levels(checkCourseware(cw)).includes('hard:H7'))
  const cw2 = makeValidCourseware()
  cw2.nodes[1].answer_type = 'nonsense'
  assert.ok(levels(checkCourseware(cw2)).includes('hard:H7'))
  const cw3 = makeValidCourseware()
  cw3.nodes[3].answer_type = 'voice' // practice_main 必须 course_photo
  assert.ok(levels(checkCourseware(cw3)).includes('hard:H7'))
  const cw4 = makeValidCourseware()
  cw4.nodes[1].answer_type = 'course_choice' // practice_quick 必须 fill/voice
  assert.ok(levels(checkCourseware(cw4)).includes('hard:H7'))
})

test('H8: action 元素格式', () => {
  const cw = makeValidCourseware()
  cw.nodes[0].action = ['', 'ok']
  assert.ok(levels(checkCourseware(cw)).includes('hard:H8'))
  const cw2 = makeValidCourseware()
  cw2.nodes[0].action = [{ name: 'a' }] // 缺 at
  assert.ok(levels(checkCourseware(cw2)).includes('hard:H8'))
  const cw3 = makeValidCourseware()
  cw3.nodes[0].action = [{ name: 'a', at: '题' }] // 合法对象
  assert.deepEqual(checkCourseware(cw3).filter((v) => v.level === 'hard'), [])
})

test('H9: text 节点带 test', () => {
  const cw = makeValidCourseware()
  cw.nodes[0].test = [{ when: true, next: 'qa1' }]
  assert.ok(levels(checkCourseware(cw)).includes('hard:H9'))
})

test('H10: test 指向节点 text 非空', () => {
  const cw = makeValidCourseware()
  cw.nodes[2].text = '不该口播'
  assert.ok(levels(checkCourseware(cw)).includes('hard:H10'))
})

test('H11: problem_source flow 交叉校验', () => {
  const cw = makeValidCourseware()
  cw.problem_source[0].flow_id = 'flow_9'
  assert.ok(levels(checkCourseware(cw)).includes('hard:H11'))
})

test('S1: 主链 flow 顺序异常', () => {
  const cw = makeValidCourseware()
  cw.nodes[0].next = 'pr-photo' // flow_1 → flow_3 跳变
  const v = checkCourseware(cw)
  assert.ok(v.some((x) => x.level === 'soft' && x.rule === 'S1'))
})

test('S2: flow 无节点', () => {
  const cw = makeValidCourseware()
  cw.nodes = cw.nodes.filter((n) => n.flow_id !== 'flow_2')
  cw.nodes[0].next = 'pr-photo'
  const v = checkCourseware(cw)
  assert.ok(v.some((x) => x.level === 'soft' && x.rule === 'S2'))
})

test('S3: 链上不可达节点', () => {
  const cw = makeValidCourseware()
  cw.nodes.push({ id: 'ghost', flow_id: 'flow_3', type: 'text', text: '', action: [], next: null, test: [] })
  const v = checkCourseware(cw)
  assert.ok(v.some((x) => x.level === 'soft' && x.rule === 'S3' && x.node === 'ghost'))
})

test('S4: 快问快答 text 形态', () => {
  const cw = makeValidCourseware()
  cw.nodes[1].type = 'text' // 快问快答改 text 形态
  delete cw.nodes[1].question_type
  delete cw.nodes[1].answer_type
  delete cw.nodes[1].answer
  const v = checkCourseware(cw)
  assert.ok(v.some((x) => x.level === 'soft' && x.rule === 'S4'))
  // 打开/关闭包装节点不触发 S4
  const cw2 = makeValidCourseware()
  cw2.nodes.splice(1, 0, { id: 'qa-open', flow_id: 'flow_2', type: 'text', text: '', action: ['例_快问快答_打开'], next: 'qa1', test: [] })
  cw2.nodes[0].next = 'qa-open'
  assert.ok(!checkCourseware(cw2).some((x) => x.rule === 'S4'))
})

test('S6: images description 为空', () => {
  const cw = makeValidCourseware()
  cw.problem_source[0].images = [{ url: '题.png', description: '' }]
  const v = checkCourseware(cw)
  assert.ok(v.some((x) => x.level === 'soft' && x.rule === 'S6'))
})

test('S8: 拍照节点不在主链', () => {
  const cw = makeValidCourseware()
  cw.nodes[3].next = 'pr1' // 保持
  cw.nodes[2].next = 'pr1' // 跳过 pr-photo
  const v = checkCourseware(cw)
  assert.ok(v.some((x) => x.level === 'soft' && x.rule === 'S8' && x.node === 'pr-photo'))
})

test('{name, at} 合法对象不误报', () => {
  const cw = makeValidCourseware()
  cw.nodes[0].action = [{ name: '例-审题', at: '例题' }]
  assert.deepEqual(checkCourseware(cw).filter((v) => v.level === 'hard'), [])
})
