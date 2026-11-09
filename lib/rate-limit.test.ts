import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { isRateLimited, clearRateLimits } from "@/lib/rate-limit";

beforeEach(() => {
  clearRateLimits();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-09T10:00:00Z"));
});
afterEach(() => vi.useRealTimers());

describe("isRateLimited", () => {
  it("autorise `limit` appels puis refuse les suivants dans la fenêtre", () => {
    expect([1, 2, 3].map(() => isRateLimited("k", 3, 60_000))).toEqual([false, false, false]);
    expect(isRateLimited("k", 3, 60_000)).toBe(true);
    expect(isRateLimited("k", 3, 60_000)).toBe(true);
  });

  it("repart à zéro une fois la fenêtre écoulée", () => {
    for (let i = 0; i < 4; i++) isRateLimited("k", 3, 60_000);
    vi.advanceTimersByTime(60_001);
    expect(isRateLimited("k", 3, 60_000)).toBe(false);
  });

  it("compteurs indépendants par clé", () => {
    for (let i = 0; i < 4; i++) isRateLimited("a", 3, 60_000);
    expect(isRateLimited("a", 3, 60_000)).toBe(true);
    expect(isRateLimited("b", 3, 60_000)).toBe(false);
  });

  it("clearRateLimits remet tous les compteurs à zéro", () => {
    for (let i = 0; i < 4; i++) isRateLimited("a", 3, 60_000);
    clearRateLimits();
    expect(isRateLimited("a", 3, 60_000)).toBe(false);
  });
});
