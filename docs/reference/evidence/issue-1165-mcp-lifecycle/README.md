# Issue #1165: MCP replacement lifecycle

The authenticated Show editor passed all five #1165 browser cases with two workers. The cases cover a waiting duration draft released by Escape, cancellation followed by a fresh replacement, textbox Undo versus timeline Undo, timeline Undo superseding a private candidate without losing Redo, and reload retiring a private candidate and its old binding. Each case compares complete durable Show records, checks visible Clip state, and decodes real 250 ms Stage PNGs at both declared grid centres. [Test design](test-design.json) records the invariants and limits.

## Reload repair

The coordinator's first reload probe failed the exact old-binding `no_live_editor` oracle and observed `connection_retired` during cleanup. That response cannot establish normal reload retirement. `pagehide` closes editor admission ([editorAdmission.ts](../../../../src/agent/editorAdmission.ts#L138)); close had sent `leave` through an ordinary fetch that could be cancelled during document unload ([browserSession.ts](../../../../src/agent/browserSession.ts#L151)). Accepted `leave` retires the registration and binding, while an unreachable tab expires later ([agent-rendezvous.md](../../contracts/agent-rendezvous.md)). The narrow repair gives only close cleanup `leave` posts fetch `keepalive`. This improves ordinary page teardown delivery when transport is available; it does not guarantee immediate retirement after every hard close.

The new request-option assertions failed before the source change: two close-order tests expected `keepalive: true` on `leave` and observed `undefined` (`/tmp/wrsp-log/20260927T004846-826-npx-vitest.log`, `EXIT:1`). After the repair, the complete `browserSession.test.ts` file passed 17/17 (`/tmp/wrsp-log/20260927T005024-8817-npx-vitest.log`, `EXIT:0`). The isolated reload browser case passed 1/1 in 11.6 s (`/tmp/wrsp-log/20260927T005055-11130-npx-tsx.log`, `EXIT:0`). The full #1165 run passed 5/5 with `--workers=2` in 26.8 s (`/tmp/wrsp-log/20260927T005148-15819-npx-tsx.log`, `EXIT:0`). A sandbox attempt of that five-case command could not launch Chromium because macOS denied its Mach port bootstrap (`/tmp/wrsp-log/20260927T005118-13216-npx-tsx.log`, `EXIT:1`); the passing run used the host.

## Retained browser packages

The ignored `playwright-report/agent-mcp/` packages from the passing two-worker run are:

| Case | Manifest and PNG directory | Stage captures |
| --- | --- | --- |
| Escape release | `3a4446e6539dde9a-worker-0-retry-0-repeat-0/escape-release.json` | red before, green after Escape, red after Undo |
| Cancel and fresh edit | `69440e3766ab3bbc-worker-1-retry-0-repeat-0/cancel-wait.json` | red after cancel, green after fresh replacement |
| Textbox history | `fbcc51e4ab5a0711-worker-1-retry-0-repeat-0/textbox-history.json` | green after textbox Undo, red after timeline Undo |
| Private candidate and Redo | `da88bbb872a33773-worker-0-retry-0-repeat-0/undo-private.json` | red after refusal, green after Redo |
| Reload retirement | `90c9cd57cda04c76-worker-1-retry-0-repeat-0/reload-retirement.json` | red after reload |

All ten PNGs are 416×416. Their manifests record literal opaque red `[255,0,0,255]` or green `[0,255,0,255]` at both grid centres, verified byte counts and SHA-256, zero browser errors, retry 0, and one synthetic account per case. The reload manifest records `no_live_editor` for both old-binding `read_show` and `commit_edit`, complete original-red durable record preservation, and no green Clip. The reload PNG was opened and visually checked. The earlier single-case reload package remains at `90c9cd57cda04c76-worker-0-retry-0-repeat-0/`.

These manifests report `sourceCommit: 4c9065ced29290bf079874adde9bee63352ab437` and `testFilesUncommitted: true`: that was the actual HEAD during capture, not attribution of the new test code to that commit. The coordinator owns committed-tip suites, review, and landing.

## Full-suite OAuth exhaustion and shard corrective

The five focused #1165 browser cases passed, but the committed-tip `e2e-shows` runner suite still failed. The retained `.wrsp/runner/aafe91718868/e2e-shows/log` at `aafe9171` records 114 passes and two final MCP setup failures: timeline Undo received HTTP 429 at `/oauth/token`, and reload received HTTP 429 at `/oauth/register`. Its `result.json` records exit code 1. Those results do not establish full-suite completion at the current base `6c77ff2b`.

The OAuth authority is named by origin and enforces 120 non-revocation requests per minute, including MCP traffic, plus 10 client registrations per minute. Separate synthetic accounts in one run share those counters. The corrective removes the MCP spec from the five-spec Show command and runs its nine cases through three required Playwright shards. Each authenticated Playwright invocation provisions a fresh port and OAuth origin with isolated D1 and Durable Objects, so each shard uses a separate real authority. Production admission stays unchanged. These are bounded shards for this campaign, not a general scale claim or a new harness.

The three local commands are `npm run test:e2e:shows:mcp-1`, `npm run test:e2e:shows:mcp-2`, and `npm run test:e2e:shows:mcp-3`. All three must pass; the coordinator still owns seven-suite exact-tip runner evidence before landing.

The local corrective runs used two workers per shard, no retry, and real authenticated Playwright. All nine case IDs in the spec appeared exactly once in the passing logs; no shard log contains an HTTP 429.

| Shard | Passing cases by spec line | Playwright time | Log |
| --- | --- | --- | --- |
| 1/3 | 277, 343, 393 (3/3) | 30.0 s | `/tmp/wrsp-log/20260927T011958-54578-npm-run.log` (`EXIT:0`) |
| 2/3 | 480, 560, 613 (3/3) | 29.0 s | `/tmp/wrsp-log/20260927T012042-57466-npm-run.log` (`EXIT:0`) |
| 3/3 | 664, 707, 761 (3/3) | 24.9 s | `/tmp/wrsp-log/20260927T012126-60536-npm-run.log` (`EXIT:0`) |

The `check:e2e-coverage` and `check:e2e-locators` commands passed; `npm run build` passed. The focused runs do not replace the seven exact-tip runner suite results.
