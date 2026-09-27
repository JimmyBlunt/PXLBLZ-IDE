# V2 Show deterministic qualification ledger

This campaign qualifies savable personal Shows through command, MCP and ordinary browser surfaces. It does not qualify resetting Lesson documents as personal-content persistence. The primary acceptance flow creates a new personal Show through the ordinary UI, builds content through MCP, saves and reloads it; both incremental creation and whole-composition replacement are required (#1166). Earlier fixture-based tests remain supporting evidence.

## Coverage inventory

| Partition | Supporting evidence | Campaign evidence |
| --- | --- | --- |
| New personal Show created through UI and authored incrementally | None credited from seeded Show fixtures | #1166 create/save/reload/render/export |
| New personal Show receives entire uploaded composition | Replacement of personal fixtures #1158/#1160 | #1166 UI-created document + replace_show |
| Whole-Show structural refusal and correction | #1161 twelve typed invalid partitions, full state/history/write preservation, correction and reopened artifact | Complete |
| Legal dormant Marker and negative time offset | #1161 accepts and preserves both | Complete; these are legal values, not delivery warnings |
| Payload and HTTP transport boundaries | Stub-owner UTF-8 boundary and Worker transport unit coverage | #1164 passed: ASCII/multibyte 60000/60001-byte Shows and 67584/67585-byte HTTP requests |
| Missing Pattern authoring refusal | Existing real-MCP commit rejection | #1164 passed: control/Library metadata refusals, full preservation and corrected save |
| Authorable but delivery-incompatible content | Direct store portable admission tests | #1164 passed: real-MCP saved/reopened Show plus render3D-only portable artifact refusal |
| Basic Layers/Clips/Property track/Show End command delivery | Existing real-MCP creation and save cases | New-document browser path #1166 |
| Transitions, Effects and Property keyframe command sequences | Pure command-owner tests | #1167 saved/reopened crossfade and brightness plus opacity/keyframe sequences |
| Layout interval and Zone metadata command sequences | Pure owner tests; supplied split-Zone replacement has replay oracle | #1167 saved/reopened Zone, Layout interval and Marker sequence with changed routing |
| Shared/independent Pattern instances, split/duplicate/final removal | Pure command-owner tests; whole-empty replacement saved/reopened | #1167 split/shared/independent/empty/Undo sequence with exact records and literal frames |
| Group replacement and supersession | #1161 Group/Layout A→edited A→B, stale A-id refusal, exact B save/Undo/Redo | Owner coverage below plus #1161 real-MCP supersession; no additional Group command transport duplication |
| Retry/cancel/stale/save-failure histories | #1159 ten cases across eight histories with exact state/write/artifact oracles | Credit existing evidence; browser-specific rows below |
| Dirty field Enter while MCP waits | #1160 manual commit wins, stale MCP refuses, durable/manual preview | Complete |
| Dirty field Escape and MCP cancellation while waiting | Diagnostic bridge only | #1165 production MCP browser |
| Textbox shortcut ownership and Undo superseding private candidate | Partial component/diagnostic evidence | #1165 production MCP browser |
| Selection/details, Delete, keyboard Undo/Redo | #1162 full durable records and red/green captures | Complete |
| Navigation and reload retire private candidates | #1162 A→B→A with no_live_editor and unchanged saved Shows | #1165 direct reload |
| Stale async preview completion and wait deadline | Component/store tests at actual owner with controlled timing | Exact owner cases credited below; browser evidence separately checks successful preview publication |

## Evidence rules

A successful response alone is insufficient. Pure command tests inspect authored records, typed refusals and owner parity. The real-MCP and store admission tests additionally inspect complete durable records, history and provider writes; successful artifact cases reopen bytes through native importers. Browser tests also inspect ordinary editor state, reload survival, literal fixed-time pixel values and errors. Expected colors and authored changes are independently specified, not obtained by rerunning the implementation under test.

The browser suite provisions a synthetic account per test and unique Show identities; the runtime suite uses isolated Worker/store/provider state. Accounts alone do not isolate OAuth: full-suite runs exposed the origin-wide 120-request/minute and 10-registration/minute budgets. The corrective partitions browser MCP cases across three required isolated-runtime shards, each using a real authority and unchanged production limits; the implementation issue records final shard results. This qualifies the bounded cases, not unlimited client throughput. Test execution and result judging make no model calls. Research, implementation and review agents are development costs, not runtime dependencies.

## Limits

This is bounded qualification, not an exhaustive arbitrary-input claim. Pure owner coverage is credited explicitly rather than repeated once per catalogue command over OAuth. Physical Pixelblaze firmware, aesthetics, hostile infinite-loop Pattern execution, real third-party MCP clients, live-model utterance quality, production monitoring and owner release acceptance remain outside this campaign. The broader #958 release checklist remains authoritative for those release concerns. Direct-store compiler fault injection does not prove a particular real-source compiler failure over MCP.

This document is a coverage map, not a landing or release receipt. Exact committed-tip suite results, review approval, retained proof and local landing identities are recorded in [#1163](https://github.com/jon-whiteroomsoftware/PXLBLZ-IDE/issues/1163) and its linked implementation issues. Passing focused checks never substitute for the required runner suites described in [verification](../../agents/verification.md).

## Credited owner-level evidence

- Catalogue: `src/engine/showCommandsV2/commands.test.ts` case “exposes one descriptor per catalogue row with an owner-backed apply” asserts49; `census.test.ts` lists unique names and nonempty families/touch paths. Nine families is the inventory grouping, not an assertion that this census test checks nine distinct family values.
- Groups: `src/engine/showGroupEditsV2.test.ts` holds exact placement/runtime ownership, linked duplication, uniqueness and ungrouping tests; the move/duplicate/ungroup cases compare affected fields and reopened/materialized records. The real-MCP Group supersession history is #1161.
- Input deadline: `src/store/showV2InputWait.test.ts:111` checks 4999/5000/5001ms under a controlled monotonic clock. Only4999 applies; boundary/late results refuse, preserve snapshot and make no provider write. Duplicating these as wall-clock browser sleeps would add runtime and timing noise without improving that exact-boundary oracle.
- Preview publication: `src/components/ShowStagePreview.test.tsx:936` delays reconstruction then changes Show, Pattern, Library, map, profile, output, preview override, navigation or unmount. Renderer paint calls and literal first-pixel values prove stale completion adds no paint/error. Browser captures in this campaign separately prove successful publication.
- Admission defenses: `src/store/showV2CandidateAdmission.test.ts:136` covers malformed raw composition and missing Layer at direct final admission, with no write/history and original current record. `src/dev/agentEditorAdmission.test.ts:85` carries raw-schema /name diagnostic through the actual editor owner. Through replace_show, malformed records are refused earlier; bypassing that gate merely to reproduce the final defense would misrepresent a real MCP client.
- Metadata invalidation: `src/dev/agentEditorAdmission.test.ts:142,373` changes/restores actual Pattern/Library/Map store state and asserts snapshot preservation/no write. This is owner/store evidence, not Chromium.
- Compiler defense: `src/store/showV2CandidateAdmission.test.ts:196` deliberately mocks captured Stage preparation to refuse, then checks delivery-invalid/no write. This is fault-injected branch evidence; no real-source compiler-failure claim. Real authoring/delivery incompatibility is separately qualified in #1164.

## Documentation impact

No domain term or authored Show semantics changed, so CONTEXT.md requires no change. The reload cleanup repair updates the agent-rendezvous contract and its evidence in the same slice. The test isolation correction updates docs/agents/verification.md and required runner configuration; it introduces no production rate-limit exception. Existing lesson behavior is separate from the personal-Show acceptance flow.

## Reproduction and measured cost

The broadest cheap loop is `npx vitest run src/worker/agent/agentV2Command.runtime.test.ts`: 48 cases passed in 12.55 seconds in the #1167 focused run. Its five richer sequences took 2.94 seconds when selected alone. The #1166 browser creation pair passed with two workers in about 17 seconds, including save, reload, rendering and both exported downloads. The #1165 five-case browser pass took 26.8 seconds. These are observed development timings, not performance thresholds.

The required browser partition is `npm run test:e2e:shows:mcp-1`, `npm run test:e2e:shows:mcp-2`, and `npm run test:e2e:shows:mcp-3`; all three must pass. Each owns an isolated real Worker runtime. Cases run with two workers inside each shard. The existing runner browser group serializes shard jobs; isolated shards do not imply simultaneous remote execution. Existing runtime reservation and Playwright sharding provide isolation; the campaign adds no general testing framework. The ordinary Show browser suite remains `npm run test:e2e:shows`.

Evidence and precise oracles:

- [New personal Show creation](issue-1166-mcp-create/README.md): ordinary UI UUID creation, incremental MCP construction or whole-composition replacement, complete durable records, post-reload real canvas images, downloaded `.pxlshow` and `.epe` reopened through product importers.
- [Rich MCP sequences](issue-1167-mcp-sequences/README.md): Transition correction, Effects and keys, Layout routing, shared/independent instances, final deletion and missing-map recovery.
- [Editor lifecycle](issue-1165-mcp-lifecycle/README.md): draft/keyboard/history/reload cases and the keepalive cleanup repair.
- [Invalid whole-Show partitions](issue-1161-mcp-invalid/README.md) and [selection/navigation](issue-1162-mcp-interactions/README.md).

The wrong-image and wrong-midpoint controls deliberately fail against actual captured or replayed output, establishing sensitivity to a wrong visual result. The reload fix has red/green request-lifetime tests for both registration-close orderings. No new transformation engine was introduced, so no additional mutation campaign is claimed.

The [combined review design](show-v2-qualification-test-design.json) records the invariants and oracles of the final lifecycle, creation and sequence changes.
