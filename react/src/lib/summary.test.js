import { describe, expect, it } from "vitest";

import { deriveState } from "./deriveState.js";
import { buildFullReport, buildOfflineSummary } from "./summary.js";
import { createDashboard } from "../test/fixtures.js";

describe("summary", () => {
  it("builds the offline summary with core dashboard signals", () => {
    const dash = createDashboard();
    const derived = deriveState(dash);
    const text = buildOfflineSummary(dash, derived);

    expect(text).toContain("MODE:");
    expect(text).toContain("최신 Intel Top3");
    expect(text).toContain("추천 이동");
  });

  it("builds the full report with routes, intel, AI, and checklist sections", () => {
    const dash = createDashboard();
    const derived = deriveState(dash);
    const text = buildFullReport(dash, derived);

    expect(text).toContain("UrgentDash Situation Report");
    expect(text).toContain("Routes:");
    expect(text).toContain("Latest Intel:");
    expect(text).toContain("AI Summary:");
    expect(text).toContain("Checklist:");
  });
});
