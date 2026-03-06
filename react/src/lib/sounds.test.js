import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { alertSound, warnSound } from "./sounds.js";

describe("sounds", () => {
  let createOscillator;
  let createGain;

  beforeEach(() => {
    createOscillator = vi.fn(() => ({
      connect: vi.fn(),
      frequency: { value: 0 },
      start: vi.fn(),
      stop: vi.fn()
    }));
    createGain = vi.fn(() => ({
      connect: vi.fn(),
      gain: {
        value: 0,
        exponentialRampToValueAtTime: vi.fn()
      }
    }));

    window.AudioContext = class AudioContextMock {
      constructor() {
        this.state = "running";
        this.currentTime = 0;
        this.destination = {};
      }

      createOscillator() {
        return createOscillator();
      }

      createGain() {
        return createGain();
      }

      resume() {
        return Promise.resolve();
      }
    };
  });

  afterEach(() => {
    delete window.AudioContext;
  });

  it("plays the expected alert and warning beeps", () => {
    expect(alertSound()).toBe(true);
    expect(warnSound()).toBe(true);
    expect(createOscillator).toHaveBeenCalledTimes(4);
    expect(createGain).toHaveBeenCalledTimes(4);
  });
});
