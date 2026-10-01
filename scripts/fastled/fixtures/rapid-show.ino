// Regression: both shows happen before a long wait. The lasting display is blue.
#include <FastLED.h>

CRGB leds[1];

void setup() {
  FastLED.addLeds<WS2812B, 3, GRB>(leds, 1);
  FastLED.setBrightness(255);
}

void loop() {
  leds[0] = CRGB::Red;
  FastLED.show();
  leds[0] = CRGB::Blue;
  FastLED.show();
  delay(1000);
}
