#include <node_api.h>

#include <algorithm>
#include <cctype>
#include <cstdint>
#include <string>
#include <unordered_set>
#include <vector>

namespace {

std::unordered_set<std::string> g_keys;
bool g_initialized = false;

std::string GetString(napi_env env, napi_value value) {
  size_t length = 0;
  napi_get_value_string_utf8(env, value, nullptr, 0, &length);

  std::vector<char> buffer(length + 1, '\0');
  napi_get_value_string_utf8(env, value, buffer.data(), buffer.size(), &length);

  return std::string(buffer.data(), length);
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

inline bool ContainsPercentEncoding(const std::string& value) {
  return value.find('%') != std::string::npos;
}

bool QueryContainsKey(const std::string& query, const std::unordered_set<std::string>& keys) {
  // Parse query-string keys without decoding. We intentionally bail out to
  // "true" (do JS URL parsing) if there's any percent-encoding, because keys
  // may be encoded and we'd rather be conservative than miss a removable param.
  if (query.empty()) {
    return false;
  }

  if (ContainsPercentEncoding(query)) {
    return true;
  }

  size_t start = 0;
  while (start <= query.size()) {
    const size_t end = query.find('&', start);
    const size_t partEnd = (end == std::string::npos) ? query.size() : end;

    if (partEnd > start) {
      const size_t eq = query.find('=', start);
      const size_t keyEnd = (eq != std::string::npos && eq < partEnd) ? eq : partEnd;
      if (keyEnd > start) {
        const std::string key = query.substr(start, keyEnd - start);
        if (keys.find(key) != keys.end()) {
          return true;
        }
      }
    }

    if (end == std::string::npos) {
      break;
    }
    start = end + 1;
  }

  return false;
}

bool UrlHasRemovableTrackingParams(const std::string& url, const std::unordered_set<std::string>& keys) {
  // Only consider standard query-string, stop at fragment.
  const size_t q = url.find('?');
  if (q == std::string::npos) {
    return false;
  }

  const size_t fragment = url.find('#', q + 1);
  const size_t queryStart = q + 1;
  const size_t queryEnd = (fragment == std::string::npos) ? url.size() : fragment;
  if (queryEnd <= queryStart) {
    return false;
  }

  return QueryContainsKey(url.substr(queryStart, queryEnd - queryStart), keys);
}

napi_value InitWrapped(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);

  if (argc < 1) {
    napi_throw_type_error(env, nullptr, "Expected an array of key names");
    return nullptr;
  }

  bool isArray = false;
  napi_is_array(env, argv[0], &isArray);
  if (!isArray) {
    napi_throw_type_error(env, nullptr, "Expected an array of key names");
    return nullptr;
  }

  const std::vector<std::string> keys = GetStringArray(env, argv[0]);
  g_keys.clear();
  g_keys.reserve(keys.size());
  for (const std::string& key : keys) {
    if (!key.empty()) {
      g_keys.insert(key);
    }
  }
  g_initialized = true;

  napi_value result;
  napi_get_boolean(env, true, &result);
  return result;
}

napi_value IsInitializedWrapped(napi_env env, napi_callback_info info) {
  (void)info;
  napi_value result;
  napi_get_boolean(env, g_initialized, &result);
  return result;
}

napi_value HasRemovableParamsWrapped(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);

  if (argc < 1) {
    napi_throw_type_error(env, nullptr, "Expected a url string");
    return nullptr;
  }

  const std::string url = GetString(env, argv[0]);
  const bool has = g_initialized && UrlHasRemovableTrackingParams(url, g_keys);

  napi_value result;
  napi_get_boolean(env, has, &result);
  return result;
}

napi_value Init(napi_env env, napi_value exports) {
  napi_property_descriptor descriptors[] = {
    {"init", nullptr, InitWrapped, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"isInitialized", nullptr, IsInitializedWrapped, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"hasRemovableTrackingParams", nullptr, HasRemovableParamsWrapped, nullptr, nullptr, nullptr, napi_default, nullptr},
  };

  napi_define_properties(env, exports, sizeof(descriptors) / sizeof(descriptors[0]), descriptors);
  return exports;
}

}  // namespace

NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)

