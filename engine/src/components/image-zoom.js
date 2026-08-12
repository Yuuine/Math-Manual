// 图片放大查看 — AIClassImageZoom：fixed 全屏覆盖层，点击遮罩 / Esc / 关闭按钮关闭
;(function () {
  var overlay = null
  var imgEl = null
  var closeBtn = null
  var onKeyDown = null
  var prevBodyOverflow = null

  function ensure() {
    if (overlay) return
    overlay = document.createElement('div')
    overlay.className = 'aic-image-zoom'
    overlay.setAttribute('role', 'dialog')
    overlay.setAttribute('aria-modal', 'true')
    overlay.setAttribute('aria-label', '图片放大查看')

    imgEl = document.createElement('img')
    imgEl.className = 'aic-image-zoom__img'
    imgEl.alt = ''

    closeBtn = document.createElement('button')
    closeBtn.type = 'button'
    closeBtn.className = 'aic-image-zoom__close'
    closeBtn.setAttribute('aria-label', '关闭')
    closeBtn.innerHTML = '<span aria-hidden="true">×</span>'

    overlay.appendChild(imgEl)
    overlay.appendChild(closeBtn)

    overlay.addEventListener('click', function () {
      close()
    })
    closeBtn.addEventListener('click', function (event) {
      event.stopPropagation()
      close()
    })
    document.body.appendChild(overlay)
  }

  function onKey(event) {
    if (event.keyCode === 27 || event.key === 'Escape') close()
  }

  function open(src, alt) {
    if (!src) return
    ensure()
    imgEl.src = src
    imgEl.alt = alt || ''
    prevBodyOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    overlay.classList.add('aic-image-zoom--open')
    if (!onKeyDown) {
      onKeyDown = onKey
      document.addEventListener('keydown', onKeyDown)
    }
  }

  function close() {
    if (!overlay || !overlay.classList.contains('aic-image-zoom--open')) return
    overlay.classList.remove('aic-image-zoom--open')
    document.body.style.overflow = prevBodyOverflow || ''
    prevBodyOverflow = null
    if (onKeyDown) {
      document.removeEventListener('keydown', onKeyDown)
      onKeyDown = null
    }
  }

  window.AIClassImageZoom = { open: open, close: close }
})()
