# FastLED acceptance criteria

Status: open acceptance gate. This document defines what must be true before
`feature/fastled-runtime` can be merged. It does not claim universal Arduino,
MCU, peripheral, timing, or physical LED compatibility.

FastLED in PXLBLZ-IDE is a computer-rendering path only. The accepted contract is
the pinned FastLED PC/WASM execution path plus the explicitly tested IDE runtime,
geometry, lifecycle and compiler-service behavior.

## Pinned dependencies

- FastLED: 3.10.4, commit
  `adedfc40e73fb80f8e930318781036d8fe1dbd9f`.
- FastLED CLI upstream: commit
  `bb1d619c1d64194198f9c68ac852fc79e6a01d9e`.
- The CLI integration patch is
  `vendor/fastled-cli/patches/0001-preserve-sketch-configuration.patch`.
- The production compiler service is `scripts/fastled/server.mjs`.
- The production browser runtime is `src/engine/fastled/runtime.worker.ts`.

Any dependency revision change reopens the relevant acceptance gates.

## A. Patched official FastLED CLI

All of the following must be demonstrated from a fresh checkout:

- The pinned FastLED CLI commit accepts the repository patch with
  `git apply --check`, and the patch applies without manual edits.
- `cargo test -p fastled-cli --no-default-features sketch_preprocessor`
  passes after the patch is applied.
- A headless release binary builds with
  `cargo build -p fastled-cli --no-default-features --release`.
- The production compiler service runs with that binary selected through
  `FASTLED_CLI`.
- `scripts/fastled/fixtures/hsv-spectrum.ino` compiles unchanged and produces
  exactly `[155,95,0]`.
- `scripts/fastled/fixtures/fastled-prototype-order.ino` compiles unchanged and
  produces exactly `[17,34,51]`.
- The six standard upstream examples compile unchanged through the production
  compiler service.
- Evidence records CLI version, pinned upstream commit, patch hash, commands,
  runtimes and generated artifact hashes.

Do not repair a failing configuration test by modifying the fixture source.

## B. Native/WASM execution parity

The deterministic reference harness must compare the same original FastLED
source under controlled time and random inputs.

Required standard corpus:

- Blink
- ColorPalette
- Fire2012
- DemoReel100
- Noise
- NoisePlusPalette

For the defined test inputs, native and WASM results must match exactly for:

- show-record count and ordering;
- strip ordering;
- virtual timestamps;
- brightness metadata;
- every logical RGB byte.

The existing six-example parity evidence is documented in
`docs/fastled/parity.md` and
`test/fastled/evidence/native-wasm-parity.json`. A future run must not weaken
those comparison rules.

## C. Matrix and geometry acceptance

The official FastLED 3.10.4 examples below are additional product-path gates:

- `examples/Animartrix`, with its authored 64 x 64 / 4096-pixel matrix.
- `examples/WasmScreenCoords`, including both 256-pixel strips and their
  authored screen-coordinate maps.

The committed example source must remain byte-for-byte upstream source.
PXLBLZ-specific metadata belongs outside the C++ files.

For both examples, acceptance requires:

- compilation through the production compiler service;
- execution through the production browser worker;
- the expected LED/strip count;
- geometry delivery that matches the authored FastLED screen map where supplied;
- stable reset behavior;
- no stale frames from a previous runtime generation.

For Animartrix, record representative deterministic native/WASM RGB evidence or
document any upstream feature that prevents an equivalent native reference.
For WasmScreenCoords, explicitly verify both strip frame bytes and both opposing
coordinate maps.

## D. Performance evidence

Record machine-readable measurements for at least Animartrix and
WasmScreenCoords:

- cold compile duration;
- warm/cache-hit compile duration;
- generated WASM size;
- runtime initialization duration;
- sustained frame throughput for the selected test interval;
- browser main-thread responsiveness while the FastLED worker runs.

Thresholds must be defined before judging the measured result. If an existing
threshold is missed, explain the cause rather than changing it after the run.

## E. FastLED example catalog

The IDE must expose a visibly separate FastLED example area. The catalog must be
driven by versioned metadata that records, per example:

- title and stable identifier;
- relative source files;
- FastLED version and pinned upstream commit;
- license/provenance;
- authored dimension/geometry metadata;
- optional preview metadata.

The initial catalog includes the six standard parity examples plus Animartrix
and WasmScreenCoords.

Original upstream source files are read-only catalog inputs. Copying an example
into an editable sketch creates a separate editable project.

If preview artifacts are cached, the cache key must include at least source
hash, compiler fingerprint, bridge ABI and FastLED version. Missing or
mismatched cache metadata must fall back to compilation.

UI tests must cover navigation, opening an example, copying it into an editable
sketch, and cache fallback.

## F. Runtime and failure behavior

Acceptance includes focused regression coverage for:

- compile cancellation and stale completion;
- pause and resume;
- reset;
- disposal/navigation away from the isolated FastLED document;
- a sketch with a blocking/infinite loop remaining cancellable by worker
  termination;
- multiple strips;
- rapid multiple `FastLED.show()` calls inside one C++ loop;
- the repository maximum supported pixel count;
- compiler diagnostics for invalid C++;
- compiler unavailability;
- cache integrity and missing cached assets.

Browser evidence must demonstrate the isolated FastLED document and confirm that
returning to the normal PXLBLZ application restores a non-isolated document.

## G. Repository regression gate

After all FastLED-specific work is integrated on the feature branch, run:

- TypeScript checks;
- ESLint;
- focused FastLED Vitest suites;
- full automated tests;
- production build;
- real browser acceptance;
- native/WASM parity;
- the patched-CLI proof;
- matrix/performance validation.

Review for:

- unsupported compatibility claims;
- copied-source or license/provenance problems;
- embedded local paths;
- accidental ArtNet dependencies or edits.

Confirmed defects are fixed in separate reviewable commits and the affected
checks are rerun.

## H. Main synchronization and merge

The feature branch must be updated against the current `main` only after the
isolated FastLED gates above are understood. Resolve integration conflicts with
tests, then rerun the complete validation plan on the resulting feature-branch
tip.

Merge is allowed only when:

1. the patched official CLI proof passes;
2. both configuration fixtures return their exact required RGB values;
3. the six standard examples pass their defined compilation/parity gates;
4. Animartrix and WasmScreenCoords pass their product-path gates;
5. required performance evidence is recorded with known limits;
6. automated and browser regression gates are green;
7. license/provenance and compatibility wording are reviewed;
8. the validated commit is the commit being merged.

Do not merge, rewrite, clean up, or reuse unrelated ArtNet work as part of this
feature.
