# FastLED CLI integration patch

PXLBLZ uses the official [FastLED CLI](https://github.com/FastLED/cli) as its
computer-only C++/WASM compiler. `UPSTREAM_COMMIT` pins the reviewed upstream
source. Apply the patches in lexical order before building the headless CLI:

```powershell
git clone https://github.com/FastLED/cli.git C:\src\fastled-cli
Set-Location C:\src\fastled-cli
git checkout (Get-Content <PXLBLZ>\vendor\fastled-cli\UPSTREAM_COMMIT)
git apply <PXLBLZ>\vendor\fastled-cli\patches\0001-preserve-sketch-configuration.patch
cargo test -p fastled-cli --no-default-features sketch_preprocessor
cargo build -p fastled-cli --no-default-features --release
```

The patch removes the shared sketch header unit because it evaluates FastLED
configuration before sketch-local `#define` directives. It also places Arduino
function prototypes after the sketch preamble and makes the GUI dependency
optional for a compiler-service build.

The first local debug build reached the final `fastled-cli` compile/link phase
but was interrupted to create the requested checkpoint. The patch is therefore
an open candidate, not yet an accepted production dependency.
