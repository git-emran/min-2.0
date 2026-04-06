const path = require('path')

let nativeBinding = null

const nativeCandidates = [
  path.join(__dirname, '../../native/build/Release/history_score.node')
]

for (const candidate of nativeCandidates) {
  try {
    nativeBinding = require(candidate)
    break
  } catch (e) {}
}

function calculateBaseHistoryScoreJS (item) {
  let score = item.lastVisit * (1 + 0.036 * Math.sqrt(item.visitCount))

  if (item.url.length < 20) {
    score += (30 - item.url.length) * 2500
  }

  return score
}

function calculateBaseHistoryScore (item) {
  if (item.baseHistoryScore !== undefined) {
    return item.baseHistoryScore
  }

  if (nativeBinding) {
    return nativeBinding.calculateBaseScore(
      item.lastVisit,
      item.visitCount,
      item.url.length
    )
  }

  return calculateBaseHistoryScoreJS(item)
}

function updateBaseHistoryScore (item) {
  item.baseHistoryScore = calculateBaseHistoryScore(item)
  return item.baseHistoryScore
}

function calculateHistoryScore (item) {
  const baseScore = calculateBaseHistoryScore(item)

  if (item.boost) {
    return baseScore + (baseScore * item.boost)
  }

  return baseScore
}

function rankTopItemsFallback (items, limit) {
  if (!items || items.length === 0 || limit <= 0) {
    return []
  }

  const ranked = []

  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    const score = calculateHistoryScore(item)

    if (ranked.length === limit && score <= ranked[ranked.length - 1].score) {
      continue
    }

    let inserted = false
    for (let j = 0; j < ranked.length; j++) {
      if (score > ranked[j].score) {
        ranked.splice(j, 0, { item, score })
        inserted = true
        break
      }
    }

    if (!inserted && ranked.length < limit) {
      ranked.push({ item, score })
    }

    if (ranked.length > limit) {
      ranked.length = limit
    }
  }

  return ranked.map(entry => entry.item)
}

function rankTopItems (items, limit) {
  if (!items || items.length === 0 || limit <= 0) {
    return []
  }

  if (!nativeBinding?.rankCandidateIndexes) {
    return rankTopItemsFallback(items, limit)
  }

  const baseScores = new Array(items.length)
  const boosts = new Array(items.length)

  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    baseScores[i] = calculateBaseHistoryScore(item)
    boosts[i] = item.boost || 0
  }

  return nativeBinding.rankCandidateIndexes(baseScores, boosts, limit).map(index => items[index])
}

function classifySearchTextsFallback (texts, searchText, searchWords, substringSearchEnabled, itemStartBoost, exactMatchBoost, substringBoost) {
  const boosts = new Array(texts.length)

  for (let i = 0; i < texts.length; i++) {
    const text = texts[i]
    const index = text.indexOf(searchText)

    if (index === 0) {
      boosts[i] = itemStartBoost
      continue
    }

    if (index !== -1) {
      boosts[i] = exactMatchBoost
      continue
    }

    if (!substringSearchEnabled) {
      boosts[i] = 0
      continue
    }

    let substringMatch = true
    for (let j = 0; j < searchWords.length; j++) {
      if (!searchWords[j]) {
        continue
      }

      if (text.indexOf(searchWords[j]) === -1) {
        substringMatch = false
        break
      }
    }

    boosts[i] = substringMatch ? substringBoost : 0
  }

  return boosts
}

function classifySearchTexts (texts, searchText, searchWords, substringSearchEnabled, itemStartBoost, exactMatchBoost, substringBoost) {
  if (!nativeBinding?.classifySearchTexts) {
    return classifySearchTextsFallback(texts, searchText, searchWords, substringSearchEnabled, itemStartBoost, exactMatchBoost, substringBoost)
  }

  return nativeBinding.classifySearchTexts(
    texts,
    searchText,
    searchWords,
    substringSearchEnabled,
    itemStartBoost,
    exactMatchBoost,
    substringBoost
  )
}

function isNativeEnabled () {
  return !!nativeBinding
}

module.exports = {
  classifySearchTexts,
  calculateBaseHistoryScore,
  calculateHistoryScore,
  isNativeEnabled,
  rankTopItems,
  updateBaseHistoryScore
}
