/* global spacesRegex historyInMemoryCache */

const historyScore = require('./historyScore.js')

/* depends on placesWorker.js */

function searchFormatTitle (text) {
  return text.toLowerCase().replace(spacesRegex, ' ').normalize('NFD').replace(/[\u0300-\u036f]/g, '') // remove diacritics
}

function searchFormatURL (text) {
  // the order of these transformations is important - for example, spacesRegex removes / characters, so protocols must be removed before it runs
  return text.toLowerCase().split('?')[0].replace('http://', '').replace('https://', '').replace('www.', '').replace(spacesRegex, ' ')
    // Remove diacritics
    // URLs don't normally contrain diacritics, but this processing is also applied to the user-typed text, so it needs to match the transformations
    // Applied by searchFormatTitle
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .trim()
}

function getSearchTextCache (item) {
  const title = searchFormatTitle(item.title)
  const url = searchFormatURL(item.url)
  const tags = item.tags && item.tags.length ? item.tags.join(' ') : ''

  let combined = url
  if (item.url !== item.title) {
    combined += ' ' + title
  }
  if (tags) {
    combined += ' ' + tags
  }

  return {
    title,
    url,
    combined,
    fullText: (item.url + ' ' + item.title + ' ' + tags).toLowerCase(),
    quickTitle: title.substring(0, 50),
    quickURL: url.substring(0, 100)
  }
}

function searchPlaces (searchText, callback, options) {
  function processSearchItem (item, index) {
    if (limitToBookmarks && !item.isBookmarked) {
      return
    }
    const deterministicBoost = deterministicBoosts[index]

    if (deterministicBoost > 0) {
      item.boost = deterministicBoost
      matches.push(item)
      return
    }

    if ((item.visitCount > 2 && item.lastVisit > oneWeekAgo) || item.lastVisit > oneDayAgo) {
      const score = Math.max(
        quickScore.quickScore(item.searchTextCache.quickURL, st),
        quickScore.quickScore(item.searchTextCache.quickTitle, st)
      )
      if (score > 0.3) {
        item.boost = score * 0.33
        matches.push(item)
      }
    }
  }

  const oneDayAgo = Date.now() - (oneDayInMS)
  const oneWeekAgo = Date.now() - (oneDayInMS * 7)

  const matches = []
  const st = searchFormatURL(searchText)
  const stl = searchText.length
  const searchWords = st.split(' ')
  const swl = searchWords.length
  let substringSearchEnabled = false
  const itemStartBoost = Math.min(2.5 * stl, 10)
  const exactMatchBoost = 0.4 + (0.075 * stl)
  const substringBoost = 0.125 * swl + (0.02 * stl)
  const limitToBookmarks = options && options.searchBookmarks
  const resultsLimit = (options && options.limit) || 100

  if (searchText.indexOf(' ') !== -1) {
    substringSearchEnabled = true
  }

  const deterministicBoosts = historyScore.classifySearchTexts(
    historyInMemoryCache.map(item => item.searchTextCache.combined),
    st,
    searchWords,
    substringSearchEnabled,
    itemStartBoost,
    exactMatchBoost,
    substringBoost
  )

  for (let i = 0; i < historyInMemoryCache.length; i++) {
    if (matches.length > (resultsLimit * 2)) {
      break
    }
    processSearchItem(historyInMemoryCache[i], i)
  }

  const rankedMatches = historyScore.rankTopItems(matches, resultsLimit)

  // clean up
  matches.forEach(function (match) {
    match.boost = 0
  })

  callback(rankedMatches)
}
