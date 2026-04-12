/* imports common modules */

var electron = require('electron')
var ipc = electron.ipcRenderer

var propertiesToClone = ['deltaX', 'deltaY', 'metaKey', 'ctrlKey', 'defaultPrevented', 'clientX', 'clientY']

function cloneEvent (e) {
  var obj = {}

  for (var i = 0; i < propertiesToClone.length; i++) {
    obj[propertiesToClone[i]] = e[propertiesToClone[i]]
  }
  return obj
}

// workaround for Electron bug
setTimeout(function () {
  /* Used for swipe gestures */
  var pendingWheelEvent = null
  var wheelFlushScheduled = false

  function flushWheelEvent () {
    wheelFlushScheduled = false
    if (!pendingWheelEvent) {
      return
    }
    ipc.send('wheel-event', pendingWheelEvent)
    pendingWheelEvent = null
  }

  window.addEventListener('wheel', function (e) {
    // Coalesce wheel events to at most one IPC message per frame.
    // This reduces IPC overhead during high-frequency scrolls.
    if (pendingWheelEvent) {
      pendingWheelEvent.deltaX += e.deltaX
      pendingWheelEvent.deltaY += e.deltaY
      pendingWheelEvent.metaKey = pendingWheelEvent.metaKey || e.metaKey
      pendingWheelEvent.ctrlKey = pendingWheelEvent.ctrlKey || e.ctrlKey
      pendingWheelEvent.defaultPrevented = pendingWheelEvent.defaultPrevented || e.defaultPrevented
      pendingWheelEvent.clientX = e.clientX
      pendingWheelEvent.clientY = e.clientY
    } else {
      pendingWheelEvent = cloneEvent(e)
    }

    if (!wheelFlushScheduled) {
      wheelFlushScheduled = true
      requestAnimationFrame(flushWheelEvent)
    }
  })

  var scrollTimeout = null

  window.addEventListener('scroll', function () {
    clearTimeout(scrollTimeout)
    scrollTimeout = setTimeout(function () {
      ipc.send('scroll-position-change', Math.round(window.scrollY))
    }, 200)
  })
}, 0)

/* Used for picture in picture item in context menu */
ipc.on('getContextMenuData', function (event, data) {
  // check for video element to show picture-in-picture menu
  var hasVideo = Array.from(document.elementsFromPoint(data.x, data.y)).some(el => el.tagName === 'VIDEO')
  ipc.send('contextMenuData', { hasVideo })
})

ipc.on('enterPictureInPicture', function (event, data) {
  var videos = Array.from(document.elementsFromPoint(data.x, data.y)).filter(el => el.tagName === 'VIDEO')
  if (videos[0]) {
    videos[0].requestPictureInPicture()
  }
})

window.addEventListener('message', function (e) {
  if (!e.origin.startsWith('min://')) {
    return
  }

  if (e.data?.message === 'showCredentialList') {
    ipc.send('showCredentialList')
  }

  if (e.data?.message === 'showUserscriptDirectory') {
    ipc.send('showUserscriptDirectory')
  }

  if (e.data?.message === 'downloadFile') {
    ipc.send('downloadFile', e.data.url)
  }
})
