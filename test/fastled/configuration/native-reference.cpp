// Compile the same header dispatch operation against unmodified upstream C++.
// Including its implementation here keeps this small oracle independent of
// the deterministic whole-library corpus cache and its time/random patches.
#define FASTLED_HSV_CONVERSION_SPECTRUM 1
#include <FastLED.h>
#include "hsv2rgb.cpp.hpp"
#include <stdio.h>
int main() {
    CRGB color;
    hsv2rgb_dispatch(CHSV(32, 255, 255), color);
    printf("{\"rgb\":[%u,%u,%u]}\n", color.r, color.g, color.b);
}
