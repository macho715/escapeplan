import { describe, expect, it } from "vitest";

import { clamp01, clampEgress, formatTimeGST, truncate } from "./utils.js";

describe("utils", () => {
  it("clamps normalized values", () => {
    expect(clamp01(-1)).toBe(0);
    expect(clamp01(0.5)).toBe(0.5);
    expect(clamp01(2)).toBe(1);
  });

  it("clamps egress ETA and falls back for invalid inputs", () => {
    expect(clampEgress(-1)).toBe(10);
    expect(clampEgress(6)).toBe(6);
    expect(clampEgress(1200)).toBe(999);
  });

  it("formats GST timestamps and truncates long text", () => {
    expect(formatTimeGST("2026-03-06T12:05:00Z")).toBe("16:05");
    expect(truncate("alpha beta gamma delta", 12)).toBe("alpha beta …");
  });
});
