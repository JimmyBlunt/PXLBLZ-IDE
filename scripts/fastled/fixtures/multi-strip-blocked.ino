// Acceptance fixture: preserve both upstream strip buffers and terminate a
// blocked sketch without waiting for its loop to return.
#include <FastLED.h>

CRGB firstStrip[2];
CRGB secondStrip[1];

void setup() {
  FastLED.addLeds<WS2812B, 3, GRB>(firstStrip, 2)
      .setCorrection(TypicalLEDStrip);
  FastLED.addLeds<WS2812B, 4, GRB>(secondStrip, 1)
      .setCorrection(TypicalLEDStrip);
  FastLED.setBrightness(128);
  firstStrip[0] = CRGB(255, 128, 64);
  firstStrip[1] = CRGB(16, 32, 240);
  secondStrip[0] = CRGB(9, 201, 77);
  FastLED.show();
}

void loop() {
  while (true) {}
}
