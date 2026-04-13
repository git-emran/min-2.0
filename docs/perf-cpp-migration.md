# Performance + C++ Migration Plan (Incremental)

This repo already uses optional native (C++) addons to keep UI responsive on CPU-heavy paths (search scoring, tokenization, tag ranking). The goal of this plan is to expand native coverage *incrementally*, with strict JS fallbacks and verification scripts so changes are safe to land without breaking anything.

## Current native addons

- `native/quick_score.cc` (JS wrapper: `js/util/quickScore.js`)
- `native/history_score.cc` (JS wrapper: `js/places/historyScore.js`)
- `native/places_tokenizer.cc` (JS wrapper: `js/places/historyTokenizer.js`)
- `native/tag_ranker.cc` (JS wrapper: `js/places/tagRanker.js`)

## Phase 0 (landed scaffolding)

### Ticket: Fast-path tracking param detection (safe, no behavior change)

**Why:** `main/filtering.js` runs on every request. `removeTrackingParams()` currently constructs a `URL` object even when no removable params exist. Avoiding that work reduces CPU overhead under load.

**What shipped:**

- New optional addon: `native/tracking_params.cc` → `native/build/Release/tracking_params.node`
- `main/filtering.js` uses the addon (if present) only to decide whether `URL()` parsing is necessary. If it’s uncertain, it forces the JS path.
- Verification script: `scripts/verifyNativeTrackingParams.js` (run via `npm run verifyNativeTrackingParams`)

**Acceptance criteria:**

- With native addon absent: identical behavior.
- With native addon present: identical URL rewriting results (the addon only gates whether URL parsing happens; rewriting stays in JS).

### Ticket: Native ABP match memoization (safe, behavior-preserving)

**Why:** The ABP engine (`parser.matches(...)`) runs in `main/filtering.js` inside `ses.webRequest.onBeforeRequest`. Many resource URLs are repeated (CDNs, script bundles, trackers). Memoizing the final allow/block decision short-circuits repeated matching work.

**What shipped:**

- New optional addon: `native/abp_match_cache.cc` → `native/build/Release/abp_match_cache.node`
- `main/filtering.js` uses it as an LRU cache keyed by `(blockingLevel|baseDomain|elementType|urlLower)`
- Verification script: `scripts/verifyNativeAbpCache.js` (run via `npm run verifyNativeAbpCache`)

**Acceptance criteria:**

- With addon absent: identical behavior.
- With addon present: identical allow/block decisions (cache only short-circuits on exact key hits).

## Next incremental targets (recommended order)

### Ticket 1: Native ABP matching fast-path (highest payoff, moderate complexity)

**Target:** `parser.matches(...)` in `main/filtering.js` (`ses.webRequest.onBeforeRequest`)

**Incremental approach:**

1. Start with a native “fast reject” path (very low risk): quickly return “no match” for obvious non-matches based on cheap rule indexes.
2. Keep the current JS ABP parser as the source of truth; only use native when it can prove “no match”.
3. Add a shadow-mode verifier (dev-only) that compares native vs JS match decisions on a sampled subset of requests.

**Acceptance criteria:**

- 100% identical block/allow decisions in shadow mode (for recorded samples).
- No new crashes when addon is missing.

### Ticket 2: Native full-text ranking/snippet (high payoff, moderate complexity)

**Target:** tight loops in `js/places/fullTextSearch.js` (BM25 + snippet generation).

**Incremental approach:**

- Move pure computation into native functions called from the places worker, with JS fallback.
- Keep input/output JSON-compatible and add a verifier script that compares outputs for a fixed dataset.

### Ticket 3: Preview encoding pipeline (medium payoff, lower complexity)

**Target:** `capturePage().toDataURL()` path in `main/viewManager.js`.

**Incremental approach:**

- Return an encoded binary buffer (jpeg/webp) instead of a base64 data URL, behind an “acceptsBuffer” capability check in the renderer.
- Keep old dataURL path for compatibility.

## Guardrails (non-negotiable)

- Always optional: app must run without any `.node` addons.
- JS is the source of truth until verified (shadow mode + dedicated scripts).
- Add native functionality behind small, testable surfaces (one function at a time).
