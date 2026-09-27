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
