#include <node_api.h>

#include <cstdint>
#include <list>
#include <string>
#include <unordered_map>
#include <utility>
#include <vector>

namespace {

struct Entry {
  bool value = false;
  std::list<std::string>::iterator lruIt;
};

size_t g_capacity = 50000;
std::list<std::string> g_lru;  // most-recent at front
std::unordered_map<std::string, Entry> g_map;

std::string GetString(napi_env env, napi_value value) {
  size_t length = 0;
  napi_get_value_string_utf8(env, value, nullptr, 0, &length);

  std::vector<char> buffer(length + 1, '\0');
  napi_get_value_string_utf8(env, value, buffer.data(), buffer.size(), &length);

  return std::string(buffer.data(), length);
}

inline void Touch(Entry& entry) {
  g_lru.splice(g_lru.begin(), g_lru, entry.lruIt);
  entry.lruIt = g_lru.begin();
}

void EnsureCapacity() {
  while (g_map.size() > g_capacity && !g_lru.empty()) {
    const std::string& key = g_lru.back();
    g_map.erase(key);
    g_lru.pop_back();
  }
}

napi_value InitWrapped(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);

  if (argc >= 1) {
    uint32_t cap = 0;
    if (napi_get_value_uint32(env, argv[0], &cap) == napi_ok && cap > 0) {
      g_capacity = static_cast<size_t>(cap);
    }
  }

  // keep existing entries but shrink if needed
  EnsureCapacity();

  napi_value result;
  napi_get_boolean(env, true, &result);
  return result;
}

napi_value ClearWrapped(napi_env env, napi_callback_info info) {
  (void)info;
  g_map.clear();
  g_lru.clear();

  napi_value result;
  napi_get_boolean(env, true, &result);
  return result;
}

// Returns: -1 (miss), 0 (false), 1 (true)
napi_value GetWrapped(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);

  if (argc < 1) {
    napi_throw_type_error(env, nullptr, "Expected a cache key string");
    return nullptr;
  }

  const std::string key = GetString(env, argv[0]);
  const auto it = g_map.find(key);

  napi_value result;
  if (it == g_map.end()) {
    napi_create_int32(env, -1, &result);
    return result;
  }

  Touch(it->second);
  napi_create_int32(env, it->second.value ? 1 : 0, &result);
  return result;
}

napi_value SetWrapped(napi_env env, napi_callback_info info) {
  size_t argc = 2;
  napi_value argv[2];
  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);

  if (argc < 2) {
    napi_throw_type_error(env, nullptr, "Expected key string and boolean value");
    return nullptr;
  }

  const std::string key = GetString(env, argv[0]);

  bool value = false;
  napi_get_value_bool(env, argv[1], &value);

  const auto it = g_map.find(key);
  if (it != g_map.end()) {
    it->second.value = value;
    Touch(it->second);
  } else {
    g_lru.push_front(key);
    Entry entry;
    entry.value = value;
    entry.lruIt = g_lru.begin();
    g_map.emplace(key, entry);
    EnsureCapacity();
  }

  napi_value result;
  napi_get_boolean(env, true, &result);
  return result;
}

napi_value SizeWrapped(napi_env env, napi_callback_info info) {
  (void)info;
  napi_value result;
  napi_create_uint32(env, static_cast<uint32_t>(g_map.size()), &result);
  return result;
}

napi_value CapacityWrapped(napi_env env, napi_callback_info info) {
  (void)info;
  napi_value result;
  napi_create_uint32(env, static_cast<uint32_t>(g_capacity), &result);
  return result;
}

napi_value Init(napi_env env, napi_value exports) {
  napi_property_descriptor descriptors[] = {
    {"init", nullptr, InitWrapped, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"clear", nullptr, ClearWrapped, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"get", nullptr, GetWrapped, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"set", nullptr, SetWrapped, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"size", nullptr, SizeWrapped, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"capacity", nullptr, CapacityWrapped, nullptr, nullptr, nullptr, napi_default, nullptr},
  };

  napi_define_properties(env, exports, sizeof(descriptors) / sizeof(descriptors[0]), descriptors);
  return exports;
}

}  // namespace

NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)

