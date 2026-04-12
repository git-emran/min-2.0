const electron = require('electron')
const fs = require('fs')
const EventEmitter = require('events')

function getGlobalArgs () {
  const args = {}

  process.argv.forEach(function (arg) {
    if (!arg.startsWith('--')) {
      return
    }

    const segments = arg.split('=')
    const key = segments[0].replace('--', '')
    const value = segments.slice(1).join('=')
    args[key] = value
  })

  return args
}

function getPlatformType () {
  if (process.platform === 'darwin') {
    return 'mac'
  }

  if (process.platform === 'win32') {
    return 'windows'
  }

  return 'linux'
}

window.globalArgs = getGlobalArgs()
window.windowId = window.globalArgs['window-id']
window.electron = electron
window.fs = fs
window.EventEmitter = EventEmitter
window.ipc = electron.ipcRenderer
window.platformType = getPlatformType()
