const path = require('path')
const placesTokenizer = require('./historyTokenizer.js')

let nativeBinding = null

const nativeCandidates = [
  path.join(__dirname, '../../native/build/Release/tag_ranker.node')
]

for (const candidate of nativeCandidates) {
  try {
    nativeBinding = require(candidate)
    break
  } catch (e) {}
}

const tagFirstTokenCache = new Map()

function getTagFirstToken (tag) {
  if (!tagFirstTokenCache.has(tag)) {
    tagFirstTokenCache.set(tag, placesTokenizer.tokenize(tag)[0] || '')
  }

  return tagFirstTokenCache.get(tag)
}

function rankTagsFallback (tokens, termDocCounts, termTags, tagCounts) {
  var scores = {}
  var contributingDocs = {}
  var contributingTerms = {}

  for (var term of tokens) {
    if (!termTags[term]) {
      continue
    }

    for (var tag in termTags[term]) {
      if (!scores[tag]) {
        scores[tag] = 0
      }
      if (!contributingDocs[tag]) {
        contributingDocs[tag] = 0
      }
      if (!contributingTerms[tag]) {
        contributingTerms[tag] = 0
      }

      if (tagCounts[tag] >= 2) {
        const docsWithTag = termTags[term]?.[tag] || 0
        scores[tag] += Math.pow(docsWithTag / (termDocCounts[term] || 1), 2) * (0.85 + 0.1 * Math.sqrt(termDocCounts[term] || 0))
        contributingDocs[tag] += docsWithTag
        contributingTerms[tag]++
      }
    }
  }

  var scoresArr = []

  for (var tag in scores) {
    if (tokens.includes(getTagFirstToken(tag))) {
      scores[tag] *= 1.5
    }

    if (contributingDocs[tag] > 1 && contributingTerms[tag] > 1) {
      scoresArr.push({ tag, value: scores[tag] })
    } else {
      scoresArr.push({ tag, value: 0 })
    }
  }

  return scoresArr.sort((a, b) => b.value - a.value)
}

function rankTags (tokens, termDocCounts, termTags, tagCounts) {
  if (!nativeBinding) {
    return rankTagsFallback(tokens, termDocCounts, termTags, tagCounts)
  }

  const tagFirstTokens = {}
  Object.keys(tagCounts).forEach(function (tag) {
    tagFirstTokens[tag] = getTagFirstToken(tag)
  })

  return nativeBinding.rankTags(tokens, termDocCounts, termTags, tagCounts, tagFirstTokens)
}

function scoreRequiredTagsFallback (tokens, requiredTags, termDocCounts, termTags, tagCounts, minimumScore = 1.1) {
  if (!requiredTags.length) {
    return 0
  }

  var scores = {}
  var contributingDocs = {}
  var contributingTerms = {}

  requiredTags.forEach(function (tag) {
    scores[tag] = 0
    contributingDocs[tag] = 0
    contributingTerms[tag] = 0
  })

  for (var term of tokens) {
    if (!termTags[term]) {
      continue
    }

    requiredTags.forEach(function (tag) {
      if (tagCounts[tag] < 2) {
        return
      }

      const docsWithTag = termTags[term]?.[tag] || 0
      if (!docsWithTag) {
        return
      }

      scores[tag] += Math.pow(docsWithTag / (termDocCounts[term] || 1), 2) * (0.85 + 0.1 * Math.sqrt(termDocCounts[term] || 0))
      contributingDocs[tag] += docsWithTag
      contributingTerms[tag]++
    })
  }

  var totalScore = 0

  for (var i = 0; i < requiredTags.length; i++) {
    const tag = requiredTags[i]

    if (tokens.includes(getTagFirstToken(tag))) {
      scores[tag] *= 1.5
    }

    if (contributingDocs[tag] <= 1 || contributingTerms[tag] <= 1 || scores[tag] < minimumScore) {
      return 0
    }

    totalScore += scores[tag]
  }

  return totalScore
}

function scoreRequiredTags (tokens, requiredTags, termDocCounts, termTags, tagCounts, minimumScore = 1.1) {
  if (!nativeBinding) {
    return scoreRequiredTagsFallback(tokens, requiredTags, termDocCounts, termTags, tagCounts, minimumScore)
  }

  const tagFirstTokens = {}
  requiredTags.forEach(function (tag) {
    tagFirstTokens[tag] = getTagFirstToken(tag)
  })

  return nativeBinding.scoreRequiredTags(tokens, requiredTags, termDocCounts, termTags, tagCounts, tagFirstTokens, minimumScore)
}

function autocompleteTagsFallback (searchTags, tagCounts, tagTagMap, tagUpdateTimes) {
  var tagScores = []

  for (var tag in tagCounts) {
    var score = tagCounts[tag]
    searchTags.forEach(function (searchTag) {
      if (tagTagMap[searchTag]) {
        score *= tagTagMap[searchTag][tag] || 0
      } else {
        score = 0
      }
    })

    score *= Math.max(2 - ((Date.now() - tagUpdateTimes[tag]) / (14 * 24 * 60 * 60 * 1000)), 1)

    tagScores.push({ tag, score })
  }

  return tagScores.filter(t => t.score > 0).sort((a, b) => b.score - a.score).map(i => i.tag)
}

function autocompleteTags (searchTags, tagCounts, tagTagMap, tagUpdateTimes) {
  if (!nativeBinding) {
    return autocompleteTagsFallback(searchTags, tagCounts, tagTagMap, tagUpdateTimes)
  }

  return nativeBinding.autocompleteTags(searchTags, tagCounts, tagTagMap, tagUpdateTimes, Date.now())
}

function isNativeEnabled () {
  return !!nativeBinding
}

module.exports = {
  autocompleteTags,
  getTagFirstToken,
  isNativeEnabled,
  rankTags,
  scoreRequiredTags
}
