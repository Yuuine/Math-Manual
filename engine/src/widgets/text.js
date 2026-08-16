// 段落与小节标题 widget — push type: text | section
;(function () {
  function assetBase() {
    var boot = window.__COURSE_BOOT || {}
    var lesson = boot.lessonRoot || 'lesson'
    if (typeof lesson !== 'string' || lesson.indexOf('/') < 0) return ''
    return lesson.replace(/\/lesson$/, '')
  }

  // html 行内 `src="assets/..."` → 拼资源基路径；其余（http/data/相对 lesson）原样
  function resolveAssetSrc(src) {
    if (!src || typeof src !== 'string') return src
    var trimmed = src.replace(/^\s+/, '')
    if (trimmed.indexOf('assets/') !== 0) return src
    var base = assetBase()
    return base ? base + '/' + trimmed : trimmed
  }

  function bindImageZoom(img) {
    img.addEventListener('click', function () {
      if (window.AIClassImageZoom && typeof window.AIClassImageZoom.open === 'function') {
        window.AIClassImageZoom.open(img.src, img.alt)
      }
    })
  }

  // 渲染后处理 html 行内图片：解析 assets/ 资源基路径并绑定放大
  function hydrateImages(root) {
    var imgs = root.querySelectorAll('img[src]')
    for (var i = 0; i < imgs.length; i++) {
      var img = imgs[i]
      var src = img.getAttribute('src')
      var resolved = resolveAssetSrc(src)
      if (resolved !== src) img.setAttribute('src', resolved)
      bindImageZoom(img)
    }
  }

  function escapeRegExp(str) {
    return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }

  // 按 highlights 子串包 <mark class="lf-text-highlight">；无命中则纯文本
  function appendHighlightedText(lineEl, text, highlights) {
    var raw = AIClassWidgetRegistry.text(text)
    var list = []
    if (Object.prototype.toString.call(highlights) === '[object Array]') {
      for (var i = 0; i < highlights.length; i++) {
        if (highlights[i] != null && String(highlights[i]) !== '') list.push(String(highlights[i]))
      }
    }
    if (!list.length) {
      lineEl.textContent = raw
      return
    }
    // 长串优先，避免短串先切碎
    list.sort(function (a, b) { return b.length - a.length })
    var pattern = list.map(escapeRegExp).join('|')
    var re = new RegExp('(' + pattern + ')', 'g')
    var parts = raw.split(re)
    for (var p = 0; p < parts.length; p++) {
      var part = parts[p]
      if (!part) continue
      var hit = false
      for (var h = 0; h < list.length; h++) {
        if (part === list[h]) { hit = true; break }
      }
      if (hit) {
        var mark = document.createElement('mark')
        mark.className = 'lf-text-highlight'
        mark.textContent = part
        lineEl.appendChild(mark)
      } else {
        lineEl.appendChild(document.createTextNode(part))
      }
    }
  }

  function renderLine(el, value, highlights) {
    var line = typeof value === 'object' && value ? value : { text: value }
    var tagName = line.block ? 'div' : 'p'
    var lineEl = document.createElement(tagName)
    lineEl.className = 'lf-text-line' + (line.role ? ' lf-text-' + line.role : '')
    var content = line.text != null ? line.text : line.value
    var lineHighlights = line.highlights != null ? line.highlights : highlights
    if (line.html) {
      lineEl.innerHTML = AIClassWidgetRegistry.text(content)
      hydrateImages(lineEl)
    } else {
      appendHighlightedText(lineEl, content, lineHighlights)
    }
    el.appendChild(lineEl)
  }

  AIClassWidgetRegistry.register('text', function (el, block) {
    el.innerHTML = ''
    if (block.size === 'large') {
      el.style.fontSize = 'var(--lf-scale-hero)'
      el.style.fontWeight = '600'
    } else {
      el.style.fontSize = ''
      el.style.fontWeight = ''
    }
    if (block.hangAfterTag) {
      el.classList.add('lf-text--hang-after-tag')
    }
    var lines = block.lines || (block.text ? [block.text] : [])
    var highlights = block.highlights || null
    lines.forEach(function (line) { renderLine(el, line, highlights) })
    if (window.AIClassLatex && (block.region === 'top' || /\bstem\b/.test(String(block.class || '')))) {
      window.AIClassLatex.render(el)
    }
  })

  AIClassWidgetRegistry.register('section', function (el, block) {
    el.innerHTML = ''
    el.classList.add('lf-section')
    var hasLead = block.lead != null && String(block.lead) !== ''
    var hasTitle = !!(block.title || (block.text && !hasLead))
    if (!hasTitle && !hasLead && block.tag) el.classList.add('lf-section--badge-only')
    if (hasLead) el.classList.add('lf-section--lead')
    if (block.tagTone) el.classList.add('lf-section--' + block.tagTone)
    var tag = null
    if (block.tag) {
      tag = document.createElement('span')
      tag.className = 'lf-section-tag'
      if (block.tagTone) tag.classList.add('lf-section-tag--' + block.tagTone)
      tag.textContent = block.tag
      el.appendChild(tag)
    }
    if (hasLead) {
      var lead = document.createElement(block.leadHtml ? 'div' : 'span')
      lead.className = 'lf-section-lead'
      if (block.leadHtml) {
        lead.innerHTML = AIClassWidgetRegistry.text(block.lead)
      } else if (block.highlights && block.highlights.length) {
        appendHighlightedText(lead, block.lead, block.highlights)
      } else {
        lead.textContent = block.lead
      }
      el.appendChild(lead)
    }
    if (hasTitle) {
      var title = document.createElement('span')
      title.className = 'lf-section-title'
      if (block.color) title.classList.add('lf-section-title--' + block.color)
      title.textContent = block.title || block.text || ''
      el.appendChild(title)
    }
    ;(block.lines || []).forEach(function (line) { renderLine(el, line) })
    if (window.AIClassLatex) window.AIClassLatex.render(el)
    // 每个 lead section 各自写自身挂行缩进（ask 不依赖同槽 known 先写）
    if (tag && hasLead) {
      var leadEl = el.querySelector('.lf-section-lead')
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          if (!leadEl) return
          el.style.setProperty('--lf-hang-indent', leadEl.offsetLeft + 'px')
          // 【已知】继续写槽级变量，供同槽 hang-after-tag 文本复用
          if (block.tagTone === 'known') {
            var host = el.closest('.cc-guide-slot') || el.parentElement
            if (host) host.style.setProperty('--lf-hang-indent', leadEl.offsetLeft + 'px')
          }
        })
      })
    }
  })
})()
