# FastLED document isolation

The official FastLED compiler uses Emscripten pthreads, which require shared
WASM memory. The top-level document and dedicated runtime worker must expose
`crossOriginIsolated === true`; the host must be HTTPS or a trustworthy local
origin such as `http://127.0.0.1`. See the primary
[Emscripten pthreads documentation](https://emscripten.org/docs/porting/pthreads.html)
and [COEP documentation](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Cross-Origin-Embedder-Policy).

Only `/fastled` and `/fastled/` receive `Cross-Origin-Opener-Policy: same-origin`
and `Cross-Origin-Embedder-Policy: credentialless`. The dedicated runtime worker
receives the same COEP policy. Credentialless permits the existing public
Monaco CDN scripts and other cross-origin no-CORS resources without sending
their credentials. Same-origin authenticated API requests retain their normal
credentials. Browser support is established by the runtime capability check,
not by assuming that receipt of a header alone enabled shared memory.

The FastLED entry button completes the existing Pixelblaze save/discard
preflight, then performs a full document navigation. Back to PXLBLZ also loads
a new document. Unsaved FastLED source is protected by `beforeunload` on that
exit, avoiding a duplicate SPA confirmation. Pixelblaze's other routes do not
receive these headers; their OAuth and controller-extension behavior keeps its
existing policy.

`vite.config.ts` applies the policy to development and production-preview
responses with the configured base path. `public/_headers` supplies matching
Cloudflare static-asset rules for the production root base and default
`/PXLBLZ-IDE/` base. Production uses assets-first SPA routing, so these headers
are attached to the requested FastLED document even though it uses the common
`index.html` asset. API routes remain worker-first and are not affected.

Other hosting systems must configure equivalent HTTP response headers;
`_headers` is a Cloudflare asset configuration, not a browser-consumed file.
If deploying under a different static base, add corresponding `_headers`
patterns. See [Cloudflare's static-asset headers documentation](https://developers.cloudflare.com/workers/static-assets/headers/).

Verification should assert both document and runtime-worker isolation, load
the Monaco editor, execute a real threaded FastLED sketch, and verify that
returning to Gallery produces a non-isolated document. Header-selection tests
also ensure that OAuth routes, Studio, Gallery and unrelated assets receive
no FastLED isolation policy.
