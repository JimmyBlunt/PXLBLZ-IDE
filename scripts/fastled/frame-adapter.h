#pragma once

// Observe the upstream WASM output after every show(), including multiple
// shows inside one loop(). No FastLED arithmetic or sketch source is replaced.
#include <FastLED.h>
#include <emscripten.h>
#include "fl/system/engine_events.h"

EM_JS(void, pxlblz_emit_frame, (), {
  if (typeof Module['pxlblzOnFrame'] === 'function') Module['pxlblzOnFrame']();
});

namespace pxlblz_fastled {
class FrameObserver final : public fl::EngineEvents::Listener {
 public:
  FrameObserver() { fl::EngineEvents::addListener(this, -1000); }
  ~FrameObserver() { fl::EngineEvents::removeListener(this); }
  void onEndFrame() FL_NOEXCEPT override { pxlblz_emit_frame(); }
};
static FrameObserver frameObserver;
}  // namespace pxlblz_fastled
