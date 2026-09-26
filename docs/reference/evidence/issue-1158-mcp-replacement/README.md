# Issue #1158: complete Show replacement through MCP

The fixed tests call `read_show`, `begin_edit`, `replace_show`, `commit_edit`, and `get_outcome` through the local Worker MCP endpoint. Each row opens a fresh editor binding and store fixture. Sources are bounded solid-color personal Patterns; expected linear RGB values are handwritten. The first lit sample is at 1 ms because FastReplay has not rendered at `advanceTo(0)`. Frame channels are compared after the four-decimal rounding used by FastReplay snapshots.

| Replacement | Named Fast RGB samples (ms) | Oracle | Case wall time | Result |
| --- | --- | --- | ---: | --- |
| Solid red throughout | 1, 250, 500, 999: red | independent value | 226 ms | pass |
| Adjacent red then green | 1, 250, 499: red; 500, 501, 999: green | independent value, boundary | 250 ms | pass |
| Red below half-opacity blue | 1, 250, 500, 999: (0.5, 0, 0.5) | independent value, stacking | 215 ms | pass |
| Two Zones, left red/right green | 1, 250, 500, 999: red and green at explicit 2D map points | independent value, logical routing | 214 ms | pass |
| Red linear opacity, 0 to 1 | 1: 0.001; 250: 0.25; 500: 0.5; 750: 0.75; 999: 0.999 red | independent value, animation | 232 ms | pass |
| Empty composition with valid Layout | No render; preparation reports `empty` | structural, round-trip | 171 ms | pass |

Every row also checks the complete submitted record is preserved, no live record/history/provider write escapes before commit, exactly one write and `past === [before]` follow accepted commit, and the connected id/name survive. The full saved record equals the input after only the connected name and store-owned `updatedAt` are normalized. The actual `.pxlshow` bytes reopen to the saved Show in every row. For nonempty rows, `nativeShowV2Artifacts` delivers `.epe` source and FastReplay executes that exported source at the listed times. The empty Show saves and reopens without requesting an `.epe`.

## Runs and fault sensitivity

- Baseline at `2a67f1ff`: 68 tests in 3 files passed in 4.55 s; `/tmp/wrsp-log/20260926T215858-34084-npx-vitest.log` (coordinator run before edits).
- Clean six-case control: 12 tests in the runtime file passed; `/tmp/wrsp-log/20260926T220850-65465-npx-vitest.log` (`--reporter=verbose`, 5.37 s total). Case wall times above are the test's measured operation time in that run.
- Final focused scope before commit: 74 tests in 3 files passed; `/tmp/wrsp-log/20260926T220952-68003-npx-vitest.log`, `EXIT:0` (3.46 s total).
- Temporary output fault: changed solid red's 250 ms expected RGB to green. The focused test failed at the named `solid red throughout RGB at 250 ms` assertion: expected `[0,1,0]`, received `[1,0,0]`; `/tmp/wrsp-log/20260926T220717-61789-npx-vitest.log`, `EXIT:1`.
- Temporary adoption fault: changed expected accepted history length from one to two. The focused test failed: expected length 2, got 1; `/tmp/wrsp-log/20260926T220803-63908-npx-vitest.log`, `EXIT:1`.
- Both temporary faults were removed and the source was rebuilt before the clean control.

Commands: `wrsp-log npm run build`; `wrsp-log npx vitest run src/worker/agent/agentV2Command.runtime.test.ts --reporter=verbose`; `wrsp-log npx vitest run src/worker/agent/agentV2Command.runtime.test.ts src/engine/agentPrivateExecutor.test.ts src/worker/agent/agentMcpRouting.test.ts`. Each fault used `wrsp-log npx vitest run src/worker/agent/agentV2Command.runtime.test.ts -t 'solid red throughout'` after a rebuild.

This qualifies the local MCP/Miniflare path, saved/reopened artifacts, and FastReplay's Fast mode for these fixed records. It makes no browser, hardware, Precise-mode, LLM, broader compiler mutation, or general Show-generation claim. The two fault probes demonstrate assertion sensitivity only at their named output and history checks.
