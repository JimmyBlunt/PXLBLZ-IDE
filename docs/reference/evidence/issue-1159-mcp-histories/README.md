# #1159 fixed MCP histories

The real Worker, OAuth grant, account relay, browser session, editor admission, Show store, provider writer, and native artifact path execute these fixed histories. Each new case opens a fresh bound editor and closes it in `finally`. The selected seam is `tools/call` plus the saved `.pxlshow` and exported `.epe` consumers.

| History | Command sequence and observed oracle |
| --- | --- |
| A → replacement → B | `set_show_end(30000)`, solid-red `replace_show`, `rename_show`, `commit_edit`: Show End 1000, B name retained, one history preimage/write, exact saved/reopened record, red 1 at 250 ms. |
| Introduced Clip, Undo/Redo | Solid replacement commit, `read_show`, `update_clips` returned Clip with whole-Clip opacity 0.5, commit, Undo, Redo: complete snapshots and durable records at each stage, red 0.5 at 250 ms. |
| Shared then independent | Bounded gain replacement, shared `duplicate_clip` at 500, shared control 0.5, then `make_clip_pattern_independent` and copied control 0.75 inside one private operation: four adoptions/writes total, matching then distinct instance IDs, original runtime unchanged, exact saved/reopened record, red 0.5/0.75 at 250/750 ms. |
| Group/Layout | Supported held Group fixture replacement, `move_group_occurrence` from 2000 to 2500: exact definitions, bindings, instances, Layout spans and reopened record; its authored restart occurs at 4500, exported Fast elapsed advances 500 ms from 4750 to 5250 across the 5000 ms Layout switch, before the hold at 5500. |
| Invalid, corrected, commit/cancel | Valid solid replacement, invalid version 1 refusal, identical valid retry, corrected half-opacity replacement: commit saves only corrected content with one history/write and red 0.5; cancel leaves complete live/durable/history state unchanged. |
| Stale manual edit | Private solid replacement, admitted manual Show End 25000, stale commit: `revision-conflict`; exact manual live/saved/history state remains, with no second write. |
| Keyed retries | Same-key identical replacement replay returns its cached result; changed payload conflicts; same-key commit replay returns its cached initial receipt, final outcome saves once and history has one preimage. |
| Save recovery | Failed solid replacement save rolls back exact original record/history with failure notice. A held first replacement write fails after a newer manual update queues: receipt `superseded`, newer complete record remains live and durable, two provider attempts, no failure notice. |

The red, opacity, and gain values are independent playback values. Group/Layout continuity is a structural and exported-clock oracle; the fixture supplies no independently specified RGB value. The serialized `.pxlshow` is parsed directly for exact record equality. The native artifact helper also checks its exported `.epe`; its separate imported pilot intentionally receives a new id, name, timestamp, and import metadata, so that pilot is not the exact-record oracle.

Focused proof after these corrections: `wrsp-log npm run build` (`EXIT:0`); `wrsp-log npx vitest run src/worker/agent/agentV2Command.runtime.test.ts src/engine/agentPrivateExecutor.test.ts src/worker/agent/agentMcpRouting.test.ts` (84 passing tests, 3 files, 7.32 s, `EXIT:0`). The serialized file importer is the exact-record oracle; the native helper's imported pilot deliberately receives a new identity. The Group replay samples advance chronologically across the Layout switch.

The earlier fault/control run changed only the stale-admission expectation to `applied` and the keyed-adoption write expectation to two. `wrsp-log npx vitest run src/worker/agent/agentV2Command.runtime.test.ts -t 'refuses a stale replacement|replays keyed replacement'` failed both selected tests (`EXIT:1`): actual stale status `refused`, actual write count one. Both expectations were restored. Those probes were not rerun for this follow-up.

Browser UI, hardware, real timer expiry, cross-window behavior, and generated histories are excluded by the fixed-history scope.
