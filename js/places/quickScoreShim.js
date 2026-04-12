const quickScore = require('util/quickScore.js')

if (typeof window !== 'undefined') {
  window.quickScore = window.quickScore || {}
  if (typeof window.quickScore.quickScore === 'function' && typeof window.quickScore.jsQuickScore !== 'function') {
    window.quickScore.jsQuickScore = window.quickScore.quickScore
  }
  window.quickScore.quickScore = quickScore.quickScore
  window.quickScore.quickScoreBatch = quickScore.quickScoreBatch
}
