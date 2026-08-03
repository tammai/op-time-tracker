---
paths:
  - "src/main/**"
  - "src/preload/**"
  - "src/renderer/**"
---
# Security Rules

- **Plan for it, don't just check for it.** Specs for features touching auth, sessions, secrets, PII, or untrusted input must include a Security considerations section (`/task-workflow` has the format) naming concrete risks before implementation starts — not just at review time.
- **No unauthenticated endpoints.** Every OpenProject request requires the stored API key; no anonymous passthrough.
- **The OpenProject API key is a secret.** It lives only in the OS keychain via Electron `safeStorage` (with an `electron-store` fallback only when `safeStorage.isEncryptionAvailable()` returns false, never plaintext). It is never logged, never exposed to the renderer, never passed across IPC, never written to a file in plaintext.
- **All OpenProject HTTP is main-process only.** The renderer communicates only via the `contextBridge`-exposed, narrowly-typed `window.openproject.*` surface. Never expose a generic fetch, never expose the key, never expose `safeStorage`/`electron-store` to the renderer.
- **Renderer hardening.** `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` on the `BrowserWindow`. The preload script exposes only the typed bridge — no Node APIs, no `require`, no `process`.
- **Validate at boundaries.** The OpenProject base URL is user-controlled — validate it's a well-formed `http(s)` URL before building any request from it. Reject anything else on save in onboarding.
- **Never trust raw server shapes.** OpenProject responses are parsed and Zod-validated in the main process before being handed to the renderer. A malformed/hostile server response must not inject arbitrary shapes into the renderer.
- **No path traversal.** Never construct file paths from renderer input without sanitization. (The credential store path is fixed, not user-controlled.)
- **No logging of PII.** Mask the API key, server URL, and any user data in logs. Log only non-sensitive identifiers (work package IDs, counts).
- **Secrets in env only.** No hardcoded credentials or API keys in source code. The user's API key is stored via `safeStorage`, not in `.env`.
- **Dependency rule.** Never add a new dependency without checking its maintenance status and license.