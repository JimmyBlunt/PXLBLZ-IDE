# FastLED execution parity on the PC

The parity harness compares the original FastLED 3.10.4 C++ sketches compiled
as native desktop executables with the same C++ sketches compiled to WASM.
It does not translate their animation algorithms into JavaScript and does not
claim electrical, microcontroller, or physical LED equivalence.

## What is compared

`test/fastled/parity-runtime.hpp` registers an upstream `EngineEvents` listener.
At every `onEndShowLeds` event it records the controller's logical `CRGB` array,
its strip ordinal, the master brightness, and the virtual time. Capturing each
show is essential: Blink displays red and black within one invocation of
`loop()`. A comparison of only the final array would miss red entirely.

`compare.mjs` requires nonempty recordings, identical frame counts, identical
time/strip/brightness metadata, and exact equality of every RGB byte. Its
failure identifies the first differing frame, strip, pixel and channel.
Passing an empty log or dropping an intermediate show cannot pass the check.
These are logical C++ pixel values before output colour correction, temperature,
dithering, and browser display gamma. The IDE's presentation adapter requires
its own tests against its explicitly chosen presentation contract.

## Reproducibility and instrumentation

`prepare.mjs` accepts only the pinned `library.properties` version 3.10.4 and
creates an isolated source copy under ignored `test/fastled/.cache`. It records
the SHA-256 of every original `.ino` and all supporting files. The original sketches remain verbatim in
`original-sketch.hpp`; a wrapper renames only `setup` and `loop` and supplies
the test entrypoints. The initial corpus is Blink, ColorPalette, Fire2012,
DemoReel100, Noise and NoisePlusPalette.

The isolated library copy replaces the native and WASM platform clocks with
one unsigned 32-bit virtual microsecond counter. Delays advance that counter;
each explicit test step advances it by 16,667 microseconds by default. Both
executions seed FastLED's random16 generator with 1337. Arduino `random()` is
backed by the same small test PRNG in both targets, because native libc and
Emscripten libc do not promise identical random sequences. This models
identical test inputs rather than reproducing every board's entropy source.
Transmit refresh-rate throttling is disabled after setup; it is not part of
the PC calculation contract. The test delay path skips asynchronous task pumping
so a virtual delay cannot wait forever on a frozen clock. This corpus therefore
does not qualify asynchronous tasks or coroutine behavior. No production
library is patched by preparation.

## Running

```text
node test/fastled/prepare.mjs C:/path/to/FastLED-3.10.4
node test/fastled/build-native.mjs
fastled test/fastled/.cache/sketches/Blink --just-compile --no-app --no-interactive --fastled-path test/fastled/.cache/FastLED
node test/fastled/run-wasm.mjs <generated-fastled.js> wasm.log 120 16667
node test/fastled/compare.mjs native.log wasm.log
node --test test/fastled/compare.test.mjs
```

Run `test/fastled/.cache/native/Blink.exe 120 16667` and capture its stdout as
`native.log`; use equivalent executable names on other systems. Repeat with
each corpus sketch. `FASTLED_NATIVE_CXX` selects the native compiler; the
default is `zig c++`. A 64-bit compiler is required for the tested Windows
platform configuration. The initially available 32-bit MinGW GCC 10.2 failed
upstream pointer/size type checks and is unsuitable for this configuration.
Bundled native Clang can also be selected; on Windows the harness selects its
64-bit MinGW target and libc++ rather than requiring Visual Studio headers.
Native object reuse is keyed by the complete source-tree content hash, compiler
identity/version and build flags. Editing any included header invalidates it.

For DemoReel100, run long enough to reach every ten-second pattern change.
Short runs test only its opening effect. Likewise ColorPalette needs enough
virtual time to exercise its palette schedule. Byte counts and covered virtual
duration belong in the evidence; a screenshot alone is not parity evidence.

For the entire corpus, create a JSON object mapping each of the six example
names to its compiled `fastled.js` path, then run
`node test/fastled/run-corpus.mjs module-manifest.json`. Missing examples,
timeouts, compiler/runtime errors and unequal output fail the run. It records
per-example logs, source hashes, byte counts and virtual duration; only a fully
passing run writes `evidence/report.json` with `complete: true`.
`node test/fastled/build-wasm.mjs` compiles all six sketches sequentially with
the installed official CLI and writes `.cache/wasm/modules.json` for this
runner. `FASTLED_CLI` can select the CLI executable. It checks the generated
library compile plan contains every upstream unity source file and keeps each
compiler log under `.cache/wasm`.

## Upstream presentation differences

FastLED 3.10.4's WASM capture uses a separate RGB pixel controller and disables
colour adjustment while retaining brightness. Its native stub capture also
forces full brightness under `FASTLED_HD_COLOR_MIXING`. These are distinct
presentation choices, so comparing those two default preview buffers is not a
sound test of the sketches' logical output. See the pinned
[WASM controller](https://github.com/FastLED/FastLED/blob/3.10.4/src/platforms/wasm/clockless_channel_wasm.h)
and [native controller](https://github.com/FastLED/FastLED/blob/3.10.4/src/platforms/stub/clockless_channel_stub.h).

## Evidence status

On 2026-10-02, the complete upstream library and all six instrumented sketches
compiled with native Clang 21.1.5 for 64-bit Windows. Each executable then ran
four loops successfully (exit 0), without a separately configured DLL path:

| Example | Captured show records |
| --- | ---: |
| Blink | 8 |
| ColorPalette | 44 |
| Fire2012 | 68 |
| DemoReel100 | 36 |
| Noise | 4 |
| NoisePlusPalette | 4 |

The counts exceed loop counts where the sketch or `FastLED.delay()` calls
`show()` multiple times. Blink's first records are red at 16,667 microseconds
and black at 516,667 microseconds. Four comparator/cache self-tests also pass.

A subsequent full native run completed with seed 1337 and 16,667 microseconds
advanced before each loop. `node test/fastled/run-native.mjs` reproduces it.
The committed `test/fastled/evidence/native-reference.json` records source and
frame-stream SHA-256 hashes, compiler identity and the following coverage:

| Example | Loops | Show records | RGB bytes | Last virtual time (seconds) |
| --- | ---: | ---: | ---: | ---: |
| Blink | 12 | 24 | 72 | 7.300004 |
| ColorPalette | 3,000 | 33,000 | 4,950,000 | 83.001000 |
| Fire2012 | 300 | 5,100 | 459,000 | 12.800100 |
| DemoReel100 | 3,600 | 32,400 | 6,220,800 | 91.801200 |
| Noise | 300 | 300 | 230,400 | 8.000100 |
| NoisePlusPalette | 300 | 300 | 230,400 | 8.000100 |

Raw logs remain local under `.cache/evidence`; the committed hashes describe
the parsed ordered frame arrays encoded with `JSON.stringify` and UTF-8.
The complete native-versus-WASM corpus then passed with exit 0. Every row in
the table above matches exactly: **71,124 show records and 12,090,672 RGB
bytes**, including timestamps, strip order and brightness. DemoReel100 crosses
all six ten-second effect switches and ColorPalette crosses its full minute
schedule. The WASM build used Emscripten 4.0.19 through FastLED CLI 2.0.22;
native execution used Clang 21.1.5.

`test/fastled/evidence/native-wasm-parity.json` contains the complete run's
source hashes, WASM artifact hashes, exact frame-stream hashes and durations.
Its compiler identity comes from the generated Meson compiler metadata. The
raw recordings and compiler logs remain reproducible local cache artifacts.
This proves the documented logical CRGB contract for these six fixtures and
inputs. Actual IDE worker delivery, lifecycle and presentation are separate
integration tests; arbitrary sketches and untested hardware APIs are not
covered by this corpus.

For trimmed source copies, set `UV_PYTHON` and `FASTLED_PYTHON_EXECUTABLE` to
the same Python 3.11+ interpreter used by the compiler toolchain. Upstream
Meson helpers invoke `uv run python`; without that explicit selection they
may choose an older ambient interpreter lacking `tomllib`.
On Windows, prepare with `--share-python-env` when the upstream source already
has a working `.venv`. This creates an ignored junction to that Python
environment. It prevents the CLI's fallback `python.cmd` from truncating
Meson's multiline source-cache argument. The FastLED source and build caches
remain separate. The corpus builder uses `RAYON_NUM_THREADS=4` and
`EMCC_CORES=2` by default. A two-thread Rayon pool intermittently failed during
CLI fingerprinting on this machine, and it also recurred with four threads.
The builder retries only this specific pre-compilation failure up to three
times and preserves every attempt's log; all other failures stop immediately.
