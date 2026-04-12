#include <node_api.h>

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <functional>
#include <string>
#include <vector>

namespace {

struct Range {
  int32_t location = -1;
  int32_t length = 0;

  Range() = default;
  Range(int32_t loc, int32_t len) : location(loc), length(len) {}

  int32_t max() const {
    return location + length;
  }

  int32_t setMax(int32_t value) {
    length = value - location;
    return value;
  }

  bool isValid() const {
    return location > -1;
  }
};

// Mirrors the defaults in quick-score's DefaultConfig (QuickScoreConfig).
struct QuickScoreDefaults {
  // Note: uppercase letters are intentionally omitted here because Min's hot-path
  // callers already pass normalized lowercase strings. The JS wrapper will
  // fall back to the JS implementation when uppercase or non-ASCII appears.
  static constexpr double kIgnoredScore = 0.9;
  static constexpr double kSkippedScore = 0.15;
  static constexpr double kEmptyQueryScore = 0.0;
  static constexpr uint32_t kMaxIterations = 1u << 16;

  static constexpr int32_t kLongStringLength = 150;
  static constexpr double kMaxMatchStartPct = 0.15;
  static constexpr double kMinMatchDensityPct = 0.75;
  static constexpr double kMaxMatchDensityPct = 0.95;
  static constexpr double kBeginningOfStringPct = 0.1;
};

inline bool ContainsChar(const std::string& haystack, char needle) {
  return haystack.find(needle) != std::string::npos;
}

const std::string kWordSeparators = "-/\\:()<>%._=&[]+ \t\n\r";

Range GetRangeOfSubstring(const std::string& string,
                          const std::string& query,
                          const Range& searchRange) {
  const size_t start = static_cast<size_t>(std::max<int32_t>(0, searchRange.location));
  const size_t index = string.find(query, start);
  Range result;

  if (index != std::string::npos && index < static_cast<size_t>(searchRange.max())) {
    result.location = static_cast<int32_t>(index);
    result.length = static_cast<int32_t>(query.length());
  }

  return result;
}

bool UseSkipReduction(const std::string& string, const Range& fullMatchedRange) {
  const double len = static_cast<double>(string.length());
  if (len <= 0) {
    return true;
  }

  const bool isShortString = static_cast<int32_t>(string.length()) <= QuickScoreDefaults::kLongStringLength;
  const double matchStartPercentage = static_cast<double>(fullMatchedRange.location) / len;
  return isShortString || matchStartPercentage < QuickScoreDefaults::kMaxMatchStartPct;
}

double AdjustRemainingScore(const std::string& string,
                            const std::string& query,
                            double remainingScore,
                            bool skippedSpecialChar,
                            const Range& searchRange,
                            const Range& remainingSearchRange,
                            const Range& matchedRange,
                            const Range& fullMatchedRange) {
  const double len = static_cast<double>(string.length());
  const bool isShortString = static_cast<int32_t>(string.length()) <= QuickScoreDefaults::kLongStringLength;
  const double matchStartPercentage = len > 0 ? (static_cast<double>(fullMatchedRange.location) / len) : 0;

  double matchRangeDiscount = 1;
  double matchStartDiscount = 1 - matchStartPercentage;

  if (!skippedSpecialChar) {
    matchRangeDiscount = query.length() > 0 ? (static_cast<double>(query.length()) / static_cast<double>(fullMatchedRange.length)) : 1;

    if (isShortString &&
        matchStartPercentage <= QuickScoreDefaults::kBeginningOfStringPct &&
        matchRangeDiscount >= QuickScoreDefaults::kMinMatchDensityPct) {
      matchRangeDiscount = 1;
    }

    if (matchRangeDiscount >= QuickScoreDefaults::kMaxMatchDensityPct) {
      matchStartDiscount = 1;
    }
  }

  const double cappedRemainingLen = std::min<double>(
    static_cast<double>(remainingSearchRange.length),
    static_cast<double>(QuickScoreDefaults::kLongStringLength)
  );

  (void)searchRange;
  (void)matchedRange;

  return remainingScore * cappedRemainingLen * matchRangeDiscount * matchStartDiscount;
}

double QuickScoreLowerAscii(const std::string& string, const std::string& query) {
  if (query.empty()) {
    return QuickScoreDefaults::kEmptyQueryScore;
  }

  const std::string& transformedString = string;
  const std::string& transformedQuery = query;

  uint32_t iterations = 0;

  const Range stringRange(0, static_cast<int32_t>(string.length()));
  const Range queryRange(0, static_cast<int32_t>(query.length()));
  Range fullMatchedRange;

  std::function<double(Range, Range, Range&)> calcScore = [&](Range searchRange, Range qRange, Range& fullRange) -> double {
    if (qRange.length <= 0) {
      return QuickScoreDefaults::kIgnoredScore;
    }

    if (qRange.length > searchRange.length) {
      return 0;
    }

    for (int32_t i = qRange.length; i > 0; i--) {
      if (iterations > QuickScoreDefaults::kMaxIterations) {
        return 0;
      }
      iterations++;

      const std::string querySubstring = transformedQuery.substr(static_cast<size_t>(qRange.location), static_cast<size_t>(i));
      const Range limitedSearchRange(
        searchRange.location,
        searchRange.length - qRange.length + i
      );

      Range matchedRange = GetRangeOfSubstring(transformedString, querySubstring, limitedSearchRange);
      if (!matchedRange.isValid()) {
        continue;
      }

      if (!fullRange.isValid()) {
        fullRange.location = matchedRange.location;
      } else {
        fullRange.location = std::min(fullRange.location, matchedRange.location);
      }

      fullRange.setMax(std::max(fullRange.max(), matchedRange.max()));

      const Range remainingSearchRange(
        matchedRange.max(),
        searchRange.max() - matchedRange.max()
      );
      const Range remainingQueryRange(
        qRange.location + i,
        qRange.length - i
      );

      double remainingScore = calcScore(remainingSearchRange, remainingQueryRange, fullRange);
      if (!remainingScore) {
        continue;
      }

      double score = remainingSearchRange.location - searchRange.location;
      bool skippedSpecialChar = true;
      const bool useSkipReduction = UseSkipReduction(string, fullRange);

      if (matchedRange.location > searchRange.location) {
        if (useSkipReduction && ContainsChar(kWordSeparators, string[static_cast<size_t>(matchedRange.location - 1)])) {
          for (int32_t j = matchedRange.location - 2; j >= searchRange.location; j--) {
            if (ContainsChar(kWordSeparators, string[static_cast<size_t>(j)])) {
              score -= 1;
            } else {
              score -= QuickScoreDefaults::kSkippedScore;
            }
          }
        } else {
          score -= matchedRange.location - searchRange.location;
          skippedSpecialChar = false;
        }
      }

      score += AdjustRemainingScore(
        string,
        query,
        remainingScore,
        skippedSpecialChar,
        searchRange,
        remainingSearchRange,
        matchedRange,
        fullRange
      );
      score /= static_cast<double>(searchRange.length);
      return score;
    }

    return 0;
  };

  return calcScore(stringRange, queryRange, fullMatchedRange);
}

std::string GetString(napi_env env, napi_value value) {
  size_t length = 0;
  napi_get_value_string_utf8(env, value, nullptr, 0, &length);

  std::vector<char> buffer(length + 1, '\0');
  napi_get_value_string_utf8(env, value, buffer.data(), buffer.size(), &length);

  return std::string(buffer.data(), length);
}

bool GetStringArray(napi_env env, napi_value arrayValue, std::vector<std::string>* out) {
  uint32_t length = 0;
  if (napi_get_array_length(env, arrayValue, &length) != napi_ok) {
    return false;
  }

  out->clear();
  out->reserve(length);

  for (uint32_t i = 0; i < length; i++) {
    napi_value element;
    napi_get_element(env, arrayValue, i, &element);
    out->push_back(GetString(env, element));
  }

  return true;
}

napi_value QuickScoreWrapped(napi_env env, napi_callback_info info) {
  size_t argc = 2;
  napi_value argv[2];
  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);

  if (argc < 2) {
    napi_throw_type_error(env, nullptr, "Expected string and query");
    return nullptr;
  }

  const std::string string = GetString(env, argv[0]);
  const std::string query = GetString(env, argv[1]);

  napi_value result;
  napi_create_double(env, QuickScoreLowerAscii(string, query), &result);
  return result;
}

napi_value QuickScoreBatchWrapped(napi_env env, napi_callback_info info) {
  size_t argc = 2;
  napi_value argv[2];
  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);

  if (argc < 2) {
    napi_throw_type_error(env, nullptr, "Expected strings array and query");
    return nullptr;
  }

  std::vector<std::string> strings;
  if (!GetStringArray(env, argv[0], &strings)) {
    napi_throw_type_error(env, nullptr, "Expected strings array and query");
    return nullptr;
  }

  const std::string query = GetString(env, argv[1]);

  napi_value result;
  napi_create_array_with_length(env, strings.size(), &result);

  for (size_t i = 0; i < strings.size(); i++) {
    napi_value scoreValue;
    napi_create_double(env, QuickScoreLowerAscii(strings[i], query), &scoreValue);
    napi_set_element(env, result, i, scoreValue);
  }

  return result;
}

napi_value CreateExports(napi_env env) {
  napi_value exports;
  napi_create_object(env, &exports);

  napi_value quickScoreFn;
  napi_create_function(env, "quickScore", NAPI_AUTO_LENGTH, QuickScoreWrapped, nullptr, &quickScoreFn);
  napi_set_named_property(env, exports, "quickScore", quickScoreFn);

  napi_value quickScoreBatchFn;
  napi_create_function(env, "quickScoreBatch", NAPI_AUTO_LENGTH, QuickScoreBatchWrapped, nullptr, &quickScoreBatchFn);
  napi_set_named_property(env, exports, "quickScoreBatch", quickScoreBatchFn);

  return exports;
}

} // namespace

NAPI_MODULE_INIT() {
  return CreateExports(env);
}
