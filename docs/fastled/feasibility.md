# FastLED in PXLBLZ-IDE: feasibility and acceptance

Status: implementation in progress; no full-compatibility claim or main merge.
Research date: 2026-10-02. Scope clarified by the user: computer rendering only;
FastLED source does not need to run on Pixelblaze hardware.

## Decision

Reuse original FastLED C++ compiled to WebAssembly, rather than reimplementing its
color arithmetic, templates, noise, palettes, or timing macros in JavaScript.
Feed copied RGB frames to the existing PXLBLZ WebGL renderer. Keep C++ source in
an explicitly named FastLED workspace, separate from Pixelblaze Pattern records,
Show compilation, and Send to Controller. Import/export `.ino` files explicitly;
do not silently introduce a second browser-local personal-content database.

The implementation branch is `feature/fastled-runtime`, isolated at
`~/src/worktrees/pxlblz-fastled`, based on main `d685125b`. The user's existing
ArtNet checkout contains unrelated uncommitted work and remains untouched.
On this Windows machine the private reviewed-main skill and execution policy
are missing. The user explicitly authorized an alternative local workflow:
isolated worktree, traceable commits, behavioral tests, agent review, and no
merge to main until the acceptance criteria pass. Tool installation is authorized.

## Existing implementations investigated

| Candidate | Evidence and suitability |
| --- | --- |
| [FastLED 3.10.4](https://github.com/FastLED/FastLED/releases/tag/3.10.4) | Latest stable release returned by the live GitHub API during research. Original library, native stub and WASM targets; MIT license. Pin commit `adedfc40e73fb80f8e930318781036d8fe1dbd9f`. |
| [FastLED CLI 2.0.22](https://github.com/FastLED/cli/releases/tag/v2.0.22) | Native Windows compiler/toolchain frontend, MIT. Former `zackees/fastled-wasm` repository redirects here. `--just-compile`, `--no-app`, `--fastled-path` support embedding. Selected for reuse. |
| [jandelgado/fastled-wasm](https://github.com/jandelgado/fastled-wasm) | Older browser prototype, modifies examples into render functions. Less suitable for unchanged modern source. |
| [ArduinoOnPc-FastLED-GFX-LEDMatrix](https://github.com/marcmerlin/ArduinoOnPc-FastLED-GFX-LEDMatrix) | Native SDL/X11 simulation; useful reference but adds a modified library and no direct browser runtime. |
| [Wokwi ESP32 simulation](https://docs.wokwi.com/guides/esp32) | Potential independent MCU reference. Not assumed to be an embeddable, distributable IDE runtime. |

The first two are the implementation basis, not just inspiration. Future
upstream upgrades require rerunning the parity suite; a moving `latest` download
cannot support a reproducible compatibility assertion.

## Integration design

1. Local loopback compiler service builds user C++ with pinned upstream sources.
   It reports actual diagnostics and serves immutable build artifacts.
2. A dedicated worker loads each WASM artifact and drives setup/loop. Termination
   and reset dispose the worker so a broken sketch cannot freeze the editor.
3. A small C++ output adapter observes every FastLED show event. Polling only
   after loop would lose intermediate frames in Blink and other blocking demos.
4. Copy borrowed strip RGB buffers before another show or WASM memory growth.
   Flatten strips deterministically without resizing the authored LED count.
5. Normalize bytes for the existing renderer. Geometry and monitor presentation
   are separate from the underlying byte comparison.

## Limits requiring explicit evidence

- C++/FastLED algorithms can execute unchanged. Arbitrary MCU peripherals,
  assembly, Wi-Fi drivers, sensor libraries and interrupt timing cannot be
  guaranteed by a PC WASM runtime. Missing dependencies must fail visibly.
- Upstream WASM uses a wall clock and busy-wait delay. Reproducible tests need a
  controlled clock and identical seeds. Arduino libc rand is not automatically
  identical across processor C libraries.
- The upstream WASM visual capture disables color correction; the native stub
  may also force brightness to 255 in HD mixing mode. Logical CRGB parity,
  upstream visual-buffer parity and physical LED output are distinct contracts.
  See the pinned [WASM capture](https://github.com/FastLED/FastLED/blob/3.10.4/src/platforms/wasm/clockless_channel_wasm.h)
  and [native capture](https://github.com/FastLED/FastLED/blob/3.10.4/src/platforms/stub/clockless_channel_stub.h).
- Browser pixels include display geometry and rendering presentation. Screenshots
  supplement byte comparisons; they do not replace them.
- Single `.ino` editing is an initial integration milestone. Multi-file projects,
  custom libraries, audio/file inputs and FastLED UI controls require additional
  integration and must not be reported as already supported.

## Acceptance before merge

- Official upstream Blink, DemoReel100, ColorPalette, Fire2012 and
  NoisePlusPalette sources are recorded with provenance and compiled.
- Reference execution and IDE adapter compare LED counts, frame order, timestamps
  under a controlled clock, and RGB bytes; random sequences use identical seeds.
- Edge cases include multiple shows per loop, multiple strips, restart, pause,
  source compile failure, stale compile completion, long-running sketch,
  brightness and correction settings, and compiler unavailability.
- Existing Pixelblaze behavior remains covered by relevant regression suites.
- Desktop and narrow-screen browser tests prove edit/compile/run, import/export,
  diagnostics and clean runtime disposal. Build/type checks pass.
- Record exact revisions, commands, results and remaining gaps. Agent review
  examines the actual committed implementation. Do not merge on partial proof.

## Milestones

- [x] Research reuse candidates and inspect original ABI.
- [x] Isolated worktree and user-approved local workflow.
- [ ] Compiler smoke using pinned FastLED.
- [ ] IDE editor, worker and renderer integration.
- [ ] Native/WASM demo parity and fixes.
- [ ] Full acceptance, review and conditional main merge.
