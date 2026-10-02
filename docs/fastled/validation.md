# FastLED validation plan

This plan turns the acceptance criteria in `acceptance.md` into reproducible
checks. Evidence belongs in `docs/fastled/evidence` or
`test/fastled/evidence`, and each result must record the tested commit and
dependency revisions.

A check is not considered passed because a similar earlier run succeeded.
Final acceptance is against the exact candidate commit after synchronization
with current `main`.

## 1. Verify repository state and pins

Record:

```text
PXLBLZ feature commit
FastLED commit adedfc40e73fb80f8e930318781036d8fe1dbd9f
FastLED CLI commit bb1d619c1d64194198f9c68ac852fc79e6a01d9e
CLI patch SHA-256
frame-adapter SHA-256
```

Confirm the FastLED checkout used by the compiler service is clean.

## 2. Rebuild the patched official CLI

From a fresh FastLED/cli checkout:

```powershell
git checkout bb1d619c1d64194198f9c68ac852fc79e6a01d9e
git apply --check <PXLBLZ>\vendor\fastled-cli\patches\0001-preserve-sketch-configuration.patch
git apply <PXLBLZ>\vendor\fastled-cli\patches\0001-preserve-sketch-configuration.patch
cargo test -p fastled-cli --no-default-features sketch_preprocessor
cargo build -p fastled-cli --no-default-features --release
```

Record exit status, elapsed time, compiler version and release-binary SHA-256.

Start the production service with the built binary:

```powershell
$env:FASTLED_CLI = '<path-to-release-fastled>'
$env:FASTLED_PATH = '<clean-FastLED-3.10.4>'
node scripts/fastled/server.mjs
```

## 3. Configuration regression fixtures

Compile these unchanged through the running production service:

- `scripts/fastled/fixtures/hsv-spectrum.ino`
- `scripts/fastled/fixtures/fastled-prototype-order.ino`

Required results:

```json
{
  "hsv-spectrum": [155, 95, 0],
  "fastled-prototype-order": [17, 34, 51]
}
```

The proof must read the RGB result from the generated FastLED WASM artifact,
not from a duplicated JavaScript color implementation.

## 4. Six-example production compile

Run the production-service compiler proof against the clean pinned FastLED
checkout:

```powershell
node scripts/fastled/compile-examples.mjs
```

All six original sources must be verified against upstream and compile without
source edits. Record every input and generated artifact hash and any narrowly
defined upstream retry that occurred.

## 5. Deterministic native/WASM corpus

Prepare and execute the deterministic parity harness described in
`docs/fastled/parity.md`.

At minimum:

```powershell
node test/fastled/prepare.mjs <FastLED-3.10.4>
node test/fastled/build-native.mjs
node test/fastled/build-wasm.mjs
node test/fastled/run-native.mjs
node test/fastled/run-corpus.mjs <module-manifest.json>
node --test test/fastled/compare.test.mjs test/fastled/source-hash.test.mjs
```

The final report must be complete and byte-exact for all six examples.

## 6. Matrix acceptance candidates

Use the unmodified official sources at the pinned FastLED commit:

- `examples/Animartrix/Animartrix.ino`
- `examples/WasmScreenCoords/WasmScreenCoords.ino`

For each candidate:

1. verify source hash/provenance;
2. cold-compile through `scripts/fastled/server.mjs`;
3. compile again to exercise the warm cache;
4. run through `src/engine/fastled/runtime.worker.ts`;
5. capture LED/strip counts, RGB data, layout data and lifecycle events;
6. reset the runtime and verify equivalent initial behavior;
7. capture generated asset sizes and hashes.

Animartrix must exercise its 64 x 64 matrix. WasmScreenCoords must exercise both
256-pixel strips and both opposing screen maps.

## 7. Performance run

Before executing the measured run, record the machine, OS, CPU, browser,
Node.js, FastLED CLI and Emscripten versions.

For each matrix candidate record:

- cold build milliseconds;
- warm build milliseconds;
- WASM bytes;
- module-load/initialization milliseconds;
- frames and elapsed wall time for the chosen steady-state interval;
- main-thread responsiveness probe results.

Store raw numeric results as JSON. Narrative documentation may summarize those
numbers but must not replace the machine-readable file.

## 8. Catalog and UI validation

Run focused component tests for the FastLED catalog/workspace, including:

- FastLED area/folder navigation;
- opening each catalog entry;
- preservation of read-only upstream source;
- copy-to-editable-sketch behavior;
- multi-file example behavior;
- preview-cache hit and invalid-cache fallback.

Then perform a real Chromium acceptance run with the production compiler
service. Confirm:

- successful compile/run;
- diagnostics for invalid C++;
- pause/run/reset;
- navigation/discard guards;
- desktop and narrow layout;
- isolation on FastLED;
- return to non-isolated PXLBLZ.

## 9. Runtime edge cases

Exercise and record:

- rapid consecutive show events;
- multiple strips;
- cancellation during compilation;
- stale compile completion;
- long/blocking user code;
- reset while running;
- runtime disposal;
- maximum supported pixel count;
- compiler service unavailable;
- missing/corrupt cached asset.

Existing focused scripts and tests should be reused where they already establish
the exact contract. Add a new test only for a missing acceptance condition.

## 10. Full repository regression

Run the repository's current equivalents of:

```powershell
npm run lint
npm run test:full
npm run build
```

Also run all focused FastLED suites and the browser/native-WASM checks above.
Record exact commands and results because the repository scripts may evolve.

## 11. Independent review

Review the candidate diff for:

- unsupported universal-compatibility wording;
- copied FastLED source changes;
- missing MIT provenance/license information;
- local absolute paths;
- ArtNet coupling;
- cache keys that omit source/compiler/ABI/version identity;
- product code changes not covered by tests.

Findings include file and line where practical. Fix confirmed defects in
separate commits and rerun impacted checks.

## 12. Synchronize with current main

Compare `feature/fastled-runtime` with the current `main`, integrate current
main into the feature branch without touching unrelated ArtNet work, resolve
conflicts, and rerun sections 1 through 11 against the new feature tip.

The evidence set must identify that exact final commit. Only that tested tip is
eligible for merge.

## Result classification

Use these states in the final result:

- **PASS**: the stated criterion was executed against the candidate and met.
- **FAIL**: it was executed and did not meet the criterion.
- **BLOCKED**: required execution could not be performed; state the concrete
  dependency or environment blocker.
- **NOT RUN**: intentionally outside the current run.

Do not convert BLOCKED or NOT RUN into PASS based on older or adjacent evidence.
