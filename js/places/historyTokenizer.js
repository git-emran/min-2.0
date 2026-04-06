const path = require('path')

let nativeBinding = null
let stemmer = null

const whitespaceRegex = /\s+/g
const ignoredCharactersRegex = /[']+/g
const diacriticsRegex = /[\u0300-\u036f]/g

const nativeCandidates = [
  path.join(__dirname, '../../native/build/Release/places_tokenizer.node')
]

for (const candidate of nativeCandidates) {
  try {
    nativeBinding = require(candidate)
    break
  } catch (e) {}
}

const stopWords = {
  '': true,
  a: true,
  able: true,
  about: true,
  across: true,
  after: true,
  all: true,
  almost: true,
  also: true,
  am: true,
  among: true,
  an: true,
  and: true,
  any: true,
  are: true,
  as: true,
  at: true,
  be: true,
  because: true,
  been: true,
  but: true,
  by: true,
  can: true,
  cannot: true,
  could: true,
  dear: true,
  did: true,
  do: true,
  does: true,
  either: true,
  else: true,
  ever: true,
  every: true,
  for: true,
  from: true,
  get: true,
  got: true,
  had: true,
  has: true,
  have: true,
  he: true,
  her: true,
  hers: true,
  him: true,
  his: true,
  how: true,
  however: true,
  i: true,
  if: true,
  in: true,
  into: true,
  is: true,
  it: true,
  its: true,
  just: true,
  least: true,
  let: true,
  like: true,
  likely: true,
  may: true,
  me: true,
  might: true,
  most: true,
  must: true,
  my: true,
  neither: true,
  no: true,
  nor: true,
  not: true,
  of: true,
  off: true,
  often: true,
  on: true,
  only: true,
  or: true,
  other: true,
  our: true,
  own: true,
  rather: true,
  said: true,
  say: true,
  says: true,
  she: true,
  should: true,
  since: true,
  so: true,
  some: true,
  than: true,
  that: true,
  the: true,
  their: true,
  them: true,
  then: true,
  there: true,
  these: true,
  they: true,
  this: true,
  tis: true,
  to: true,
  too: true,
  twas: true,
  us: true,
  wants: true,
  was: true,
  we: true,
  were: true,
  what: true,
  when: true,
  where: true,
  which: true,
  while: true,
  who: true,
  whom: true,
  why: true,
  will: true,
  with: true,
  would: true,
  yet: true,
  you: true,
  your: true
}

function prepareText (string) {
  const nonLetterRegex = (typeof window !== 'undefined' && window.nonLetterRegex) || global.nonLetterRegex || /[^\s0-9A-Za-z]/g

  return string.trim().toLowerCase()
    .replace(ignoredCharactersRegex, '')
    .replace(nonLetterRegex, ' ')
    .normalize('NFD').replace(diacriticsRegex, '')
}

function tokenizeFallback (preparedText) {
  return preparedText
    .split(whitespaceRegex)
    .filter(function (token) {
      return !stopWords[token] && token.length <= 100
    })
    .slice(0, 20000)
}

function tokenize (string) {
  const preparedText = prepareText(string)

  if (!preparedText) {
    return []
  }

  const tokens = nativeBinding
    ? nativeBinding.tokenizeAndStemPrepared(preparedText, 100, 20000)
    : tokenizeFallback(preparedText)

  if (nativeBinding) {
    return tokens
  }

  if (!stemmer) {
    stemmer = require('stemmer')
  }

  return tokens.map(token => stemmer(token))
}

function isNativeEnabled () {
  return !!nativeBinding
}

module.exports = {
  isNativeEnabled,
  tokenize
}
