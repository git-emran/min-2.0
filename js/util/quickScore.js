const path = require('path')

let nativeBinding = null

const nativeCandidates = [
  path.join(__dirname, '../../native/build/Release/quick_score.node')
]

for (const candidate of nativeCandidates) {
  try {
    nativeBinding = require(candidate)
    break
  } catch (e) {}
}

let jsScorer = null
function getJSScorer () {
  if (jsScorer) {
    return jsScorer
  }

  try {
    jsScorer = require('quick-score').quickScore
  } catch (e) {}

  if (!jsScorer && typeof window !== 'undefined' && window.quickScore) {
    if (typeof window.quickScore.jsQuickScore === 'function') {
      jsScorer = window.quickScore.jsQuickScore
    } else if (typeof window.quickScore.quickScore === 'function') {
      jsScorer = window.quickScore.quickScore
    }
  }

  return jsScorer
}

function looksSafeForNative (string, query) {
  // Native scorer is optimized for the browser's hot paths where inputs are
  // already normalized lowercase ASCII (URLs, preformatted titles).
  // Fall back to the JS library for uppercase or non-ASCII to preserve behavior.
  if (!nativeBinding?.quickScore) {
    return false
  }
  if (typeof string !== 'string' || typeof query !== 'string') {
    return false
  }
  if (/[A-Z]/.test(string) || /[A-Z]/.test(query)) {
    return false
  }
  if (/[\u0080-\uFFFF]/.test(string) || /[\u0080-\uFFFF]/.test(query)) {
    return false
  }
  return true
}

function quickScore (string, query) {
  if (looksSafeForNative(string, query)) {
    try {
      return nativeBinding.quickScore(string, query)
    } catch (e) {}
  }

  const scorer = getJSScorer()
  if (!scorer) {
    return 0
  }
  return scorer(string, query)
}

function quickScoreBatch (strings, query) {
  if (nativeBinding?.quickScoreBatch &&
    Array.isArray(strings) &&
    typeof query === 'string' &&
    strings.every(s => looksSafeForNative(s, query))
  ) {
    try {
      return nativeBinding.quickScoreBatch(strings, query)
    } catch (e) {}
  }

  return strings.map(s => quickScore(s, query))
}

module.exports = {
  quickScore,
  quickScoreBatch
}
