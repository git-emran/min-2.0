# Security Policy

## Native C++ Addons & Memory Safety Guidelines

Min incorporates optional native C++ node-addons (`abp_match_cache.node`, `tracking_params.node`, `quick_score.node`, etc.) to accelerate performance-critical paths such as network request URL processing and search scoring.

Because network URLs and filter parameters are shaped by external untrusted web content:
1. **Sandboxing & Isolation**: Native addons handling network interception (`tracking_params.node`, `abp_match_cache.node`) run exclusively in Electron's Main Process. UI search scoring addons run isolated inside the Browser UI frame context. Neither is accessible from untrusted webview page renderers.
2. **Sanitizers (ASan / UBSan)**: Native modules should be compiled with AddressSanitizer (`-fsanitize=address`) and UndefinedBehaviorSanitizer (`-fsanitize=undefined`) during native development and security audit test cycles to catch out-of-bound reads, buffer overflows, or undefined behavior.
3. **Fuzzing & Adversarial Testing**: Native URL and string parsers are subjected to automated fuzz testing (e.g. via `libFuzzer` / `AFL++`) with malformed and adversarial URL/query strings to ensure memory safety prior to shipping updates.

## Reporting a Vulnerability

The preferred way to report vulnerabilities is through Github ([here](https://github.com/minbrowser/min/security/advisories/new)). You can also email @palmerAL directly at 280953907a@zoho.com; however, I may be slower to respond there.
