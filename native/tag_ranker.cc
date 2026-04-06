#include <node_api.h>

#include <algorithm>
#include <cmath>
#include <string>
#include <unordered_map>
#include <unordered_set>
#include <vector>

namespace {

using NumberMap = std::unordered_map<std::string, double>;
using NestedNumberMap = std::unordered_map<std::string, NumberMap>;
using StringMap = std::unordered_map<std::string, std::string>;

bool EndsWith(const std::string& value, const std::string& suffix) {
  return value.size() >= suffix.size() &&
    value.compare(value.size() - suffix.size(), suffix.size(), suffix) == 0;
}

napi_value GetNamedProperty(napi_env env, napi_value object, const char* name) {
  napi_value value;
  napi_get_named_property(env, object, name, &value);
  return value;
}

std::string GetString(napi_env env, napi_value value) {
  size_t length = 0;
  napi_get_value_string_utf8(env, value, nullptr, 0, &length);

  std::vector<char> buffer(length + 1, '\0');
  napi_get_value_string_utf8(env, value, buffer.data(), buffer.size(), &length);

  return std::string(buffer.data(), length);
}

double GetNumber(napi_env env, napi_value value) {
  double result = 0;
  napi_get_value_double(env, value, &result);
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

NumberMap GetNumberMap(napi_env env, napi_value objectValue) {
  napi_value propertyNames;
  napi_get_property_names(env, objectValue, &propertyNames);

  uint32_t length = 0;
  napi_get_array_length(env, propertyNames, &length);

  NumberMap result;
  result.reserve(length);

  for (uint32_t i = 0; i < length; i++) {
    napi_value keyValue;
    napi_get_element(env, propertyNames, i, &keyValue);

    const std::string key = GetString(env, keyValue);
    napi_value value;
    napi_get_property(env, objectValue, keyValue, &value);

    result[key] = GetNumber(env, value);
  }

  return result;
}

NestedNumberMap GetNestedNumberMap(napi_env env, napi_value objectValue) {
  napi_value propertyNames;
  napi_get_property_names(env, objectValue, &propertyNames);

  uint32_t length = 0;
  napi_get_array_length(env, propertyNames, &length);

  NestedNumberMap result;
  result.reserve(length);

  for (uint32_t i = 0; i < length; i++) {
    napi_value keyValue;
    napi_get_element(env, propertyNames, i, &keyValue);

    const std::string key = GetString(env, keyValue);
    napi_value nestedValue;
    napi_get_property(env, objectValue, keyValue, &nestedValue);

    result[key] = GetNumberMap(env, nestedValue);
  }

  return result;
}

StringMap GetStringMap(napi_env env, napi_value objectValue) {
  napi_value propertyNames;
  napi_get_property_names(env, objectValue, &propertyNames);

  uint32_t length = 0;
  napi_get_array_length(env, propertyNames, &length);

  StringMap result;
  result.reserve(length);

  for (uint32_t i = 0; i < length; i++) {
    napi_value keyValue;
    napi_get_element(env, propertyNames, i, &keyValue);

    const std::string key = GetString(env, keyValue);
    napi_value value;
    napi_get_property(env, objectValue, keyValue, &value);

    result[key] = GetString(env, value);
  }

  return result;
}

struct TagValue {
  std::string tag;
  double value;
};

std::vector<TagValue> RankTags(
  const std::vector<std::string>& tokens,
  const NumberMap& termDocCounts,
  const NestedNumberMap& termTags,
  const NumberMap& tagCounts,
  const StringMap& tagFirstTokens
) {
  NumberMap scores;
  NumberMap contributingDocs;
  NumberMap contributingTerms;

  for (const std::string& term : tokens) {
    const auto termTagsIt = termTags.find(term);
    if (termTagsIt == termTags.end()) {
      continue;
    }

    for (const auto& [tag, docsWithTag] : termTagsIt->second) {
      if (!scores.count(tag)) {
        scores[tag] = 0;
        contributingDocs[tag] = 0;
        contributingTerms[tag] = 0;
      }

      const auto tagCountIt = tagCounts.find(tag);
      if (tagCountIt == tagCounts.end() || tagCountIt->second < 2) {
        continue;
      }

      const auto termDocCountIt = termDocCounts.find(term);
      const double docsForTerm = termDocCountIt == termDocCounts.end() || termDocCountIt->second <= 0
        ? 1
        : termDocCountIt->second;

      scores[tag] += std::pow(docsWithTag / docsForTerm, 2) * (0.85 + 0.1 * std::sqrt(docsForTerm));
      contributingDocs[tag] += docsWithTag;
      contributingTerms[tag] += 1;
    }
  }

  std::vector<TagValue> result;
  result.reserve(scores.size());

  for (const auto& [tag, scoreValue] : scores) {
    double finalScore = scoreValue;

    const auto tagFirstTokenIt = tagFirstTokens.find(tag);
    if (tagFirstTokenIt != tagFirstTokens.end() &&
        std::find(tokens.begin(), tokens.end(), tagFirstTokenIt->second) != tokens.end()) {
      finalScore *= 1.5;
    }

    if (contributingDocs[tag] <= 1 || contributingTerms[tag] <= 1) {
      finalScore = 0;
    }

    result.push_back({tag, finalScore});
  }

  std::sort(result.begin(), result.end(), [](const TagValue& a, const TagValue& b) {
    return a.value > b.value;
  });

  return result;
}

double ScoreRequiredTags(
  const std::vector<std::string>& tokens,
  const std::vector<std::string>& requiredTags,
  const NumberMap& termDocCounts,
  const NestedNumberMap& termTags,
  const NumberMap& tagCounts,
  const StringMap& tagFirstTokens,
  double minimumScore
) {
  if (requiredTags.empty()) {
    return 0;
  }

  const std::unordered_set<std::string> tokenSet(tokens.begin(), tokens.end());
  NumberMap scores;
  NumberMap contributingDocs;
  NumberMap contributingTerms;

  for (const std::string& tag : requiredTags) {
    scores[tag] = 0;
    contributingDocs[tag] = 0;
    contributingTerms[tag] = 0;
  }

  for (const std::string& term : tokens) {
    const auto termTagsIt = termTags.find(term);
    if (termTagsIt == termTags.end()) {
      continue;
    }

    const auto termDocCountIt = termDocCounts.find(term);
    const double docsForTerm = termDocCountIt == termDocCounts.end() || termDocCountIt->second <= 0
      ? 1
      : termDocCountIt->second;

    for (const std::string& tag : requiredTags) {
      const auto tagCountIt = tagCounts.find(tag);
      if (tagCountIt == tagCounts.end() || tagCountIt->second < 2) {
        continue;
      }

      const auto docsWithTagIt = termTagsIt->second.find(tag);
      if (docsWithTagIt == termTagsIt->second.end()) {
        continue;
      }

      const double docsWithTag = docsWithTagIt->second;
      scores[tag] += std::pow(docsWithTag / docsForTerm, 2) * (0.85 + 0.1 * std::sqrt(docsForTerm));
      contributingDocs[tag] += docsWithTag;
      contributingTerms[tag] += 1;
    }
  }

  double totalScore = 0;

  for (const std::string& tag : requiredTags) {
    double finalScore = scores[tag];

    const auto tagFirstTokenIt = tagFirstTokens.find(tag);
    if (tagFirstTokenIt != tagFirstTokens.end() && tokenSet.count(tagFirstTokenIt->second)) {
      finalScore *= 1.5;
    }

    if (contributingDocs[tag] <= 1 || contributingTerms[tag] <= 1) {
      finalScore = 0;
    }

    if (finalScore < minimumScore) {
      return 0;
    }

    totalScore += finalScore;
  }

  return totalScore;
}

std::vector<std::string> AutocompleteTags(
  const std::vector<std::string>& searchTags,
  const NumberMap& tagCounts,
  const NestedNumberMap& tagTagMap,
  const NumberMap& tagUpdateTimes,
  double now
) {
  std::vector<TagValue> scores;
  scores.reserve(tagCounts.size());

  for (const auto& [tag, tagCount] : tagCounts) {
    double score = tagCount;

    for (const std::string& searchTag : searchTags) {
      const auto tagTagIt = tagTagMap.find(searchTag);
      if (tagTagIt == tagTagMap.end()) {
        score = 0;
        break;
      }

      const auto relatedTagIt = tagTagIt->second.find(tag);
      score *= relatedTagIt == tagTagIt->second.end() ? 0 : relatedTagIt->second;
    }

    if (score > 0) {
      const auto updateTimeIt = tagUpdateTimes.find(tag);
      const double tagUpdateTime = updateTimeIt == tagUpdateTimes.end() ? 0 : updateTimeIt->second;
      score *= std::max(2.0 - ((now - tagUpdateTime) / (14.0 * 24.0 * 60.0 * 60.0 * 1000.0)), 1.0);
    }

    if (score > 0) {
      scores.push_back({tag, score});
    }
  }

  std::sort(scores.begin(), scores.end(), [](const TagValue& a, const TagValue& b) {
    return a.value > b.value;
  });

  std::vector<std::string> result;
  result.reserve(scores.size());

  for (const TagValue& item : scores) {
    result.push_back(item.tag);
  }

  return result;
}

napi_value CreateTagValueArray(napi_env env, const std::vector<TagValue>& values) {
  napi_value result;
  napi_create_array_with_length(env, values.size(), &result);

  for (size_t i = 0; i < values.size(); i++) {
    napi_value item;
    napi_create_object(env, &item);

    napi_value tagValue;
    napi_create_string_utf8(env, values[i].tag.c_str(), values[i].tag.size(), &tagValue);
    napi_set_named_property(env, item, "tag", tagValue);

    napi_value scoreValue;
    napi_create_double(env, values[i].value, &scoreValue);
    napi_set_named_property(env, item, "value", scoreValue);

    napi_set_element(env, result, i, item);
  }

  return result;
}

napi_value CreateStringArray(napi_env env, const std::vector<std::string>& values) {
  napi_value result;
  napi_create_array_with_length(env, values.size(), &result);

  for (size_t i = 0; i < values.size(); i++) {
    napi_value item;
    napi_create_string_utf8(env, values[i].c_str(), values[i].size(), &item);
    napi_set_element(env, result, i, item);
  }

  return result;
}

napi_value RankTagsWrapped(napi_env env, napi_callback_info info) {
  size_t argc = 5;
  napi_value argv[5];
  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);

  if (argc < 5) {
    napi_throw_type_error(env, nullptr, "Expected tokens, termDocCounts, termTags, tagCounts, and tagFirstTokens");
    return nullptr;
  }

  const auto tokens = GetStringArray(env, argv[0]);
  const auto termDocCounts = GetNumberMap(env, argv[1]);
  const auto termTags = GetNestedNumberMap(env, argv[2]);
  const auto tagCounts = GetNumberMap(env, argv[3]);
  const auto tagFirstTokenStrings = GetStringMap(env, argv[4]);

  return CreateTagValueArray(env, RankTags(tokens, termDocCounts, termTags, tagCounts, tagFirstTokenStrings));
}

napi_value ScoreRequiredTagsWrapped(napi_env env, napi_callback_info info) {
  size_t argc = 7;
  napi_value argv[7];
  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);

  if (argc < 7) {
    napi_throw_type_error(env, nullptr, "Expected tokens, requiredTags, termDocCounts, termTags, tagCounts, tagFirstTokens, and minimumScore");
    return nullptr;
  }

  const auto tokens = GetStringArray(env, argv[0]);
  const auto requiredTags = GetStringArray(env, argv[1]);
  const auto termDocCounts = GetNumberMap(env, argv[2]);
  const auto termTags = GetNestedNumberMap(env, argv[3]);
  const auto tagCounts = GetNumberMap(env, argv[4]);
  const auto tagFirstTokens = GetStringMap(env, argv[5]);
  const double minimumScore = GetNumber(env, argv[6]);

  napi_value result;
  napi_create_double(
    env,
    ScoreRequiredTags(tokens, requiredTags, termDocCounts, termTags, tagCounts, tagFirstTokens, minimumScore),
    &result
  );

  return result;
}

napi_value AutocompleteTagsWrapped(napi_env env, napi_callback_info info) {
  size_t argc = 5;
  napi_value argv[5];
  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);

  if (argc < 5) {
    napi_throw_type_error(env, nullptr, "Expected searchTags, tagCounts, tagTagMap, tagUpdateTimes, and now");
    return nullptr;
  }

  const auto searchTags = GetStringArray(env, argv[0]);
  const auto tagCounts = GetNumberMap(env, argv[1]);
  const auto tagTagMap = GetNestedNumberMap(env, argv[2]);
  const auto tagUpdateTimes = GetNumberMap(env, argv[3]);
  const double now = GetNumber(env, argv[4]);

  return CreateStringArray(env, AutocompleteTags(searchTags, tagCounts, tagTagMap, tagUpdateTimes, now));
}

napi_value Init(napi_env env, napi_value exports) {
  napi_value rankTagsFn;
  napi_value autocompleteTagsFn;
  napi_value scoreRequiredTagsFn;

  napi_create_function(env, "rankTags", NAPI_AUTO_LENGTH, RankTagsWrapped, nullptr, &rankTagsFn);
  napi_create_function(env, "autocompleteTags", NAPI_AUTO_LENGTH, AutocompleteTagsWrapped, nullptr, &autocompleteTagsFn);
  napi_create_function(env, "scoreRequiredTags", NAPI_AUTO_LENGTH, ScoreRequiredTagsWrapped, nullptr, &scoreRequiredTagsFn);

  napi_set_named_property(env, exports, "rankTags", rankTagsFn);
  napi_set_named_property(env, exports, "autocompleteTags", autocompleteTagsFn);
  napi_set_named_property(env, exports, "scoreRequiredTags", scoreRequiredTagsFn);

  return exports;
}

} // namespace

NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)
