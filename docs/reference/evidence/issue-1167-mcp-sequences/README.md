# Issue #1167: authenticated MCP command sequences

The five new cases run through the authenticated Worker MCP endpoint, live editor relay, personal-content recording provider, and real Show store. Each accepted Show is serialized as a raw `.pxlshow`, reopened through the importer, and compared with an independently constructed complete record. FastReplay checks literal RGB frames. Generated identities enter expected records only as opaque IDs, with uniqueness and references checked separately.

The recording editor now uses a distinct `mcp-v2-personal-<n>` identity per binding. Each Show is seeded in Miniflare D1 for the Worker channel's real same-account access check; the recording provider owns the Show document and its writes. This exercises personal persistence and avoids accidentally selecting a stock Lesson route. The fixture does not create a Show through browser UI; #1166 owns that path.

| Case | Main consumer result | New case time |
| --- | --- | ---: |
| Transition refusal and correction | Over-end insertion refuses; explicit Show End extension permits the crossfade; midpoint is half red and half green | 489 ms |
| Effect and Property animation | Quarter-brightness first save supplies the public Effect ID; half-brightness and opacity keys save in a second edit | 281 ms |
| Zone, Layout, Marker | Metadata and 0.8 split routing persist; the second interval routes both sample points to red | 257 ms |
| Shared, independent, empty | Four Clip spans preserve two runtime identities; final deletion reopens as empty; Undo restores content | 290 ms |
| Missing Stage map | Structurally valid replacement refuses at normalized final admission; a corrected new edit saves | 254 ms |

The Effect case intentionally has two writes and two history entries because `add_clip_effect` exposes its generated identity through the saved public record. The other accepted single-edit cases require one write and one history entry. Every private candidate and refusal checks complete live and durable records, full history, and write count before commit.

Focused proof: `wrsp-log npm run build` passed (`/tmp/wrsp-log/20260927T011842-51363-npm-run.log`, `EXIT:0`). The requested `wrsp-log npx vitest run src/worker/agent/agentV2Command.runtime.test.ts` passed 48/48 tests in one file, 12.55 s total and 11.36 s test execution (`/tmp/wrsp-log/20260927T011905-52245-npx-vitest.log`, `EXIT:0`). A verbose five-case timing pass passed 5/5 in 2.94 s total and 1.63 s test execution (`/tmp/wrsp-log/20260927T011928-53408-npx-vitest.log`, `EXIT:0`); its case times are above.

Limits: this tests-only slice does not run Chromium, hardware, or the exact-tip full runner suites. It does not establish completion of parent #1163.
