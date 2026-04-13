const assert = require('assert')
const path = require('path')

const parser = require('../ext/abp-filter-parser-modified/abp-filter-parser.js')

let native = null
try {
  native = require(path.join(__dirname, '..', 'native', 'build', 'Release', 'abp_match_cache.node'))
} catch (e) {
  console.log('native abp_match_cache addon not found; build it with `npm run buildNative` to run this verification.')
  process.exit(0)
}

native.init(10)
native.clear()

const filters = {}
parser.parse(
  [
    '||ads.example.com^$script,third-party',
    '||track.example.com^$xmlhttprequest',
    '@@||ads.example.com/allow.js$script'
  ].join('\n'),
  filters
)

function matches (url, contextParams) {
  return parser.matches(filters, url, contextParams)
}

function cachedMatches (key, url, contextParams) {
  const cached = native.get(key)
  if (cached === 0) return false
  if (cached === 1) return true

  const value = matches(url, contextParams)
  native.set(key, value)
  return value
}

const cases = [
  {
    url: 'https://ads.example.com/ad.js',
    context: { domain: 'example.com', elementType: 'script' }
  },
  {
    url: 'https://ads.example.com/allow.js',
    context: { domain: 'example.com', elementType: 'script' }
  },
  {
    url: 'https://track.example.com/pixel',
    context: { domain: 'example.com', elementType: 'xmlhttprequest' }
  },
  {
    url: 'https://cdn.example.com/app.js',
    context: { domain: 'example.com', elementType: 'script' }
  }
]

cases.forEach((c) => {
  const key = `2|${c.context.domain}|${c.context.elementType}|${c.url.toLowerCase()}`
  const expected = matches(c.url, c.context)
  const actual1 = cachedMatches(key, c.url, c.context)
  const actual2 = cachedMatches(key, c.url, c.context) // ensure cache hit path

  assert.strictEqual(actual1, expected, `Mismatch (populate) for ${c.url}`)
  assert.strictEqual(actual2, expected, `Mismatch (hit) for ${c.url}`)
})

console.log('OK: native ABP cache wrapper preserves match results for test cases.')

