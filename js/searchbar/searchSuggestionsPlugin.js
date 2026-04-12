var searchbarPlugins = require('searchbar/searchbarPlugins.js')

var urlParser = require('util/urlParser.js')
var searchEngine = require('util/searchEngine.js')
const { ipcRenderer } = require('electron')

function showSearchSuggestions (text, input, inputFlags) {
  const engine = searchEngine.getCurrent()

  // Don't add network results if the list is already crowded.
  if ((searchbarPlugins.getResultCount() - searchbarPlugins.getResultCount('searchSuggestions')) > 12) {
    searchbarPlugins.reset('searchSuggestions')
    return
  }

  const requestSent = Date.now()
  showSearchSuggestions.lastRequestSent = requestSent

  ipcRenderer.invoke('fetchSearchSuggestions', { engine: engine.name, query: text })
    .then(function (suggestions) {
      if (requestSent < showSearchSuggestions.lastRequestSent) {
        return
      }

      searchbarPlugins.reset('searchSuggestions')

      if (searchbarPlugins.getResultCount() > 12) {
        return
      }

      if (!Array.isArray(suggestions)) {
        return
      }

      suggestions.slice(0, 6).forEach(function (suggestion) {
        var data = {
          title: suggestion,
          url: suggestion
        }

        if (urlParser.isPossibleURL(suggestion)) { // website suggestions
          data.icon = 'carbon:earth-filled'
        } else { // regular search results
          data.icon = 'carbon:search'
        }

        searchbarPlugins.addResult('searchSuggestions', data)
      })
    })
    .catch(function () {
      if (requestSent < showSearchSuggestions.lastRequestSent) {
        return
      }
      searchbarPlugins.reset('searchSuggestions')
    })
}

function initialize () {
  searchbarPlugins.register('searchSuggestions', {
    index: 4,
    trigger: function (text) {
      return !!text && text.indexOf('!') !== 0 && !tabs.get(tabs.getSelected()).private
    },
    showResults: debounce(showSearchSuggestions, 50)
  })
}

module.exports = { initialize }
