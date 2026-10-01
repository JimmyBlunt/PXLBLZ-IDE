# UI test environment: adapted worker initialization allowance

The standard focused Vitest command failed before running any assertions on
this Windows host: both forks and threads reached the fixed worker-startup
watchdog with zero tests imported or executed. A separate plain Node
`import('jsdom')` measured **163,694 ms**, exceeding the 60-second inner and
90-second outer initialization watchdogs. Node was v24.13.0; Vitest was 4.1.7.

The installed primary source `vitest/dist/chunks/cli-api.C6CiCDM3.js` exposes no
environment/configuration override for these two constants. Its SHA-256 was:

```text
6c67544c5b2084a308acc75e7ace514953e16b6d86a1d8ad13e84849a91f1b06
```

With explicit coordinating-agent authorization, the temporary per-process
loader in `test/fastled/worker-startup-allowance.mjs` changes exactly:

- `const START_TIMEOUT = 6e4;` to `const START_TIMEOUT = 300000;`
- `const WORKER_START_TIMEOUT = 9e4;` to `const WORKER_START_TIMEOUT = 300000;`

It verifies that source hash and a single occurrence of each constant before
adapting the module in memory. It edits no dependency files. Test cases,
assertions, assertion/test timeouts and teardown timeouts remain unchanged.
This helper is explicit and is not installed into the ordinary test commands.

```powershell
node --import ./test/fastled/worker-startup-allowance.mjs node_modules/vitest/vitest.mjs run src/components/FastLedWorkspace.test.tsx --pool=threads --maxWorkers=1
```

Result: **9 tests passed**, exit 0, one test file. Vitest reported 85.00 seconds
total: 72.85 seconds environment setup, 5.00 seconds imports, 2.93 seconds
transform, 2.33 seconds setup, and 1.53 seconds test execution. The larger
initialization allowance was needed; test assertions completed normally.
This is an adapted-initialization run, not the original command passing.

The run used base commit `6832588283bdce6bc3dde795ce4172b791882e15` plus the
multi-file workspace changes. Tested file SHA-256 values, before the subsequent
sketch-layout feature:

| File | SHA-256 |
| --- | --- |
| `src/components/FastLedWorkspace.tsx` | `b5f6942695954aace22c2c4f25ddb7095d7c55705d5f4a0def6ca7e484203e11` |
| `src/components/FastLedWorkspace.test.tsx` | `37430ac4e5b6231d9f39831184bce7775a9e120012b8427b1e9a3243760452c7` |
| `src/engine/fastled/project.ts` | `5c3abd5ed7c34f8448ffa3bc28490c4896eebb0b56d4616a57348c340b4468ec` |

After adding the upstream sketch-layout selector and its regression case, a
fresh run of the same explicit adapted-startup command passed **10 tests**,
exit 0. Total duration was 102.61 seconds: 73.40 seconds environment setup,
13.18 seconds imports, 12.11 seconds setup, 3.98 seconds transform, and 2.76
seconds test execution. Source remained unchanged during each run. Updated
tested file hashes:

| File | SHA-256 |
| --- | --- |
| `src/components/FastLedWorkspace.tsx` | `7918d026eae4d63b150af05cb0e69d555860cb5a40dcf13e21d34c6f39f0c3b3` |
| `src/components/FastLedWorkspace.test.tsx` | `ae88df2ced0a21d6a228655421813983865ad62519f959bc80249940af2f91fc` |

The unmodified Node-environment project-parser suite passed **14 tests**:

```powershell
node node_modules/vitest/vitest.mjs run src/engine/fastled/project.test.ts --pool=threads --maxWorkers=1
```

Focused ESLint on the workspace, project parser, their tests, and the explicit
startup helper also exited 0.
