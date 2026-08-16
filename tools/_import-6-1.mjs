import fs from 'node:fs'
import path from 'node:path'

function extractSpecs(figureJs) {
  const start = figureJs.indexOf('window.FIGURE_SPECS')
  if (start < 0) throw new Error('FIGURE_SPECS not found')
  const jsonStart = figureJs.indexOf('[', start)
  const jsonEnd = figureJs.indexOf('];', jsonStart)
  if (jsonStart < 0 || jsonEnd < 0) throw new Error('FIGURE_SPECS array not found')
  return JSON.parse(figureJs.slice(jsonStart, jsonEnd + 1))
}

function writeProblemMd(dir, plan) {
  const src = plan.problem_source || []
  const ex = src.find((p) => p.flow_id === 'flow_1') || src[0]
  const pr = src.find((p) => p.flow_id === 'flow_3')
  let md = '# ' + (plan.title || '') + '\n\n'
  function block(title, item) {
    if (!item) return
    md += '## ' + title + '\n\n' + String(item.stem || '') + '\n\n'
    ;(item.images || []).forEach((img) => {
      const name = path.basename(typeof img === 'string' ? img : img.url || '')
      if (name) md += '![](' + name + ')\n\n'
    })
    md += '**答案：** ' + String(item.answer_short || '') + '\n\n'
    md += String(item.answer_detail || '') + '\n\n'
  }
  block('例题', ex)
  block('练习', pr)
  fs.writeFileSync(path.join(dir, plan.courseId + '.md'), md, 'utf8')
}

function importCourse(srcRoot, courseId) {
  const outDir = path.join('D:/doushen/AIClass_math/Math-Manual/_output_/6', courseId)
  fs.mkdirSync(path.join(outDir, 'assets'), { recursive: true })
  const plan = JSON.parse(fs.readFileSync(path.join(srcRoot, 'courseware/plan.json'), 'utf8'))
  fs.writeFileSync(path.join(outDir, 'plan.json'), JSON.stringify(plan, null, 2) + '\n')
  const figureJs = fs.readFileSync(path.join(srcRoot, 'courseware/runtime/lesson/modules/figure.js'), 'utf8')
  const specs = extractSpecs(figureJs)
  fs.writeFileSync(path.join(outDir, 'figure-spec.json'), JSON.stringify({ specs }, null, 2) + '\n')
  const assetsSrc = path.join(srcRoot, 'courseware/runtime/assets')
  if (fs.existsSync(assetsSrc)) {
    for (const name of fs.readdirSync(assetsSrc)) {
      const from = path.join(assetsSrc, name)
      if (fs.statSync(from).isFile()) fs.copyFileSync(from, path.join(outDir, 'assets', name))
    }
  }
  writeProblemMd(outDir, plan)
  console.log('imported', courseId, 'assets', fs.readdirSync(path.join(outDir, 'assets')).join(','))
}

importCourse('d:/doushenfeishu/6-1-2star', '6-1-2star')
importCourse('d:/doushenfeishu/6-1-3star', '6-1-3star')
