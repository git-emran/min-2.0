/* send bookmarks data.  */

// Running a full DOM traversal on every navigation can be expensive, especially on SPAs
// that call history.pushState frequently. Keep extraction rate-limited and avoid forced
// layouts (offsetWidth/getClientRects) during traversal.
const maxExtractedTextLength = 200000
const minTimeBetweenExtractions = 5000

let lastExtractionTime = 0
let extractionTimeout = null

function extractPageText (doc, win) {
  // Use a stack (LIFO) instead of shift/unshift to avoid O(n^2) array churn on large DOMs.
  var stack = [].slice.call(doc.body.childNodes)
  var textParts = []
  var collectedChars = 0

  var ignore = 'link, style, script, noscript, .hidden, .visually-hidden, .visuallyhidden, [role=presentation], [hidden], [aria-hidden="true"], [style*="display:none"], [style*="display: none"], [style*="visibility:hidden"], [style*="visibility: hidden"], .ad, .dialog, .modal, select, svg, details:not([open]), header, nav, footer'

  while (stack.length) {
    var node = stack.pop()

    // if the node should be ignored, skip it and all of it's child nodes
    if (node.matches && node.matches(ignore)) {
      continue
    }

    // if the node is a text node, add it to the list of text nodes

    if (node.nodeType === 3) {
      var content = node.textContent
      if (content) {
        textParts.push(content)
        collectedChars += content.length + 1
        if (collectedChars >= maxExtractedTextLength) {
          break
        }
      }
      continue
    }

    // otherwise, add the node's text nodes to the list of text, and the other child nodes to the list of nodes to check
    var childNodes = node.childNodes
    var cnl = childNodes.length

    for (var i = cnl - 1; i >= 0; i--) {
      var childNode = childNodes[i]
      stack.push(childNode)
    }
  }

  var text = textParts.join(' ')

  // special meta tags

  var mt = doc.head.querySelector('meta[name=description]')

  if (mt) {
    text += ' ' + mt.content
  }

  text = text.trim()

  text = text.replace(/[\n\t]/g, ' ') // remove useless newlines/tabs that increase filesize

  text = text.replace(/\s{2,}/g, ' ') // collapse multiple spaces into one
  return text
}

function getPageData (cb) {
  // requestAnimationFrame helps ensure we don't compete with input/paint work.
  requestAnimationFrame(function () {
    var text = extractPageText(document, window)

    // try to also extract text for same-origin iframes (such as the reader mode frame)

    var frames = document.querySelectorAll('iframe')

    for (var x = 0; x < frames.length; x++) {
      try {
        text += '. ' + extractPageText(frames[x].contentDocument, frames[x].contentWindow)
      } catch (e) {}
    }

    // limit the amount of text that is collected

    text = text.substring(0, maxExtractedTextLength)

    cb({
      extractedText: text
    })
  })
}

function schedulePageDataSend () {
  // Debounce + rate-limit extraction to avoid repeated work on SPAs.
  const now = Date.now()
  const msSinceLast = now - lastExtractionTime
  const wait = Math.max(500, minTimeBetweenExtractions - msSinceLast)

  clearTimeout(extractionTimeout)
  extractionTimeout = setTimeout(function () {
    extractionTimeout = null
    lastExtractionTime = Date.now()

    const run = function () {
      getPageData(function (data) {
        ipc.send('pageData', data)
      })
    }

    if (typeof requestIdleCallback === 'function') {
      requestIdleCallback(run, { timeout: 2500 })
    } else {
      setTimeout(run, 0)
    }
  }, wait)
}

// send the data when the page loads
if (process.isMainFrame) {
  window.addEventListener('load', function (e) {
    schedulePageDataSend()
  })

  setTimeout(function () {
    // https://stackoverflow.com/a/52809105
    electron.webFrame.executeJavaScript(`
      history.pushState = ( f => function pushState(){
        var ret = f.apply(this, arguments);
        window.postMessage('_minInternalLocationChange', '*')
        return ret;
    })(history.pushState);
    
    history.replaceState = ( f => function replaceState(){
        var ret = f.apply(this, arguments);
        window.postMessage('_minInternalLocationReplacement', '*')
        return ret;
    })(history.replaceState);
  `)
  }, 0)

  window.addEventListener('message', function (e) {
    if (e.data === '_minInternalLocationChange' || e.data === '_minInternalLocationReplacement') {
      schedulePageDataSend()
    }
  })
}
