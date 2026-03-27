import { describe, it, expect } from "vitest";
import { getOffPeakInfo, msUntilOffPeak } from "./off-peak.js";

describe("getOffPeakInfo", () => {
  // Peak hours: 8 AM – 2 PM ET on weekdays

  it("identifies weekday peak hour (10 AM ET on a Tuesday)", () => {
    // 2026-03-17 is a Tuesday. 10 AM ET = 14:00 UTC (EDT, UTC-4)
    const date = new Date("2026-03-17T14:00:00Z");
    const info = getOffPeakInfo(date);
    expect(info.isOffPeak).toBe(false);
    expect(info.promoActive).toBe(true);
  });

  it("identifies weekday off-peak hour (3 PM ET on a Wednesday)", () => {
    // 2026-03-18 is a Wednesday. 3 PM ET = 19:00 UTC (EDT)
    const date = new Date("2026-03-18T19:00:00Z");
    const info = getOffPeakInfo(date);
    expect(info.isOffPeak).toBe(true);
    expect(info.promoActive).toBe(true);
  });

  it("identifies weekday early morning as off-peak (6 AM ET on a Monday)", () => {
    // 2026-03-16 is a Monday. 6 AM ET = 10:00 UTC (EDT)
    const date = new Date("2026-03-16T10:00:00Z");
    const info = getOffPeakInfo(date);
    expect(info.isOffPeak).toBe(true);
    expect(info.promoActive).toBe(true);
  });

  it("identifies weekend as off-peak (Saturday noon ET)", () => {
    // 2026-03-14 is a Saturday. 12 PM ET = 16:00 UTC (EDT)
    const date = new Date("2026-03-14T16:00:00Z");
    const info = getOffPeakInfo(date);
    expect(info.isOffPeak).toBe(true);
    expect(info.promoActive).toBe(true);
  });

  it("identifies Sunday as off-peak", () => {
    // 2026-03-15 is a Sunday. 10 AM ET = 14:00 UTC
    const date = new Date("2026-03-15T14:00:00Z");
    const info = getOffPeakInfo(date);
    expect(info.isOffPeak).toBe(true);
    expect(info.promoActive).toBe(true);
  });

  it("identifies 8 AM ET exactly as peak", () => {
    // 2026-03-17 Tuesday. 8 AM ET = 12:00 UTC (EDT)
    const date = new Date("2026-03-17T12:00:00Z");
    const info = getOffPeakInfo(date);
    expect(info.isOffPeak).toBe(false);
  });

  it("identifies 2 PM ET exactly as off-peak (end of peak)", () => {
    // 2026-03-17 Tuesday. 2 PM ET = 18:00 UTC (EDT)
    const date = new Date("2026-03-17T18:00:00Z");
    const info = getOffPeakInfo(date);
    expect(info.isOffPeak).toBe(true);
  });

  it("promo is active during March 13-28, 2026", () => {
    const date = new Date("2026-03-20T12:00:00Z");
    const info = getOffPeakInfo(date);
    expect(info.promoActive).toBe(true);
  });

  it("promo is not active before March 13, 2026", () => {
    const date = new Date("2026-03-12T12:00:00Z");
    const info = getOffPeakInfo(date);
    expect(info.promoActive).toBe(false);
  });

  it("promo is not active after March 28, 2026", () => {
    const date = new Date("2026-03-30T12:00:00Z");
    const info = getOffPeakInfo(date);
    expect(info.promoActive).toBe(false);
  });

  it("returns a nextTransition Date", () => {
    const date = new Date("2026-03-17T14:00:00Z"); // 10 AM ET peak
    const info = getOffPeakInfo(date);
    expect(info.nextTransition).toBeInstanceOf(Date);
    expect(info.nextTransition.getTime()).toBeGreaterThan(date.getTime());
  });
});

describe("msUntilOffPeak", () => {
  it("returns 0 when already off-peak", () => {
    // 2026-03-14 Saturday noon ET
    const date = new Date("2026-03-14T16:00:00Z");
    expect(msUntilOffPeak(date)).toBe(0);
  });

  it("returns positive ms during peak hours", () => {
    // 2026-03-17 Tuesday 10 AM ET = 14:00 UTC
    const date = new Date("2026-03-17T14:00:00Z");
    const ms = msUntilOffPeak(date);
    expect(ms).toBeGreaterThan(0);
    // Should be ~4 hours (until 2 PM ET)
    const fourHours = 4 * 60 * 60 * 1000;
    expect(ms).toBeLessThanOrEqual(fourHours);
    expect(ms).toBeGreaterThan(3 * 60 * 60 * 1000); // at least 3 hours
  });

  it("returns 0 on weekends", () => {
    // 2026-03-15 Sunday 10 AM ET
    const date = new Date("2026-03-15T14:00:00Z");
    expect(msUntilOffPeak(date)).toBe(0);
  });

  it("returns 0 after peak ends on a weekday", () => {
    // 2026-03-17 Tuesday 7 PM ET = 23:00 UTC
    const date = new Date("2026-03-17T23:00:00Z");
    expect(msUntilOffPeak(date)).toBe(0);
  });

  it("returns 0 before peak starts on a weekday", () => {
    // 2026-03-17 Tuesday 6 AM ET = 10:00 UTC
    const date = new Date("2026-03-17T10:00:00Z");
    expect(msUntilOffPeak(date)).toBe(0);
  });
});
