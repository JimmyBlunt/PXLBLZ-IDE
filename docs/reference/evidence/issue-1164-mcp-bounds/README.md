# Issue #1164: MCP bounds and authoring admission

The six new cases use the authenticated Worker MCP endpoint, its live editor relay, the real Show store, and a recording durable provider. The saved `.pxlshow` is serialized and reopened through its importer. The exact-size Show rows also execute the exported Pattern through FastReplay against the independent half-red RGB expectation.

| Case | Boundary or result | Focused case time |
| --- | --- | ---: |
| ASCII Show replacement and correction | 60,000 UTF-8 bytes accepted; 60,001 refused `show-too-large`; retry of private candidate `unchanged` | 303 ms |
| Multibyte Show replacement and correction | 60,000 UTF-8 bytes accepted; 60,001 refused while JS string length remains below 60,000; retry `unchanged` | 297 ms |
| Authenticated HTTP body | 67,584 bytes returns HTTP 200 `read`; 67,585 returns HTTP 413 `invalid_request`; private candidate survives | 292 ms |
| Missing Control metadata | Commit refuses `invalid-candidate` at authoring with `control-metadata-unavailable`; new corrected edit saves | 357 ms |
| Missing Library reference | Commit refuses `invalid-candidate` at authoring with `library-reference-unavailable`; new corrected edit saves | 328 ms |
| Portable 3D-only Pattern | Commit saves and `.pxlshow` reopens; route delivery refuses `defines only render3D.` | 316 ms |

Every refusal checks the whole current and durable records, full history, and provider write count. Each corrected or accepted commit checks the authored record with the original Show id/name, one history entry, one durable write, and a reopened `.pxlshow`. The exact Show rows additionally check literal `[0.5, 0, 0]` FastReplay output at 250 ms. The HTTP test pads a `read_show` JSON-RPC request with trailing ASCII whitespace, so its request-body boundary is independent of the Show record limit.

Focused proof: `wrsp-log npm run build` passed (`/tmp/wrsp-log/20260927T003811-77808-npm-run.log`, `EXIT:0`). The requested `wrsp-log npx vitest run src/worker/agent/agentV2Command.runtime.test.ts` passed 43/43 tests in one file, 9.16 s total and 7.79 s test execution (`/tmp/wrsp-log/20260927T003839-79555-npx-vitest.log`, `EXIT:0`). A verbose timing pass also passed 43/43 in 12.09 s total and 10.80 s test execution (`/tmp/wrsp-log/20260927T003852-80472-npx-vitest.log`, `EXIT:0`); its case times are above.

Limits: this tests-only slice does not run Chromium, hardware, or the exact-tip full runner suites. It does not establish completion of parent #1163.
