let quickScore
try {
  quickScore = require('../util/quickScore.js')
} catch (e) {
  try {
    quickScore = require('util/quickScore.js')
  } catch (e2) {}
}

if (typeof window !== 'undefined' && quickScore) {
  window.quickScore = window.quickScore || {}
  if (typeof window.quickScore.quickScore === 'function' && typeof window.quickScore.jsQuickScore !== 'function') {
    window.quickScore.jsQuickScore = window.quickScore.quickScore
  }
  window.quickScore.quickScore = quickScore.quickScore
  window.quickScore.quickScoreBatch = quickScore.quickScoreBatch
}
