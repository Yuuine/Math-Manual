// 统一 standard-plan schema：以 figure 基为底，按 profile 应用约束开关。
// 产出与三仓既有 standard-plan.schema.json 完全一致，消除三份副本。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const base = JSON.parse(
  fs.readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), 'standard-plan.schema.json'),
    'utf8'
  )
)

const RETAIN_PUSH_ONE_OF = {
  oneOf: [
    { type: 'boolean' },
    { type: 'array', items: { type: 'string', minLength: 1 } }
  ]
}
const PUSH_TEXT_PROPS = {
  class: { type: 'string' },
  tag: { type: 'string' },
  tagTone: { type: 'string' },
  lead: { type: 'string' },
  leadHtml: { type: 'boolean' },
  hangAfterTag: { type: ['boolean', 'string'] }
}

function clone(obj) {
  return JSON.parse(JSON.stringify(obj))
}

/** @param {'figure'|'text'|'calculation'} profile */
export function buildStandardPlanSchema(profile) {
  const s = clone(base)
  if (profile === 'figure') return s

  if (profile === 'text') {
    s.allOf = [
      { not: { required: ['figureTemplate'] } },
      { not: { required: ['problemBrief'] } }
    ]
    s.properties.layout = { const: 'text-only' }
    s.properties.guidanceLayout = { const: 'interleaved' }
    delete s.properties.source
    delete s.properties.figureTemplate
    delete s.properties.problemBrief
    s.properties.guidanceChain = {
      type: 'array',
      items: {
        type: 'object',
        required: ['title'],
        additionalProperties: false,
        properties: { title: { type: 'string' } }
      }
    }
  } else if (profile === 'calculation') {
    s.required = ['schemaVersion', 'id', 'title', 'layout', 'steps']
    s.allOf = [
      { not: { required: ['figureTemplate'] } },
      { not: { required: ['problemBrief'] } },
      { not: { required: ['guidanceChain'] } },
      { not: { required: ['guidanceLayout'] } }
    ]
    s.properties.layout = { const: 'top-split' }
    delete s.properties.source
    delete s.properties.figureTemplate
    delete s.properties.problemBrief
    delete s.properties.guidanceChain
    delete s.properties.guidanceLayout
  } else {
    throw new Error(`Unknown profile: ${profile}`)
  }

  const step = s.properties.steps.items
  step.allOf = profile === 'text'
    ? [
        { not: { required: ['figure'] } },
        { not: { required: ['problemBrief'] } },
        { not: { required: ['guidanceDesc'] } }
      ]
    : [
        { not: { required: ['figure'] } },
        { not: { required: ['problemBrief'] } },
        { not: { required: ['guidanceDesc'] } },
        { not: { required: ['group'] } },
        { not: { required: ['guidanceSub'] } }
      ]
  delete step.properties.figure
  delete step.properties.problemBrief
  if (profile === 'calculation') {
    delete step.properties.group
    delete step.properties.guidanceSub
  }
  step.properties.retainPush = RETAIN_PUSH_ONE_OF

  const pushProps = step.properties.push.items.properties
  pushProps.region = { enum: ['top', 'left', 'right', 'main'] }
  for (const [k, v] of Object.entries(PUSH_TEXT_PROPS)) pushProps[k] = v

  return s
}
