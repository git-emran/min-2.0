const assert = require('assert')
const path = require('path')

const globalParamsToRemove = [
  'msclkid',
  'gclid',
  'dclid',
  'fbclid',
  'yclid',
  '_openstat',
  'icid',
  'igshid',
  'mc_eid'
]

const siteParamsToRemove = {
  'www.amazon.com': [
    '_ref',
    'ref_',
    'pd_rd_r',
    'pd_rd_w',
    'pf_rd_i',
    'pf_rd_m',
    'pf_rd_p',
    'pf_rd_r',
    'pf_rd_s',
    'pf_rd_t',
    'pd_rd_wg'
  ],
  'www.ebay.com': [
    '_trkparms'
  ]
}

const keys = new Set(globalParamsToRemove)
Object.values(siteParamsToRemove).forEach(list => list.forEach(k => keys.add(k)))
const keysArray = Array.from(keys)

function hasRemovableTrackingParamsFastJS (url) {
  if (typeof url !== 'string') {
    return true
  }

  const q = url.indexOf('?')
  if (q === -1) {
    return false
  }

  const hash = url.indexOf('#', q + 1)
  const query = url.substring(q + 1, hash === -1 ? url.length : hash)

  if (!query) {
    return false
  }

  if (query.includes('%')) {
    return true
  }

  const parts = query.split('&')
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]
    if (!part) {
      continue
    }
    const eq = part.indexOf('=')
    const key = eq === -1 ? part : part.substring(0, eq)
    if (keys.has(key)) {
      return true
    }
  }
  return false
}

let native = null
try {
  native = require(path.join(__dirname, '..', 'native', 'build', 'Release', 'tracking_params.node'))
} catch (e) {
  console.log('native tracking_params addon not found; build it with `npm run buildNative` to run this verification.')
  process.exit(0)
}

assert(typeof native.init === 'function', 'native.init missing')
assert(typeof native.hasRemovableTrackingParams === 'function', 'native.hasRemovableTrackingParams missing')

native.init(keysArray)

const cases = [
  'https://example.com/',
  'https://example.com/?',
  'https://example.com/?a=1&b=2',
  'https://example.com/?gclid=1',
  'https://example.com/?fbclid=abc#fragment',
  'https://example.com/?xgclid=1',
  'https://example.com/?gclid2=1',
  'https://example.com/?gclid',
  'https://example.com/?a=1&gclid=2&b=3',
  'https://example.com/?a=1&b=2&gclid=3',
  'https://example.com/?a=1&b=2#gclid=3',
  'https://example.com/?pd_rd_r=1',
  'https://example.com/?_trkparms=1',
  // percent-encoding should conservatively return true
  'https://example.com/?%67clid=1',
  'https://example.com/?a=%67clid'
]

cases.forEach((url) => {
  const expected = hasRemovableTrackingParamsFastJS(url)
  const actual = native.hasRemovableTrackingParams(url)
  assert.strictEqual(actual, expected, `Mismatch for ${url}: expected ${expected}, got ${actual}`)
})

console.log('OK: native tracking param detector matches JS fast-path for test cases.')

