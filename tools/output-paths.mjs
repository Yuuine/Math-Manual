import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/** Monorepo-level locations shared by all profile engines. */
export const platformRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
export const outputRoot = path.join(platformRoot, '_output_')
export const distRoot = path.join(platformRoot, 'dist')

export function outputCourseDir(grade, courseId) {
  return path.join(outputRoot, String(grade), courseId)
}

export function outputLessonDir(grade, courseId, problemId) {
  return path.join(outputCourseDir(grade, courseId), problemId)
}

/**
 * dist/{grade}/{lesson}/{grade}-{lesson}-{difficulty}star/
 * 例：dist/4/1/4-1-3star
 */
export function distCourseDir(grade, lesson, leafId) {
  return path.join(distRoot, String(grade), String(lesson), String(leafId))
}

export function inferDifficulty(plan) {
  if (plan && plan.difficulty != null && plan.difficulty !== '') {
    var n = Number(plan.difficulty)
    if (isFinite(n) && n >= 1) return n
  }
  var id = String((plan && (plan.courseId || plan.id)) || '')
  var m = id.match(/(\d+)\s*star/i)
  return m ? Number(m[1]) : 1
}

export function inferLesson(plan, sourceDir) {
  if (plan && plan.lesson != null && plan.lesson !== '') {
    var n = Number(plan.lesson)
    if (isFinite(n) && n >= 1) return n
  }
  var id = String((plan && (plan.courseId || plan.id)) || '')
  var m = id.match(/(?:^|[-_])c(\d+)(?:[-_]|$)/i) || id.match(/课次(\d+)/)
  if (m) return Number(m[1])
  if (sourceDir) {
    var parent = path.basename(path.dirname(sourceDir))
    var pm = parent.match(/^(\d+)$/) || parent.match(/^c(\d+)$/i)
    if (pm) return Number(pm[1])
  }
  return 1
}

/** 从 plan.json 解析 dist 三段：grade / lesson / leaf（如 4-1-3star） */
export function resolveDistParts(plan, sourceDir) {
  var grade = plan && plan.grade != null ? String(plan.grade) : '0'
  var lesson = inferLesson(plan, sourceDir)
  var difficulty = inferDifficulty(plan)
  var leafId = grade + '-' + lesson + '-' + difficulty + 'star'
  return {
    grade: grade,
    lesson: lesson,
    difficulty: difficulty,
    leafId: leafId,
    out: distCourseDir(grade, lesson, leafId)
  }
}

/** 按 courseId 在 _output_/{grade}/{courseId}/ 中定位已注册课程（grade 未知，需扫描）。 */
export function findOutputCourseDir(courseId) {
  if (!fs.existsSync(outputRoot)) return null
  for (const g of fs.readdirSync(outputRoot, { withFileTypes: true })) {
    if (!g.isDirectory()) continue
    const dir = path.join(outputRoot, g.name, courseId)
    if (fs.existsSync(path.join(dir, 'plan.json')) ||
        fs.existsSync(path.join(dir, 'course.json'))) return dir
  }
  return null
}
