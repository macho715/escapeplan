import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { cacheLastDash, loadCachedDash } from "./offlineCache.js";

describe("offlineCache", () => {
  let storedPayload = null;

  beforeEach(() => {
    storedPayload = null;
    vi.stubGlobal("indexedDB", {
      open: vi.fn(() => {
        const request = {};
        queueMicrotask(() => {
          const db = {
            objectStoreNames: {
              contains: () => true
            },
            createObjectStore: vi.fn(),
            close: vi.fn(),
            transaction: vi.fn(() => {
              const tx = {
                oncomplete: null,
                onerror: null,
                objectStore: () => ({
                  put: (value) => {
                    const req = {};
                    queueMicrotask(() => {
                      storedPayload = value;
                      req.onsuccess?.({ target: { result: "latest" } });
                      tx.oncomplete?.();
                    });
                    return req;
                  },
                  get: () => {
                    const req = {};
                    queueMicrotask(() => {
                      req.result = storedPayload;
                      req.onsuccess?.({ target: { result: storedPayload } });
                      tx.oncomplete?.();
                    });
                    return req;
                  }
                })
              };
              return tx;
            })
          };
          request.result = db;
          request.onupgradeneeded?.({ target: { result: db } });
          request.onsuccess?.({ target: { result: db } });
        });
        return request;
      })
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("stores and reloads the latest dashboard payload", async () => {
    const payload = await cacheLastDash({ metadata: { stateTs: "2026-03-06T10:00:00Z" }, indicators: [], hypotheses: [] });
    const cached = await loadCachedDash();

    expect(payload.cachedAt).toBeTruthy();
    expect(cached.dashboard.metadata.stateTs).toBe("2026-03-06T10:00:00Z");
  });
});
