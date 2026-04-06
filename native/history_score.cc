#include <cmath>
#include <node_api.h>
#include <algorithm>
#include <cstdint>
#include <string>
#include <vector>

namespace {

double CalculateBaseScore(double lastVisit, double visitCount, double urlLength) {
  double score = lastVisit * (1.0 + 0.036 * std::sqrt(visitCount));

  if (urlLength < 20.0) {
    score += (30.0 - urlLength) * 2500.0;
  }

  return score;
}

std::string GetString(napi_env env, napi_value value) {
  size_t length = 0;
  napi_get_value_string_utf8(env, value, nullptr, 0, &length);

  std::vector<char> buffer(length + 1, '\0');
  napi_get_value_string_utf8(env, value, buffer.data(), buffer.size(), &length);

  return std::string(buffer.data(), length);
}

std::vector<double> GetNumberArray(napi_env env, napi_value arrayValue) {
  uint32_t length = 0;
  napi_get_array_length(env, arrayValue, &length);

  std::vector<double> result;
  result.reserve(length);

  for (uint32_t i = 0; i < length; i++) {
    napi_value element;
    double value = 0;

    napi_get_element(env, arrayValue, i, &element);
    napi_get_value_double(env, element, &value);
    result.push_back(value);
  }

  return result;
}

std::vector<std::string> GetStringArray(napi_env env, napi_value arrayValue) {
  uint32_t length = 0;
  napi_get_array_length(env, arrayValue, &length);

  std::vector<std::string> result;
  result.reserve(length);

  for (uint32_t i = 0; i < length; i++) {
    napi_value element;
    napi_get_element(env, arrayValue, i, &element);
    result.push_back(GetString(env, element));
  }

  return result;
}

struct RankedIndex {
  uint32_t index;
  double score;
};

std::vector<uint32_t> RankCandidateIndexes(
  const std::vector<double>& baseScores,
  const std::vector<double>& boosts,
  uint32_t limit
) {
  if (limit == 0 || baseScores.empty()) {
    return {};
  }

  std::vector<RankedIndex> ranked;
  ranked.reserve(std::min(static_cast<size_t>(limit), baseScores.size()));

  for (uint32_t i = 0; i < baseScores.size(); i++) {
    const double boost = i < boosts.size() ? boosts[i] : 0;
    const double score = baseScores[i] + (baseScores[i] * boost);

    auto insertAt = ranked.begin();
    while (insertAt != ranked.end() && insertAt->score >= score) {
      insertAt++;
    }

    if (insertAt != ranked.end() || ranked.size() < limit) {
      ranked.insert(insertAt, {i, score});
      if (ranked.size() > limit) {
        ranked.pop_back();
      }
    }
  }

  std::vector<uint32_t> result;
  result.reserve(ranked.size());

  for (const RankedIndex& item : ranked) {
    result.push_back(item.index);
  }

  return result;
}

napi_value CreateUint32Array(napi_env env, const std::vector<uint32_t>& values) {
  napi_value result;
  napi_create_array_with_length(env, values.size(), &result);

  for (size_t i = 0; i < values.size(); i++) {
    napi_value value;
    napi_create_uint32(env, values[i], &value);
    napi_set_element(env, result, i, value);
  }

  return result;
}

std::vector<double> ClassifySearchTexts(
  const std::vector<std::string>& texts,
  const std::string& searchText,
  const std::vector<std::string>& searchWords,
  bool substringSearchEnabled,
  double itemStartBoost,
  double exactMatchBoost,
  double substringBoost
) {
  std::vector<double> result(texts.size(), 0);

  if (searchText.empty()) {
    return result;
  }

  for (size_t i = 0; i < texts.size(); i++) {
    const std::string& text = texts[i];
    const size_t found = text.find(searchText);

    if (found == 0) {
      result[i] = itemStartBoost;
      continue;
    }

    if (found != std::string::npos) {
      result[i] = exactMatchBoost;
      continue;
    }

    if (!substringSearchEnabled) {
      continue;
    }

    bool substringMatch = true;
    for (const std::string& word : searchWords) {
      if (word.empty()) {
        continue;
      }

      if (text.find(word) == std::string::npos) {
        substringMatch = false;
        break;
      }
    }

    if (substringMatch) {
      result[i] = substringBoost;
    }
  }

  return result;
}

napi_value CreateDoubleArray(napi_env env, const std::vector<double>& values) {
  napi_value result;
  napi_create_array_with_length(env, values.size(), &result);

  for (size_t i = 0; i < values.size(); i++) {
    napi_value value;
    napi_create_double(env, values[i], &value);
    napi_set_element(env, result, i, value);
  }

  return result;
}

napi_value CalculateBaseScoreWrapped(napi_env env, napi_callback_info info) {
  size_t argc = 3;
  napi_value argv[3];
  napi_value result;

  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);

  if (argc < 3) {
    napi_throw_type_error(env, nullptr, "Expected lastVisit, visitCount, and urlLength numbers");
    return nullptr;
  }

  double lastVisit = 0;
  double visitCount = 0;
  double urlLength = 0;

  napi_get_value_double(env, argv[0], &lastVisit);
  napi_get_value_double(env, argv[1], &visitCount);
  napi_get_value_double(env, argv[2], &urlLength);

  napi_create_double(env, CalculateBaseScore(lastVisit, visitCount, urlLength), &result);
  return result;
}

napi_value RankCandidateIndexesWrapped(napi_env env, napi_callback_info info) {
  size_t argc = 3;
  napi_value argv[3];

  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);

  if (argc < 3) {
    napi_throw_type_error(env, nullptr, "Expected baseScores, boosts, and limit");
    return nullptr;
  }

  const auto baseScores = GetNumberArray(env, argv[0]);
  const auto boosts = GetNumberArray(env, argv[1]);

  uint32_t limit = 0;
  napi_get_value_uint32(env, argv[2], &limit);

  return CreateUint32Array(env, RankCandidateIndexes(baseScores, boosts, limit));
}

napi_value ClassifySearchTextsWrapped(napi_env env, napi_callback_info info) {
  size_t argc = 7;
  napi_value argv[7];

  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);

  if (argc < 7) {
    napi_throw_type_error(env, nullptr, "Expected texts, searchText, searchWords, substringSearchEnabled, itemStartBoost, exactMatchBoost, and substringBoost");
    return nullptr;
  }

  const auto texts = GetStringArray(env, argv[0]);
  const auto searchText = GetString(env, argv[1]);
  const auto searchWords = GetStringArray(env, argv[2]);

  bool substringSearchEnabled = false;
  napi_get_value_bool(env, argv[3], &substringSearchEnabled);

  double itemStartBoost = 0;
  double exactMatchBoost = 0;
  double substringBoost = 0;
  napi_get_value_double(env, argv[4], &itemStartBoost);
  napi_get_value_double(env, argv[5], &exactMatchBoost);
  napi_get_value_double(env, argv[6], &substringBoost);

  return CreateDoubleArray(
    env,
    ClassifySearchTexts(
      texts,
      searchText,
      searchWords,
      substringSearchEnabled,
      itemStartBoost,
      exactMatchBoost,
      substringBoost
    )
  );
}

napi_value Init(napi_env env, napi_value exports) {
  napi_value fn;
  napi_value rankFn;
  napi_value classifyFn;

  napi_create_function(
    env,
    "calculateBaseScore",
    NAPI_AUTO_LENGTH,
    CalculateBaseScoreWrapped,
    nullptr,
    &fn
  );

  napi_create_function(
    env,
    "rankCandidateIndexes",
    NAPI_AUTO_LENGTH,
    RankCandidateIndexesWrapped,
    nullptr,
    &rankFn
  );

  napi_create_function(
    env,
    "classifySearchTexts",
    NAPI_AUTO_LENGTH,
    ClassifySearchTextsWrapped,
    nullptr,
    &classifyFn
  );

  napi_set_named_property(env, exports, "calculateBaseScore", fn);
  napi_set_named_property(env, exports, "rankCandidateIndexes", rankFn);
  napi_set_named_property(env, exports, "classifySearchTexts", classifyFn);

  return exports;
}

} // namespace

NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)
