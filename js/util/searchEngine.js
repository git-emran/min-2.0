if (typeof require !== 'undefined') {
  var settings = require('util/settings/settings.js')
}
// otherwise, assume window.settings exists already

var currentSearchEngine = {
  name: '',
  searchURL: '%s'
}

var defaultSearchEngine = 'Google'

var searchEngines = {
  DuckDuckGo: {
    name: 'DuckDuckGo',
    searchURL: 'https://duckduckgo.com/?q=%s&t=min',
    suggestionsURL: 'https://ac.duckduckgo.com/ac/?q=%s&type=list&t=min',
    queryParam: 'q'
  },
  Google: {
    name: 'Google',
    searchURL: 'https://www.google.com/search?q=%s',
    // OpenSearch-compatible JSON format: [query, [suggestions...], ...]
    suggestionsURL: 'https://suggestqueries.google.com/complete/search?client=firefox&q=%s',
    queryParam: 'q'
  }
}

for (const e in searchEngines) {
  try {
    searchEngines[e].urlObj = new URL(searchEngines[e].searchURL)
  } catch (e) {}
}

settings.listen('searchEngine', function (value) {
  let nextEngine = null

  if (value && value.name && searchEngines[value.name]) {
    nextEngine = searchEngines[value.name]
  }

  // Custom/unknown engines are no longer supported; fall back to default.
  if (!nextEngine) {
    nextEngine = searchEngines[defaultSearchEngine]

    try {
      if (value && (value.url || (value.name && !searchEngines[value.name]))) {
        // Persist migration so the settings UI stays consistent.
        settings.set('searchEngine', { name: defaultSearchEngine })
      }
    } catch (e) {}
  }

  currentSearchEngine = nextEngine
})

var searchEngine = {
  getCurrent: function () {
    return currentSearchEngine
  },
  getSearch: function (url) {
    var urlObj
    try {
      urlObj = new URL(url)
    } catch (e) {
      return null
    }
    for (var e in searchEngines) {
      if (!searchEngines[e].urlObj) {
        continue
      }
      if (searchEngines[e].urlObj.hostname === urlObj.hostname && searchEngines[e].urlObj.pathname === urlObj.pathname) {
        if (urlObj.searchParams.get(searchEngines[e].queryParam)) {
          return {
            engine: searchEngines[e].name,
            search: urlObj.searchParams.get(searchEngines[e].queryParam)
          }
        }
      }
    }
    return null
  }
}

if (typeof module === 'undefined') {
  window.currentSearchEngine = currentSearchEngine
} else {
  module.exports = searchEngine
}
