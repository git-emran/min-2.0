const tagRanker = require('./tagRanker.js')

function insertTopSuggestion (results, page, score, limit) {
  if (results.length === limit && score <= results[results.length - 1].score) {
    return
  }

  var inserted = false
  var item = Object.assign({}, page, { score: score })

  for (var i = 0; i < results.length; i++) {
    if (score > results[i].score) {
      results.splice(i, 0, item)
      inserted = true
      break
    }
  }

  if (!inserted && results.length < limit) {
    results.push(item)
  }

  if (results.length > limit) {
    results.length = limit
  }
}

var tagIndex = {
  totalDocs: 0,
  termDocCounts: {},
  termTags: {},
  tagTagMap: {},
  tagCounts: {},
  tagUpdateTimes: {},
  getPageTokens: function (page) {
    var cacheKey = page.title + '\n' + page.url
    if (page.tagIndexTokenCacheKey === cacheKey && page.tagIndexTokenCache) {
      return page.tagIndexTokenCache
    }

    var urlChunk = ''
    try {
      let url = new URL(page.url)
      if ((page.url.startsWith('file://') || page.url.startsWith('min://')) && url.searchParams.get('url')) {
        url = new URL(url.searchParams.get('url'))
      }
      urlChunk = url.hostname.split('.').slice(0, -1).join(' ') + ' ' + url.pathname.split('/').filter(p => p.length > 1).slice(0, 2).join(' ')
    } catch (e) { }

    var tokens = tokenize((/^(http|https|file):\/\//.test(page.title) ? '' : page.title) + ' ' + urlChunk)

    var generic = ['http', 'htps', 'www', 'com', 'net', 'html', 'pdf', 'file']
    tokens = tokens.filter(t => t.length > 2 && !generic.includes(t))

    //get unique tokens
    tokens = tokens.filter((t, i) => tokens.indexOf(t) === i)

    page.tagIndexTokenCacheKey = cacheKey
    page.tagIndexTokenCache = tokens

    return tokens
  },
  addPage: function (page) {
    if (page.tags.length === 0) {
      return
    }

    tagIndex.totalDocs++

    var tokens = tagIndex.getPageTokens(page)

    tokens.forEach(function (token) {
      if (!tagIndex.termDocCounts[token]) {
        tagIndex.termDocCounts[token] = 1
      } else {
        tagIndex.termDocCounts[token]++
      }
    })

    page.tags.forEach(function (tag) {
      tokens.forEach(function (token) {
        if (!tagIndex.termTags[token]) {
          tagIndex.termTags[token] = {}
        }
        if (tagIndex.termTags[token][tag]) {
          tagIndex.termTags[token][tag]++
        } else {
          tagIndex.termTags[token][tag] = 1
        }
      })
    })

    page.tags.forEach(function (t1) {
      if (!tagIndex.tagCounts[t1]) {
        tagIndex.tagCounts[t1] = 1
      } else {
        tagIndex.tagCounts[t1]++
      }
      page.tags.forEach(function (t2) {
        if (t1 === t2) {
          return
        }
        if (!tagIndex.tagTagMap[t1]) {
          tagIndex.tagTagMap[t1] = {}
        }

        if (!tagIndex.tagTagMap[t1][t2]) {
          tagIndex.tagTagMap[t1][t2] = 1
        } else {
          tagIndex.tagTagMap[t1][t2]++
        }
      })
    })

    page.tags.forEach(function (tag) {
      if (!tagIndex.tagUpdateTimes[tag] || page.lastVisit > tagIndex.tagUpdateTimes[tag]) {
        tagIndex.tagUpdateTimes[tag] = page.lastVisit
      }
    })
  },
  removePage: function (page) {
    if (page.tags.length === 0) {
      return
    }

    tagIndex.totalDocs--

    var tokens = tagIndex.getPageTokens(page)

    tokens.filter((t, i) => tokens.indexOf(t) === i).forEach(function (token) {
      if (tagIndex.termDocCounts[token]) {
        tagIndex.termDocCounts[token]--
      }
    })

    page.tags.forEach(function (tag) {
      tokens.forEach(function (token) {
        if (tagIndex.termTags[token] && tagIndex.termTags[token][tag]) {
          tagIndex.termTags[token][tag]--
        }
      })
    })

    page.tags.forEach(function (t1) {
      if (tagIndex.tagCounts[t1]) {
        tagIndex.tagCounts[t1]--
      }

      page.tags.forEach(function (t2) {
        if (t1 === t2) {
          return
        }
        if (!tagIndex.tagTagMap[t1]) {
          tagIndex.tagTagMap[t1] = {}
        }

        if (tagIndex.tagTagMap[t1] && tagIndex.tagTagMap[t1][t2]) {
          tagIndex.tagTagMap[t1][t2]--
        }
      })
    })
  },
  onChange: function (oldPage, newPage) {
    tagIndex.removePage(oldPage)
    tagIndex.addPage(newPage)
  },
  getAllTagsRanked: function (page) {
    var tokens = tagIndex.getPageTokens(page)
    var termDocCounts = {}
    var termTags = {}
    var tagCounts = {}

    for (var term of tokens) {
      termDocCounts[term] = tagIndex.termDocCounts[term] || 0

      if (!tagIndex.termTags[term]) {
        continue
      }

      termTags[term] = tagIndex.termTags[term]
      for (var tag in tagIndex.termTags[term]) {
        tagCounts[tag] = tagIndex.tagCounts[tag] || 0
      }
    }

    return tagRanker.rankTags(tokens, termDocCounts, termTags, tagCounts)
  },
  getSuggestedTags: function (page) {
    return tagIndex.getAllTagsRanked(page).slice(0,3).filter(p => p.value > 0.66).map(p => p.tag)
  },
  getSuggestedItemsForTags: function (tags) {
    var requiredTags = tags.filter(function (tag, index) {
      return tags.indexOf(tag) === index
    })
    var results = []

    for (var i = 0; i < historyInMemoryCache.length; i++) {
      var page = historyInMemoryCache[i]

      if (!page.isBookmarked) {
        continue
      }

      if (!requiredTags.some(tag => !page.tags.includes(tag))) {
        continue
      }

      var tokens = tagIndex.getPageTokens(page)
      var termDocCounts = {}
      var termTags = {}
      var tagCounts = {}
      var matchedTagCount = 0

      for (var j = 0; j < tokens.length; j++) {
        var term = tokens[j]
        termDocCounts[term] = tagIndex.termDocCounts[term] || 0

        if (!tagIndex.termTags[term]) {
          continue
        }

        var matchedTags = {}
        var hasMatchedTags = false
        for (var k = 0; k < requiredTags.length; k++) {
          var tag = requiredTags[k]
          if (tagIndex.termTags[term][tag]) {
            matchedTags[tag] = tagIndex.termTags[term][tag]
            hasMatchedTags = true
            if (tagCounts[tag] === undefined) {
              tagCounts[tag] = tagIndex.tagCounts[tag] || 0
              matchedTagCount++
            }
          }
        }

        if (hasMatchedTags) {
          termTags[term] = matchedTags
        }
      }

      if (matchedTagCount < requiredTags.length) {
        continue
      }

      var score = tagRanker.scoreRequiredTags(tokens, requiredTags, termDocCounts, termTags, tagCounts, 1.1)

      if (score > 0) {
        insertTopSuggestion(results, page, score, 20)
      }
    }

    return results
  },
  autocompleteTags: function (searchTags) {
    var relatedTagMap = {}

    searchTags.forEach(function (searchTag) {
      if (tagIndex.tagTagMap[searchTag]) {
        relatedTagMap[searchTag] = tagIndex.tagTagMap[searchTag]
      }
    })

    return tagRanker.autocompleteTags(searchTags, tagIndex.tagCounts, relatedTagMap, tagIndex.tagUpdateTimes)
  }
}
