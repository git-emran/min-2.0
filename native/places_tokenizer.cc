#include <node_api.h>

#include <algorithm>
#include <string>
#include <unordered_map>
#include <unordered_set>
#include <vector>

namespace {

const std::unordered_set<std::string> kStopWords = {
  "", "a", "able", "about", "across", "after", "all", "almost", "also", "am",
  "among", "an", "and", "any", "are", "as", "at", "be", "because", "been",
  "but", "by", "can", "cannot", "could", "dear", "did", "do", "does", "either",
  "else", "ever", "every", "for", "from", "get", "got", "had", "has", "have",
  "he", "her", "hers", "him", "his", "how", "however", "i", "if", "in", "into",
  "is", "it", "its", "just", "least", "let", "like", "likely", "may", "me",
  "might", "most", "must", "my", "neither", "no", "nor", "not", "of", "off",
  "often", "on", "only", "or", "other", "our", "own", "rather", "said", "say",
  "says", "she", "should", "since", "so", "some", "than", "that", "the", "their",
  "them", "then", "there", "these", "they", "this", "tis", "to", "too", "twas",
  "us", "wants", "was", "we", "were", "what", "when", "where", "which", "while",
  "who", "whom", "why", "will", "with", "would", "yet", "you", "your"
};

const std::unordered_map<std::string, std::string> kStep2List = {
  {"ational", "ate"},
  {"tional", "tion"},
  {"enci", "ence"},
  {"anci", "ance"},
  {"izer", "ize"},
  {"bli", "ble"},
  {"alli", "al"},
  {"entli", "ent"},
  {"eli", "e"},
  {"ousli", "ous"},
  {"ization", "ize"},
  {"ation", "ate"},
  {"ator", "ate"},
  {"alism", "al"},
  {"iveness", "ive"},
  {"fulness", "ful"},
  {"ousness", "ous"},
  {"aliti", "al"},
  {"iviti", "ive"},
  {"biliti", "ble"},
  {"logi", "log"}
};

const std::unordered_map<std::string, std::string> kStep3List = {
  {"icate", "ic"},
  {"ative", ""},
  {"alize", "al"},
  {"iciti", "ic"},
  {"ical", "ic"},
  {"ful", ""},
  {"ness", ""}
};

const std::vector<std::string> kStep2Suffixes = {
  "ational", "tional", "enci", "anci", "izer", "bli", "alli", "entli", "eli",
  "ousli", "ization", "ation", "ator", "alism", "iveness", "fulness",
  "ousness", "aliti", "iviti", "biliti", "logi"
};

const std::vector<std::string> kStep3Suffixes = {
  "icate", "ative", "alize", "iciti", "ical", "ful", "ness"
};

const std::vector<std::string> kStep4Suffixes = {
  "al", "ance", "ence", "er", "ic", "able", "ible", "ant", "ement", "ment",
  "ent", "ou", "ism", "ate", "iti", "ous", "ive", "ize"
};

bool IsWhitespace(unsigned char c) {
  return c == ' ' || c == '\n' || c == '\r' || c == '\t' || c == '\f' || c == '\v';
}

bool EndsWith(const std::string& value, const std::string& suffix) {
  return value.size() >= suffix.size() &&
    value.compare(value.size() - suffix.size(), suffix.size(), suffix) == 0;
}

bool ContainsNonAscii(const std::string& value) {
  return std::any_of(value.begin(), value.end(), [](unsigned char c) {
    return c >= 128;
  });
}

bool IsVowel(char c) {
  return c == 'a' || c == 'e' || c == 'i' || c == 'o' || c == 'u' || c == 'y';
}

bool VowelInStem(const std::string& value) {
  return std::any_of(value.begin(), value.end(), [](char c) {
    return IsVowel(c);
  });
}

int Measure(const std::string& value) {
  int count = 0;
  bool inVowelGroup = false;

  for (char c : value) {
    const bool isVowel = IsVowel(c);

    if (isVowel) {
      inVowelGroup = true;
    } else if (inVowelGroup) {
      count++;
      inVowelGroup = false;
    }
  }

  return count;
}

bool IsConsonantLike(const std::string& value) {
  if (value.size() < 3) {
    return false;
  }

  const char a = value[value.size() - 3];
  const char b = value[value.size() - 2];
  const char c = value[value.size() - 1];

  return !IsVowel(a) && IsVowel(b) && !IsVowel(c) && c != 'w' && c != 'x' && c != 'y';
}

bool HasDoubleConsonantLikeEnding(const std::string& value) {
  if (value.size() < 2) {
    return false;
  }

  const char last = value[value.size() - 1];
  const char prev = value[value.size() - 2];

  return last == prev &&
    !IsVowel(last) &&
    last != 'y' &&
    last != 'l' &&
    last != 's' &&
    last != 'z';
}

std::string StemAsciiToken(std::string value) {
  if (value.size() < 3 || ContainsNonAscii(value)) {
    return value;
  }

  bool firstCharacterWasLowerCaseY = false;

  if (value[0] == 'y') {
    firstCharacterWasLowerCaseY = true;
    value[0] = 'Y';
  }

  if (EndsWith(value, "sses") || EndsWith(value, "ies")) {
    value.erase(value.size() - 2);
  } else if (value.size() >= 2 && value.back() == 's' && value[value.size() - 2] != 's') {
    value.erase(value.size() - 1);
  }

  if (EndsWith(value, "eed")) {
    const std::string stem = value.substr(0, value.size() - 3);
    if (Measure(stem) > 0) {
      value.erase(value.size() - 1);
    }
  } else if (EndsWith(value, "ed") || EndsWith(value, "ing")) {
    const std::string suffix = EndsWith(value, "ed") ? "ed" : "ing";
    const std::string stem = value.substr(0, value.size() - suffix.size());

    if (VowelInStem(stem)) {
      value = stem;

      if (EndsWith(value, "at") || EndsWith(value, "bl") || EndsWith(value, "iz")) {
        value += 'e';
      } else if (HasDoubleConsonantLikeEnding(value)) {
        value.erase(value.size() - 1);
      } else if (Measure(value) == 1 && IsConsonantLike(value)) {
        value += 'e';
      }
    }
  }

  if (EndsWith(value, "y")) {
    const std::string stem = value.substr(0, value.size() - 1);
    if (VowelInStem(stem)) {
      value = stem + 'i';
    }
  }

  for (const std::string& suffix : kStep2Suffixes) {
    if (EndsWith(value, suffix)) {
      const std::string stem = value.substr(0, value.size() - suffix.size());
      if (Measure(stem) > 0) {
        value = stem + kStep2List.at(suffix);
      }
      break;
    }
  }

  for (const std::string& suffix : kStep3Suffixes) {
    if (EndsWith(value, suffix)) {
      const std::string stem = value.substr(0, value.size() - suffix.size());
      if (Measure(stem) > 0) {
        value = stem + kStep3List.at(suffix);
      }
      break;
    }
  }

  bool step4Applied = false;
  for (const std::string& suffix : kStep4Suffixes) {
    if (EndsWith(value, suffix)) {
      const std::string stem = value.substr(0, value.size() - suffix.size());
      if (Measure(stem) > 1) {
        value = stem;
      }
      step4Applied = true;
      break;
    }
  }

  if (!step4Applied && EndsWith(value, "ion") && value.size() > 3) {
    const std::string stem = value.substr(0, value.size() - 3);
    if (Measure(stem) > 1 && !stem.empty()) {
      const char last = stem.back();
      if (last == 's' || last == 't') {
        value = stem;
      }
    }
  }

  if (EndsWith(value, "e")) {
    const std::string stem = value.substr(0, value.size() - 1);
    const int measure = Measure(stem);
    if (measure > 1 || (measure == 1 && !IsConsonantLike(stem))) {
      value = stem;
    }
  }

  if (EndsWith(value, "ll") && Measure(value) > 1) {
    value.erase(value.size() - 1);
  }

  if (firstCharacterWasLowerCaseY) {
    value[0] = 'y';
  }

  return value;
}

void FlushToken(
  std::string* token,
  size_t maxTokenLength,
  size_t maxTokenCount,
  std::vector<std::string>* tokens,
  bool stemTokens
) {
  if (token->empty() || tokens->size() >= maxTokenCount) {
    token->clear();
    return;
  }

  if (token->size() <= maxTokenLength && !kStopWords.count(*token)) {
    tokens->push_back(stemTokens ? StemAsciiToken(*token) : *token);
  }

  token->clear();
}

std::vector<std::string> TokenizePrepared(
  const std::string& input,
  size_t maxTokenLength,
  size_t maxTokenCount,
  bool stemTokens
) {
  std::vector<std::string> tokens;
  tokens.reserve(256);

  std::string token;
  token.reserve(32);

  for (const unsigned char c : input) {
    if (IsWhitespace(c)) {
      FlushToken(&token, maxTokenLength, maxTokenCount, &tokens, stemTokens);
      if (tokens.size() >= maxTokenCount) {
        break;
      }
    } else {
      token.push_back(static_cast<char>(c));
    }
  }

  FlushToken(&token, maxTokenLength, maxTokenCount, &tokens, stemTokens);

  return tokens;
}

void GetTokenizeArgs(
  napi_env env,
  napi_callback_info info,
  std::string* input,
  size_t* maxTokenLength,
  size_t* maxTokenCount
) {
  size_t argc = 3;
  napi_value argv[3];

  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);

  if (argc < 3) {
    napi_throw_type_error(env, nullptr, "Expected preparedText, maxTokenLength, and maxTokenCount");
    return;
  }

  size_t inputLength = 0;
  napi_get_value_string_utf8(env, argv[0], nullptr, 0, &inputLength);

  std::vector<char> inputBuffer(inputLength + 1, '\0');
  napi_get_value_string_utf8(env, argv[0], inputBuffer.data(), inputBuffer.size(), &inputLength);
  *input = std::string(inputBuffer.data(), inputLength);

  double maxTokenLengthDouble = 0;
  double maxTokenCountDouble = 0;
  napi_get_value_double(env, argv[1], &maxTokenLengthDouble);
  napi_get_value_double(env, argv[2], &maxTokenCountDouble);

  *maxTokenLength = static_cast<size_t>(maxTokenLengthDouble);
  *maxTokenCount = static_cast<size_t>(maxTokenCountDouble);
}

napi_value CreateTokenArray(napi_env env, const std::vector<std::string>& tokens) {
  napi_value result;

  napi_create_array_with_length(env, tokens.size(), &result);

  for (size_t i = 0; i < tokens.size(); i++) {
    napi_value tokenValue;
    napi_create_string_utf8(env, tokens[i].c_str(), tokens[i].size(), &tokenValue);
    napi_set_element(env, result, i, tokenValue);
  }

  return result;
}

napi_value TokenizePreparedWrapped(napi_env env, napi_callback_info info) {
  std::string input;
  size_t maxTokenLength = 0;
  size_t maxTokenCount = 0;

  GetTokenizeArgs(env, info, &input, &maxTokenLength, &maxTokenCount);

  if (maxTokenCount == 0) {
    return nullptr;
  }

  const auto tokens = TokenizePrepared(
    input,
    maxTokenLength,
    maxTokenCount,
    false
  );

  return CreateTokenArray(env, tokens);
}

napi_value TokenizeAndStemPreparedWrapped(napi_env env, napi_callback_info info) {
  std::string input;
  size_t maxTokenLength = 0;
  size_t maxTokenCount = 0;

  GetTokenizeArgs(env, info, &input, &maxTokenLength, &maxTokenCount);

  if (maxTokenCount == 0) {
    return nullptr;
  }

  const auto tokens = TokenizePrepared(
    input,
    maxTokenLength,
    maxTokenCount,
    true
  );

  return CreateTokenArray(env, tokens);
}

napi_value Init(napi_env env, napi_value exports) {
  napi_value tokenizePreparedFn;
  napi_value tokenizeAndStemPreparedFn;

  napi_create_function(
    env,
    "tokenizePrepared",
    NAPI_AUTO_LENGTH,
    TokenizePreparedWrapped,
    nullptr,
    &tokenizePreparedFn
  );

  napi_create_function(
    env,
    "tokenizeAndStemPrepared",
    NAPI_AUTO_LENGTH,
    TokenizeAndStemPreparedWrapped,
    nullptr,
    &tokenizeAndStemPreparedFn
  );

  napi_set_named_property(env, exports, "tokenizePrepared", tokenizePreparedFn);
  napi_set_named_property(env, exports, "tokenizeAndStemPrepared", tokenizeAndStemPreparedFn);

  return exports;
}

} // namespace

NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)
