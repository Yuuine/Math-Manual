// 顶部大题干栏·带图选择题展示 — push type: stem-choice（纯展示，不判题）
// 题干图（可选 stemImage）+ A.B.C.D 四个选项，每个选项字母后紧跟原图，点击图片放大查看。
;(function () {
  function assetBase() {
    // 预览/导出都经 exportCourse，renderIndex 会把 __COURSE_BOOT.lessonRoot 重写为
    // 'courseware/runtime/lesson'；资源拷贝在 'courseware/runtime/assets'，故取 lessonRoot 去 /lesson。
    var boot = window.__COURSE_BOOT || {}
    var lesson = boot.lessonRoot || 'lesson'
    if (typeof lesson !== 'string' || lesson.indexOf('/') < 0) return ''
    return lesson.replace(/\/lesson$/, '')
  }

  function resolveAsset(image) {
    var base = assetBase()
    var src = String(image || '').replace(/^\/+/, '')
    if (!src) return ''
    return base ? base + '/' + src : src
  }

  function bindZoom(img) {
    img.addEventListener('click', function () {
      if (window.AIClassImageZoom && typeof window.AIClassImageZoom.open === 'function') {
        window.AIClassImageZoom.open(img.src, img.alt)
      }
    })
  }

  function createStemImage(block) {
    var stemImage = block && block.stemImage
    if (!stemImage) return null
    var src = resolveAsset(typeof stemImage === 'string' ? stemImage : stemImage.image)
    if (!src) return null

    var wrap = document.createElement('div')
    wrap.className = 'stem-choice__stem'

    var img = document.createElement('img')
    img.className = 'stem-choice__stem-img'
    img.alt = typeof stemImage === 'object' && stemImage.alt != null
      ? String(stemImage.alt)
      : ''
    img.src = src
    bindZoom(img)
    wrap.appendChild(img)
    return wrap
  }

  function createOptionCell(option) {
    var cell = document.createElement('div')
    cell.className = 'stem-choice__opt'

    var label = document.createElement('span')
    label.className = 'stem-choice__label'
    label.textContent = option.label != null ? String(option.label) : ''

    var img = document.createElement('img')
    img.className = 'stem-choice__img'
    img.alt = option.alt != null ? String(option.alt) : (option.label != null ? String(option.label) : '')
    var src = resolveAsset(option.image)
    if (src) img.src = src
    bindZoom(img)

    cell.appendChild(label)
    cell.appendChild(img)
    return cell
  }

  AIClassWidgetRegistry.register('stem-choice', function (el, block) {
    el.innerHTML = ''
    var options = (block && block.options) || []

    var stem = createStemImage(block)
    if (stem) el.appendChild(stem)

    var row = document.createElement('div')
    row.className = 'stem-choice'
    options.forEach(function (option) {
      if (!option) return
      row.appendChild(createOptionCell(option))
    })
    el.appendChild(row)
  })
})()
