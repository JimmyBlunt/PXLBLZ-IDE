# Local FastLED compiler

The FastLED workspace compiles C++ with the official FastLED WASM backend and
runs the result on the computer. It does not translate FastLED into Pixelblaze
code, compile firmware, upload to a Controller, or execute a generated native
program. FastLED is pinned to 3.10.4; compiler CLI validation uses 2.0.22.

## Setup

Install [uv](https://docs.astral.sh/uv/getting-started/installation/), then:

```powershell
uv tool install fastled==2.0.22
git clone --branch 3.10.4 --depth 1 https://github.com/FastLED/FastLED.git C:/src/FastLED-3.10.4
$env:FASTLED_PATH = 'C:/src/FastLED-3.10.4'
npm run preflight -- port 9982
node scripts/fastled/server.mjs
```

The official CLI installs its compiler dependencies on the first compilation.
This can take several minutes and requires network access and free disk space.
`FASTLED_CLI` optionally specifies the executable path. The subprocess uses
explicit arguments and never invokes a command shell. `FASTLED_PORT` defaults
to 9982. The server binds exclusively to `127.0.0.1`.

The normal local development origins on ports 5174 and 5184 are allowed.
`FASTLED_ORIGINS` replaces that list with comma-separated exact origins; add
an origin only for a trusted IDE instance. The service checks the Host header
against localhost/127.0.0.1 and rejects other origins. Keep this service local:
compilation processes source with the local C++ toolchain, and is not a hosted
multi-tenant security sandbox.

## HTTP contract

- `GET /health` returns service status, the pinned library version, and the
  count of running/queued compilations. This endpoint checks the service, not
  whether the toolchain has completed its first installation.
- `POST /compile`, with `Content-Type: application/json` and
  `{ "source": "...", "files": { "helper.h": "..." }, "name": "optional display name" }`, accepts one sketch.
  The name does not affect filesystem paths. Success returns `id`, `moduleUrl`,
  `runtimeUrl`, `wasmUrl`, `diagnostics`, and `fastledVersion`.
- `GET /builds/<sha256>/<asset>` serves only compiler JavaScript/WASM/data
  assets. Source, manifests, and arbitrary local paths are not served.

Source and supporting files together are limited to 1 MiB, diagnostics to the last 128 KiB, each compile to ten
minutes, and the queue to three requests including the active one. Builds run
serially; identical concurrent requests share a build. The cache key includes
the source and sorted supporting files, pinned version, Git revision, compiler
version, bridge ABI, and frame observer. The selected library must be a clean
Git checkout; modified library/compiler sources are rejected. A missing cached
asset triggers recompilation. Restart the service after upgrading the CLI.
Completed assets are cached in
the operating system temporary directory under `pxlblz-fastled-3.10.4/builds`.
Temporary source directories are removed after each build. Cache artifacts can
be removed while the service is stopped to reclaim space.

Failures return JSON with `error` and `diagnostics`: 400 invalid source/JSON,
413 size limit, 415 wrong content type, 422 compiler diagnostics, 429 full queue,
503 missing compiler/library, and 504 timeout. On Windows, timeout terminates
the compiler process tree. Compilation never requests interactive input.
The upstream Arduino parser has a separate two-second cooperative deadline.
When that exact deadline expires under build load, the service retries once
with unchanged source and compiler arguments, within the original overall
timeout. The exact upstream Rayon fingerprint traversal failure is likewise
retried at most once within that same deadline. Other compiler failures are
not retried unless they match the macro-parser fallback described below.

The CLI's Arduino syntax parser can reject valid macro-rich C++, including
the original ColorPalette and DemoReel100 examples. Only for its exact
`sketch has incomplete C++ syntax` diagnostic, the bridge retries with the
unchanged source inside the reserved `pxlblz-sketch-source.h` header and a tiny
sketch that includes that header and the frame adapter. This lets the actual
C++ compiler validate the source. The fallback does not generate forward
declarations: functions used before definition must have explicit declarations,
as these official examples already do. Invalid C++ still produces compiler
errors. All retry paths share the original ten-minute limit.

## Runtime adapter

The generated ES module exports the upstream `fastled` factory as its default.
Pass `locateFile` resolving adjacent build assets, `mainScriptUrlOrBlob` set to
a same-origin Blob bootstrap that imports the untouched classic `runtimeUrl`,
and `noInitialRun: true`, then
call `_extern_setup` once and `_extern_loop` for subsequent iterations. The
original generated JavaScript is retained; the service writes a separate ES
module copy adding the factory export when needed. Upstream's pthread backend
requires a cross-origin-isolated page (COOP/COEP) and starts a four-worker pool;
the classic runtime URL lets those workers load the original compiler output.

`frame-adapter.h` registers a low-priority `fl::EngineEvents::Listener`. Its
`onEndFrame` callback invokes `Module.pxlblzOnFrame`, after upstream frame
processing. The consumer reads `getFrameData` and `getStripPixelData` from the
official WASM ABI. Observing every show preserves sketches such as Blink that
show multiple different states within one `loop()` invocation. No FastLED
integer arithmetic, color conversion, or user source expressions are rewritten.

The source API accepts one `.ino` body and up to 32 named `.h`, `.hpp`, or lowercase
`.cpp` supporting files plus standard FastLED headers. Header extensions are
case-insensitive. Filenames must be flat,
start with an ASCII letter or digit, and cannot contain `..`, alias another
filename by case, use Windows device names, or replace the generated adapter.
External Arduino libraries, hardware
peripherals and on-device timing are separate capabilities, not a claim of
universal Arduino firmware compatibility.

Compatibility is scoped to the official FastLED PC/WASM target. The pinned
CLI combines the sketch and supporting lowercase `.cpp` files into one C++
translation unit by including those files in sorted order. For example, two
files that each declare `static int state` can conflict here even though an
Arduino build with separate translation units accepts them. Standalone `.c`
and uppercase `.CPP` files are rejected with explicit diagnostics because the
upstream wrapper would silently ignore them. The bridge preserves the
upstream compilation behavior and
does not promise arbitrary Arduino multi-file build equivalence. See
[`create_wrapper` and `collect_cpp_files` in the pinned CLI source](https://github.com/zackees/fastled-wasm/blob/bb1d619c1d64194198f9c68ac852fc79e6a01d9e/crates/fastled-cli/src/wasm_build.rs#L1498).
No supported separate-translation-unit sketch option was identified in this
CLI revision. Matching MCU ABI, physical peripherals, and real-time hardware
timing is outside the computer-rendering acceptance target.

The official WASM preview capture deliberately removes LED color correction
while retaining brightness before exposing RGB through `getStripPixelData`.
The IDE displays those upstream preview bytes; they are not a measurement of
the corrected electrical output sent to physical LEDs. See the pinned
[`showPixels` capture path](https://github.com/FastLED/FastLED/blob/adedfc40e73fb80f8e930318781036d8fe1dbd9f/src/platforms/wasm/clockless_channel_wasm.h#L79).

## Focused verification

```powershell
node --test scripts/fastled/server.test.mjs
```

These tests exercise cache coalescing, build serialization, queue bounds,
compiler failure recovery, subprocess timeout, CORS/Host restrictions, request
validation, artifact serving, and path isolation. They use a fake compiler;
actual FastLED example compilation and pixel parity require the installed
toolchain and are recorded separately in the validation report.

With the service running and `FASTLED_PATH` set to the pinned checkout, run
`node scripts/fastled/compile-examples.mjs` to compile all six original bundled
examples through the production HTTP service. The script checks their bytes
against upstream, downloads each actual runtime/WASM asset, and records source
and artifact SHA-256 hashes in `production-compile-proof.json`. Each example
has a twelve-minute client deadline. A remaining exact Rayon failure permits
one unchanged HTTP retry within that deadline; the evidence records attempts.
