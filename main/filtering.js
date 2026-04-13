var defaultFilteringSettings = {
  blockingLevel: 1,
  contentTypes: [],
  exceptionDomains: []
}

var enabledFilteringOptions = {
  blockingLevel: 0,
  contentTypes: [], // script, image
  exceptionDomains: []
}

const globalParamsToRemove = [
  // microsoft
  'msclkid',
  // google
  'gclid',
  'dclid',
  // facebook
  'fbclid',
  // yandex
  'yclid',
  '_openstat',
  // adobe
  'icid',
  // instagram
  'igshid',
  // mailchimp
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

// Optional native helper to avoid expensive URL parsing when no removable
// tracking params are present. This is deliberately conservative: if the fast
// check is uncertain, it returns true so we fall back to the JS URL() behavior.
let nativeTrackingParams = null
try {
  nativeTrackingParams = require(path.join(__dirname, 'native', 'build', 'Release', 'tracking_params.node'))
} catch (e) {}

// Optional native LRU cache for ABP match results (safe acceleration).
// This only memoizes the final allow/block decision for a given request key.
let nativeAbpCache = null
try {
  nativeAbpCache = require(path.join(__dirname, 'native', 'build', 'Release', 'abp_match_cache.node'))
} catch (e) {}

const allTrackingParamsToRemove = (function () {
  const keys = new Set()
  globalParamsToRemove.forEach(k => keys.add(k))
  Object.keys(siteParamsToRemove).forEach(host => {
    siteParamsToRemove[host].forEach(k => keys.add(k))
  })
  return {
    keysArray: Array.from(keys),
    keysSet: keys
  }
})()

if (nativeTrackingParams?.init) {
  try {
    nativeTrackingParams.init(allTrackingParamsToRemove.keysArray)
  } catch (e) {
    nativeTrackingParams = null
  }
}

if (nativeAbpCache?.init) {
  try {
    // Keep memory bounded but large enough to catch repeated resource URLs.
    nativeAbpCache.init(50000)
  } catch (e) {
    nativeAbpCache = null
  }
}

function hasRemovableTrackingParamsFast (url) {
  if (typeof url !== 'string') {
    return true
  }

  if (nativeTrackingParams?.isInitialized?.() && nativeTrackingParams?.hasRemovableTrackingParams) {
    try {
      return nativeTrackingParams.hasRemovableTrackingParams(url)
    } catch (e) {
      // ignore and fall through to JS implementation
    }
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

  // If the query contains percent-encoding, be conservative and fall back to URL().
  // Param names could be encoded, and we don't want to miss removals.
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
    if (allTrackingParamsToRemove.keysSet.has(key)) {
      return true
    }
  }

  return false
}

// for tracking the number of blocked requests
var unsavedBlockedRequests = 0

setInterval(function () {
  if (unsavedBlockedRequests > 0) {
    var current = settings.get('filteringBlockedCount')
    if (!current) {
      current = 0
    }
    settings.set('filteringBlockedCount', current + unsavedBlockedRequests)
    unsavedBlockedRequests = 0
  }
}, 60000)

// electron uses different names for resource types than ABP
// electron: https://github.com/electron/electron/blob/34c4c8d5088fa183f56baea28809de6f2a427e02/shell/browser/net/atom_network_delegate.cc#L30
// abp: https://adblockplus.org/filter-cheatsheet#filter-options
var electronABPElementTypeMap = {
  mainFrame: 'document',
  subFrame: 'subdocument',
  stylesheet: 'stylesheet',
  script: 'script',
  image: 'image',
  object: 'object',
  xhr: 'xmlhttprequest',
  other: 'other' // ?
}

var parser = require('./ext/abp-filter-parser-modified/abp-filter-parser.js')
var parsedFilterData = {}
const webContentsDomainCache = new WeakMap()

function initFilterList () {
  // discard old data if the list is being re-initialized
  parsedFilterData = {}
  if (nativeAbpCache?.clear) {
    try {
      nativeAbpCache.clear()
    } catch (e) {}
  }

  fs.readFile(path.join(__dirname, 'ext/filterLists/easylist+easyprivacy-noelementhiding.txt'),
    'utf8', function (err, data) {
      if (err) {
        return
      }
      parser.parse(data, parsedFilterData)
    }
  )

  fs.readFile(path.join(__dirname, 'ext/filterLists/minFilters.txt'),
    'utf8', function (err, data) {
      if (err) {
        return
      }
      parser.parse(data, parsedFilterData)
    }
  )

  fs.readFile(path.join(app.getPath('userData'), 'customFilters.txt'),
    'utf8', function (err, data) {
      if (!err && data) {
        parser.parse(data, parsedFilterData)
      }
    })
}

function removeWWW (domain) {
  return domain.replace(/^www\./i, '')
}

function requestIsThirdParty (baseDomain, requestURL) {
  baseDomain = removeWWW(baseDomain)
  var requestDomain = removeWWW(parser.getUrlHost(requestURL))

  return !(parser.isSameOriginHost(baseDomain, requestDomain) || parser.isSameOriginHost(requestDomain, baseDomain))
}

function requestDomainIsException (domain) {
  return enabledFilteringOptions.exceptionDomains.includes(removeWWW(domain))
}

function getRequestBaseDomain (details) {
  if (!details.webContentsId) {
    return undefined
  }

  const contents = webContents.fromId(details.webContentsId)
  if (!contents || contents.isDestroyed()) {
    return undefined
  }

  const currentURL = contents.getURL()
  const cached = webContentsDomainCache.get(contents)

  if (cached && cached.url === currentURL) {
    return cached.domain
  }

  const domain = parser.getUrlHost(currentURL)
  webContentsDomainCache.set(contents, {
    url: currentURL,
    domain
  })

  return domain
}

function filterPopups (url) {
  if (!/^https?:\/\//i.test(url)) {
    return true
  }

  const domain = parser.getUrlHost(url)
  if (enabledFilteringOptions.blockingLevel > 0 && !requestDomainIsException(domain)) {
    if (
      enabledFilteringOptions.blockingLevel === 2 ||
      (enabledFilteringOptions.blockingLevel === 1 && requestIsThirdParty(domain, url))
    ) {
      if (parser.matches(parsedFilterData, url, { domain: domain, elementType: 'popup' })) {
        unsavedBlockedRequests++
        return false
      }
    }
  }

  return true
}

function removeTrackingParams (url) {
  if (!hasRemovableTrackingParamsFast(url)) {
    return url
  }
  try {
    var urlObj = new URL(url)
    for (const param of urlObj.searchParams) {
      if (globalParamsToRemove.includes(param[0]) ||
        (siteParamsToRemove[urlObj.hostname] &&
          siteParamsToRemove[urlObj.hostname].includes(param[0]))) {
        urlObj.searchParams.delete(param[0])
      }
    }
    return urlObj.toString()
  } catch (e) {
    console.warn(e)
    return url
  }
}

function handleRequest (details, callback) {
  /* eslint-disable standard/no-callback-literal */

  // webContentsId may not exist if this request is a mainFrame or subframe
  const domain = getRequestBaseDomain(details)

  const isExceptionDomain = domain && requestDomainIsException(domain)

  const modifiedURL = (enabledFilteringOptions.blockingLevel > 0 && !isExceptionDomain) ? removeTrackingParams(details.url) : details.url

  if (!(details.url.startsWith('http://') || details.url.startsWith('https://')) || details.resourceType === 'mainFrame') {
    callback({
      cancel: false,
      requestHeaders: details.requestHeaders,
      redirectURL: (modifiedURL !== details.url) ? modifiedURL : undefined
    })
    return
  }

  // block javascript and images if needed

  if (enabledFilteringOptions.contentTypes.length > 0) {
    for (var i = 0; i < enabledFilteringOptions.contentTypes.length; i++) {
      if (details.resourceType === enabledFilteringOptions.contentTypes[i]) {
        callback({
          cancel: true,
          requestHeaders: details.requestHeaders
        })
        return
      }
    }
  }

  if (enabledFilteringOptions.blockingLevel > 0 && !isExceptionDomain) {
    if (
      (enabledFilteringOptions.blockingLevel === 1 && (!domain || requestIsThirdParty(domain, details.url))) ||
      (enabledFilteringOptions.blockingLevel === 2)
    ) {
      // by doing this check second, we can skip checking same-origin requests if only third-party blocking is enabled
      const elementType = electronABPElementTypeMap[details.resourceType]

      // Native cache lookup (safe): only short-circuit when we have an exact key hit.
      // If native addon is missing or errors, fall back to normal JS matching.
      let matchesFilters
      const cacheKey = nativeAbpCache ? (
        enabledFilteringOptions.blockingLevel + '|' +
        (domain || '') + '|' +
        elementType + '|' +
        // match engine lowercases internally; using lowercase improves cache hit rate
        details.url.toLowerCase()
      ) : null

      if (cacheKey && nativeAbpCache?.get) {
        try {
          const cached = nativeAbpCache.get(cacheKey)
          if (cached === 0) {
            matchesFilters = false
          } else if (cached === 1) {
            matchesFilters = true
          }
        } catch (e) {}
      }

      if (matchesFilters === undefined) {
        matchesFilters = parser.matches(parsedFilterData, details.url, {
          domain: domain,
          elementType
        })

        if (cacheKey && nativeAbpCache?.set) {
          try {
            nativeAbpCache.set(cacheKey, !!matchesFilters)
          } catch (e) {}
        }
      }
      if (matchesFilters) {
        unsavedBlockedRequests++

        callback({
          cancel: true,
          requestHeaders: details.requestHeaders
        })
        return
      }
    }
  }

  callback({
    cancel: false,
    requestHeaders: details.requestHeaders,
    redirectURL: (modifiedURL !== details.url) ? modifiedURL : undefined
  })
  /* eslint-enable standard/no-callback-literal */
}

function setFilteringSettings (settings) {
  if (!settings) {
    settings = {}
  }

  for (var key in defaultFilteringSettings) {
    if (settings[key] === undefined) {
      settings[key] = defaultFilteringSettings[key]
    }
  }

  if (settings.blockingLevel > 0 && !(enabledFilteringOptions.blockingLevel > 0)) { // we're enabling tracker filtering
    initFilterList()
  }

  enabledFilteringOptions.contentTypes = settings.contentTypes
  enabledFilteringOptions.blockingLevel = settings.blockingLevel
  enabledFilteringOptions.exceptionDomains = settings.exceptionDomains.map(d => removeWWW(d))
}

function registerFiltering (ses) {
  ses.webRequest.onBeforeRequest(handleRequest)
}

app.once('ready', function () {
  registerFiltering(session.defaultSession)
})

app.on('session-created', registerFiltering)

settings.listen('filtering', function (value) {
  // migrate from old settings (<v1.9.0)
  if (value && typeof value.trackers === 'boolean') {
    if (value.trackers === true) {
      value.blockingLevel = 2
    } else if (value.trackers === false) {
      value.blockingLevel = 0
    }
    delete value.trackers
    settings.set('filtering', value)
  }

  setFilteringSettings(value)
})
