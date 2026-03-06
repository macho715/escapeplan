import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fetchLatestPointer, fetchPointerArtifact, normalizeLatestPointer, resolveArtifactUrl } from "./livePointer.js";

describe("livePointer", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("resolves relative artifact URLs from the pointer source", () => {
    const pointer = normalizeLatestPointer(
      {
        version: "2026-03-06T10-00-00Z",
        liteUrl: "./v/2026-03-06T10-00-00Z/state-lite.json",
        aiVersion: "ai-1",
        aiUrl: "./v/2026-03-06T10-00-00Z/state-ai.json",
        legacyUrl: "./hyie_state.json"
      },
      "https://example.com/live/latest.json"
    );

    expect(resolveArtifactUrl("https://example.com/live/latest.json", "./v/a.json")).toBe("https://example.com/live/v/a.json");
    expect(pointer.liteUrl).toBe("https://example.com/live/v/2026-03-06T10-00-00Z/state-lite.json");
    expect(pointer.aiUrl).toBe("https://example.com/live/v/2026-03-06T10-00-00Z/state-ai.json");
    expect(pointer.legacyUrl).toBe("https://example.com/live/hyie_state.json");
  });

  it("falls back across candidates until a valid pointer is found", async () => {
    fetch
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          version: "2026-03-06T10-00-00Z",
          liteUrl: "./v/2026-03-06T10-00-00Z/state-lite.json"
        })
      });

    const pointer = await fetchLatestPointer([
      "https://bad.example/latest.json",
      "https://good.example/live/latest.json"
    ]);

    expect(pointer.version).toBe("2026-03-06T10-00-00Z");
    expect(pointer.liteUrl).toBe("https://good.example/live/v/2026-03-06T10-00-00Z/state-lite.json");
  });

  it("returns null when artifact fetch fails", async () => {
    fetch.mockRejectedValueOnce(new Error("offline"));

    const payload = await fetchPointerArtifact("https://example.com/live/v/state-ai.json");

    expect(payload).toBeNull();
  });
});
