const assert = require('assert')
const path = require('path')

const jsQuickScore = require('quick-score').quickScore

let native = null
try {
  native = require(path.join(__dirname, '..', 'native', 'build', 'Release', 'quick_score.node'))
} catch (e) {}

if (!native) {
  console.log('native quick_score addon not found; run `npm run buildNative` first')
  process.exit(0)
}

function approxEqual (a, b) {
  return Math.abs(a - b) < 1e-10
}

const cases = [
  ['google', 'go'],
  ['https://example.com/path', 'exa'],
  ['min browser', 'mb'],
  ['foo bar baz', 'fbb'],
  ['something-with-dashes', 'swd'],
  ['abc', 'abcd'],
  ['abc', '']
]

for (let i = 0; i < 200; i++) {
  const s = Math.random().toString(36).slice(2)
  const q = s.slice(0, Math.max(1, Math.floor(Math.random() * 4)))
  cases.push([s, q])
}

for (const [s, q] of cases) {
  const string = String(s).toLowerCase()
  const query = String(q).toLowerCase()
  const expected = jsQuickScore(string, query)
  const actual = native.quickScore(string, query)

  assert(
    approxEqual(actual, expected),
    `Mismatch for (${string}, ${query}): native=${actual} js=${expected}`
  )
}

console.log('native quick_score parity: OK')

