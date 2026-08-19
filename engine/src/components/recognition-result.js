// 练习题作答卡 — 宿主负责拍照/OCR/语音，课件只请求和回显结果
;(function () {
  var CAMERA_SVG = '<svg viewBox="0 0 16 16" width="16" height="16" focusable="false">' +
    '<path d="M5.2 4.6l.9-1.4h3.8l.9 1.4H13a1 1 0 011 1v6.2a1 1 0 01-1 1H3a1 1 0 01-1-1V5.6a1 1 0 011-1h2.2z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/>' +
    '<circle cx="8" cy="8.4" r="2.15" fill="none" stroke="currentColor" stroke-width="1.3"/>' +
    '</svg>'
  var MIC_SVG = '<svg viewBox="0 0 16 16" width="16" height="16" focusable="false">' +
    '<rect x="6" y="2.2" width="4" height="7.2" rx="2" fill="none" stroke="currentColor" stroke-width="1.3"/>' +
    '<path d="M4.2 8.6a3.8 3.8 0 007.6 0M8 12.4V14M5.4 14h5.2" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>' +
    '</svg>'

  function createActionButton(modifier, iconSvg, label, onClick) {
    var button = document.createElement('button')
    button.type = 'button'
    button.className = 'cc-photo-answer-button cc-photo-answer-button--' + modifier
    var icon = document.createElement('span')
    icon.className = 'cc-photo-answer-button-icon'
    icon.setAttribute('aria-hidden', 'true')
    icon.innerHTML = iconSvg
    var text = document.createElement('span')
    text.className = 'cc-photo-answer-button-label'
    text.textContent = label
    button.appendChild(icon)
    button.appendChild(text)
    button.addEventListener('click', function () {
      if (typeof onClick === 'function') onClick()
    })
    return button
  }

  function create(handlers) {
    handlers = handlers || {}
    var onPhotoRequest = typeof handlers === 'function' ? handlers : handlers.onPhotoRequest
    var onVoiceRequest = handlers.onVoiceRequest

    var card = document.createElement('section')
    card.className = 'cc-photo-answer'
    card.setAttribute('aria-label', '作答结果')

    var title = document.createElement('div')
    title.className = 'cc-photo-answer-title'
    title.textContent = '作答结果'

    var body = document.createElement('div')
    body.className = 'cc-photo-answer-content'

    var actions = document.createElement('div')
    actions.className = 'cc-photo-answer-actions'

    actions.appendChild(createActionButton('photo', CAMERA_SVG, '拍照上传', onPhotoRequest))
    actions.appendChild(createActionButton('voice', MIC_SVG, '说一说', onVoiceRequest))
    body.appendChild(actions)
    card.appendChild(title)
    card.appendChild(body)
    return card
  }

  function showResult(card, content) {
    if (!card) return false
    var body = card.querySelector('.cc-photo-answer-content')
    if (!body) return false
    body.textContent = String(content == null ? '' : content)
    card.classList.add('is-result-shown')
    if (window.AIClassLatex) AIClassLatex.render(body)
    return true
  }

  window.AIClassPhotoAnswer = {
    create: create,
    showResult: showResult
  }
})()
