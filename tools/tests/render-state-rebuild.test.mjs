import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const src = fs.readFileSync(
  path.join(root, 'engine/src/core/timeline/render-state.js'),
  'utf8'
)

test('rebuildToIndex 按拍回放差分，不把累计块一次性塞进最后引导槽', () => {
  const start = src.indexOf('function rebuildToIndex')
  const end = src.indexOf('function renderState')
  assert.ok(start >= 0 && end > start, 'rebuildToIndex missing')
  const fn = src.slice(start, end)
  assert.match(fn, /deltaBlocks\(prevByContainer/)
  assert.match(fn, /appendOpts\(state,\s*true,\s*false\)/)
  assert.doesNotMatch(fn, /appendOpts\(last,/)
  assert.doesNotMatch(fn, /accumulateBlocksForContainer/)
})
