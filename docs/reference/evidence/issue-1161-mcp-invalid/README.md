# Issue #1161: MCP invalid replacement evidence

The real MCP path in `agentV2Command.runtime.test.ts` runs OAuth, Worker routing in Miniflare, the bound editor session, private executor, editor admission, Show store, and recording personal-content provider. The proof observes structured MCP responses, complete live and saved records, history, provider writes, reopened `.pxlshow` bytes, and native `.epe` replay. It does not exercise Chromium or hardware.

## Bounded cases

Twelve fresh invalid replacements cover a different Show id; duplicate Layer id; absent Clip instance, Layer, and Zone; absent Layout; zero and overlong Clip duration; adjacent Clip overlap; short Layout coverage; and absent Group definition and Layout occurrence. Each sequence accepts solid A privately, refuses the invalid input with its reason and intended issue code/path, proves both caller inputs and all live state unchanged with zero writes, retries A as unchanged, corrects A to 0.5 opacity, and commits one exact saved/history record. Each saved record reopens from raw `.pxlshow`; one also replays native `.epe` at 250 ms as `[0.5, 0, 0]`. Zero duration reaches the documented structural `schema` issue at `/composition/clips/0/durationMs` before domain timing validation.

Two legal boundaries accept `timeOffsetMs: -1` and a dormant Marker at 1001 ms after a 1000 ms Show End. Both commit, validate, reopen, and replay red at 999 ms. The history sequence replaces held Group/Layout A, moves its Group occurrence from 2000 to 2500 ms, supersedes A with adjacent-color B, refuses removal of an A-only top-level Clip, dims B's green Clip, and commits once. It asserts no Group remnants, exact B content, one write/history entry, raw `.pxlshow` reopen, red at 499 ms and half green at 500 and 999 ms. Undo and Redo restore complete snapshots with three total provider writes.

## Focused proof

| Command | Result | Log |
| --- | --- | --- |
| `wrsp-log npm run build` after restoring the oracle | `EXIT:0`, 14.9 s wall | `/tmp/wrsp-log/20260926T233759-3900-npm-run.log` |
| `wrsp-log npx tsc -b --pretty false` | `EXIT:0`, 22.6 s wall | `/tmp/wrsp-log/20260926T233926-8354-npx-tsc.log` |
| `wrsp-log npx vitest run src/worker/agent/agentV2Command.runtime.test.ts` | `EXIT:0`, 37/37, 6.90 s Vitest | `/tmp/wrsp-log/20260926T233707-1655-npx-vitest.log` |
| `wrsp-log npx vitest run src/worker/agent/agentV2Command.runtime.test.ts src/engine/agentPrivateExecutor.test.ts src/worker/agent/agentMcpRouting.test.ts` | `EXIT:0`, 99/99, 12.50 s Vitest | `/tmp/wrsp-log/20260926T233817-4966-npx-vitest.log` |

Oracle fault control temporarily changed the representative 250 ms expected RGB from `[0.5, 0, 0]` to `[0.4, 0, 0]`. The selected test failed with actual `[0.5, 0, 0]` (`EXIT:1`, `/tmp/wrsp-log/20260926T233748-3508-npx-vitest.log`). The expectation was restored, `dist/` rebuilt, and the 99-test focused run passed. This qualifies the assertion only; it is not production mutation testing.

The table intentionally checks each governing diagnostic rather than every incidental issue. The MCP runtime is not a browser UI or physical device oracle. The coordinator owns candidate review and committed-tip runner gates. [Test design](test-design.json) records invariants, partitions, sequences, oracles, and residual gaps.
