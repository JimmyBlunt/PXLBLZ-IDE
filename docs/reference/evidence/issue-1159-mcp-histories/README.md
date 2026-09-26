# #1159 fixed MCP histories

The real Worker, OAuth grant, account relay, browser session, editor admission, Show store, provider writer, and native artifact path execute these fixed histories. Each new case opens a fresh bound editor and closes it in `finally`. The selected seam is `tools/call` plus the saved `.pxlshow` and exported `.epe` consumers.

| History | Command sequence and observed oracle |
| --- | --- |
| A → replacement → B | `set_show_end(30000)`, solid-red `replace_show`, `rename_show`, `commit_edit`: Show End 1000, B name retained, one history preimage/write, exact saved/reopened record, red 1 at 250 ms. |
| Introduced Clip, Undo/Redo | Solid replacement commit, `read_show`, `update_clips` returned Clip with whole-Clip opacity 0.5, commit, Undo, Redo: complete snapshots and durable records at each stage, red 0.5 at 250 ms. |
| Shared then independent | Bounded gain replacement, shared `duplicate_clip` at 500, shared control 0.5, `make_clip_pattern_independent`, copy control 0.75: one adoption per operation, matching then distinct instance IDs, exact saved/reopened record, red 0.5/0.75 at 250/750 ms. |
| Group/Layout | Supported held Group fixture replacement, `move_group_occurrence` from 2000 to 3000: exact definitions, bindings, instances, Layout spans and reopened record; one authored member's exported Fast elapsed advances 250 ms from 6000 to 6250 across the 5000 ms switch. |
| Invalid, corrected, commit/cancel | Valid solid replacement, invalid version 1 refusal, identical valid retry, corrected half-opacity replacement: commit saves only corrected content with one history/write and red 0.5; cancel leaves complete live/durable/history state unchanged. |
| Stale manual edit | Private solid replacement, admitted manual Show End 25000, stale commit: `revision-conflict`; exact manual live/saved/history state remains, with no second write. |
| Keyed retries | Same-key identical replacement replay returns its cached result; changed payload conflicts; same-key commit replay returns its cached initial receipt, final outcome saves once and history has one preimage. |
| Save recovery | Failed solid replacement save rolls back exact original record/history with failure notice. A held first replacement write fails after a newer manual update queues: receipt `superseded`, newer complete record remains live and durable, two provider attempts, no failure notice. |

The red, opacity, and gain values are independent playback values. Group/Layout continuity is a structural and exported-clock oracle; the fixture supplies no independently specified RGB value. The serialized `.pxlshow` is parsed directly for exact record equality. The native artifact helper also checks its exported `.epe`; its separate imported pilot intentionally receives a new id, name, timestamp, and import metadata, so that pilot is not the exact-record oracle.

Focused proof: `wrsp-log npm run build` (`EXIT:0`); `wrsp-log npx vitest run src/worker/agent/agentV2Command.runtime.test.ts src/engine/agentPrivateExecutor.test.ts src/worker/agent/agentMcpRouting.test.ts` (84 passing tests, 3 files, 7.08 s in the green pre-fault run). No product failure was found. The first local run exposed a test-oracle mistake: the native helper's *imported pilot* deliberately gets a new identity; exact reopen assertions now use the serialized file importer. A second local run caught reversed Fast replay calls in the Group test; chronological calls pass.

Fault/control: with only the stale-admission expectation changed to `applied` and the keyed-adoption write expectation changed to two, `wrsp-log npx vitest run src/worker/agent/agentV2Command.runtime.test.ts -t 'refuses a stale replacement|replays keyed replacement'` failed both selected tests (`EXIT:1`): actual stale status `refused`, actual write count one. Both expectations were restored. This demonstrates active assertions, not mutation-qualified production protection.

After restoration, `wrsp-log npm run build` passed (`EXIT:0`) and the same three-file focused command passed 84/84 tests in 7.68 s (`EXIT:0`). Browser UI, hardware, real timer expiry, cross-window behavior, and generated histories are excluded by the fixed-history scope.
