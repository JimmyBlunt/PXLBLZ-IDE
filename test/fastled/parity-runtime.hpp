#pragma once

// Test instrumentation only. All animation and colour calculations remain in
// the original upstream sketch and FastLED library.
#include <FastLED.h>
#include <stdio.h>
#include "fl/system/engine_events.h"
#include "fl/stl/chrono.h"

#ifdef __EMSCRIPTEN__
#include <emscripten.h>
#define PXL_EXPORT EMSCRIPTEN_KEEPALIVE
#else
#define PXL_EXPORT
#endif

extern "C" unsigned int pxlblz_test_time_us = 0;
extern "C" unsigned int pxlblz_test_random_state = 1337;
extern "C" unsigned int pxlblz_test_random() {
    pxlblz_test_random_state ^= pxlblz_test_random_state << 13;
    pxlblz_test_random_state ^= pxlblz_test_random_state >> 17;
    pxlblz_test_random_state ^= pxlblz_test_random_state << 5;
    return pxlblz_test_random_state & 0x7fffffffu;
}

class PxlParityCapture : public fl::EngineEvents::Listener {
public:
    void onEndShowLeds() override {
        unsigned int strip = 0;
        for (CLEDController* c = CLEDController::head(); c; c = c->next(), ++strip) {
            printf("PXLFRAME {\"timeUs\":%u,\"strip\":%u,\"brightness\":%u,\"rgb\":[",
                   pxlblz_test_time_us, strip, FastLED.getBrightness());
            const CRGB* pixels = c->leds();
            for (int i = 0; i < c->size(); ++i) {
                printf("%s%u,%u,%u", i ? "," : "", pixels[i].r, pixels[i].g, pixels[i].b);
            }
            printf("]}\n");
        }
    }
};

void pxlblz_sketch_setup();
void pxlblz_sketch_loop();

extern "C" PXL_EXPORT void pxlblz_test_setup(unsigned int seed) {
    static PxlParityCapture capture;
    pxlblz_test_time_us = 0;
    pxlblz_test_random_state = seed ? seed : 1;
    printf("PXLPROVENANCE {\"example\":\"%s\",\"sourceSha256\":\"%s\",\"seed\":%u}\n",
           PXL_TEST_EXAMPLE, PXL_TEST_SOURCE_SHA256, seed);
    random16_set_seed(static_cast<fl::u16>(seed));
    fl::EngineEvents::addListener(&capture);
    pxlblz_sketch_setup();
    // Hardware transmit throttling is outside this PC calculation contract.
    FastLED.setMaxRefreshRate(0, false);
}

extern "C" PXL_EXPORT void pxlblz_test_step(unsigned int advanceUs) {
    pxlblz_test_time_us += advanceUs;
    pxlblz_sketch_loop();
}

#ifndef __EMSCRIPTEN__
#include <stdlib.h>
int main(int argc, char** argv) {
    const unsigned int steps = argc > 1 ? static_cast<unsigned int>(strtoul(argv[1], nullptr, 10)) : 120;
    const unsigned int advance = argc > 2 ? static_cast<unsigned int>(strtoul(argv[2], nullptr, 10)) : 16667;
    pxlblz_test_setup(1337);
    for (unsigned int i = 0; i < steps; ++i) pxlblz_test_step(advance);
    return 0;
}
#endif
