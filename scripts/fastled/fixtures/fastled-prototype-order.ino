#include <FastLED.h>
CRGB leds[1];
void setup() { FastLED.addLeds<WS2812B, 2, RGB>(leds, 1); FastLED.setBrightness(255); FastLED.setDither(0); }
void loop() { leds[0] = makeColor(); FastLED.show(); }
// Arduino preprocessing must make this declaration available after FastLED's
// types are defined, even though the function definition follows its caller.
CRGB makeColor() { return CRGB(17, 34, 51); }
