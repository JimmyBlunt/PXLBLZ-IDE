#define FASTLED_HSV_CONVERSION_SPECTRUM 1
#include <FastLED.h>
CRGB leds[1];
void setup() { FastLED.addLeds<WS2812B, 2, RGB>(leds, 1); FastLED.setBrightness(255); FastLED.setDither(0); }
void loop() { hsv2rgb_dispatch(CHSV(32, 255, 255), leds[0]); FastLED.show(); delay(100); }
