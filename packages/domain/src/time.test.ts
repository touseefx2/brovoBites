import { describe, expect, it } from "vitest";
import {
  businessDateKey,
  businessDayHoursFromSettings,
  businessHour,
  coerceBusinessTime,
  endOfBusinessDay,
  shiftBusinessDateKey,
  openingOfBusinessDay,
  startOfBusinessDay,
  startOfBusinessMonthKey,
} from "./time";

/** Day window [start, end] that contains `d`, per businessDateKey. */
function windowsContaining(d: Date, hours: { start: string; end: string }, around: string) {
  const keys: string[] = [];
  for (let i = -2; i <= 2; i++) {
    const k = shiftBusinessDateKey(around, i);
    if (d >= startOfBusinessDay(k, hours) && d <= endOfBusinessDay(k, hours)) keys.push(k);
  }
  return keys;
}

const overnight = { start: "12:00", end: "04:00" };

describe("shop business time (Asia/Karachi)", () => {
  it("maps UTC midnight to previous Karachi calendar day", () => {
    expect(businessDateKey(new Date("2026-09-27T00:30:00.000Z"))).toBe("2026-09-27");
    expect(businessDateKey(new Date("2026-09-26T20:00:00.000Z"))).toBe("2026-09-27");
  });

  it("builds Karachi day bounds as UTC+5", () => {
    expect(startOfBusinessDay("2026-09-27").toISOString()).toBe(
      "2026-09-26T19:00:00.000Z",
    );
    expect(endOfBusinessDay("2026-09-27").toISOString()).toBe(
      "2026-09-27T18:59:59.999Z",
    );
  });

  it("shifts and months in shop calendar", () => {
    expect(shiftBusinessDateKey("2026-09-27", -1)).toBe("2026-09-26");
    expect(startOfBusinessMonthKey("2026-09-27")).toBe("2026-09-01");
  });

  it("reads hour in Karachi", () => {
    expect(businessHour(new Date("2026-09-27T10:00:00.000Z"))).toBe(15);
  });

  it("assigns overnight hours to the open date", () => {
    // 15:00 PKT 30 Sep — during open
    expect(businessDateKey(new Date("2026-09-30T10:00:00.000Z"), overnight)).toBe(
      "2026-09-30",
    );
    // 03:00 PKT 1 Oct — still previous open day (before 04:00 close)
    expect(businessDateKey(new Date("2026-09-30T22:00:00.000Z"), overnight)).toBe(
      "2026-09-30",
    );
    // 12:00 PKT 1 Oct — new open
    expect(businessDateKey(new Date("2026-10-01T07:00:00.000Z"), overnight)).toBe(
      "2026-10-01",
    );
  });

  it("after overnight close (gap before next open) is the next business day", () => {
    // 10:00 PKT 1 Oct — after 04:00 close, before 12:00 open → empty "today"
    expect(businessDateKey(new Date("2026-10-01T05:00:00.000Z"), overnight)).toBe(
      "2026-10-01",
    );
    // 09:00 PKT 1 Oct — same gap
    expect(businessDateKey(new Date("2026-10-01T04:00:00.000Z"), overnight)).toBe(
      "2026-10-01",
    );
    // 04:00 PKT 1 Oct — still inclusive end of previous open day
    expect(businessDateKey(new Date("2026-09-30T23:00:00.000Z"), overnight)).toBe(
      "2026-09-30",
    );
  });

  it("same-day window: morning before open is upcoming day; after close is next day", () => {
    const day = { start: "09:00", end: "22:00" };
    // 06:00 PKT — before open → today's upcoming business day
    expect(businessDateKey(new Date("2026-10-01T01:00:00.000Z"), day)).toBe("2026-10-01");
    // 15:00 PKT — open
    expect(businessDateKey(new Date("2026-10-01T10:00:00.000Z"), day)).toBe("2026-10-01");
    // 23:00 PKT — after close → next business day
    expect(businessDateKey(new Date("2026-10-01T18:00:00.000Z"), day)).toBe("2026-10-02");
  });

  it("builds overnight day bounds across midnight", () => {
    // Day starts right after the previous close (04:00 PKT), not at opening.
    expect(startOfBusinessDay("2026-09-30", overnight).toISOString()).toBe(
      "2026-09-29T23:01:00.000Z",
    );
    expect(openingOfBusinessDay("2026-09-30", overnight).toISOString()).toBe(
      "2026-09-30T07:00:00.000Z",
    );
    expect(endOfBusinessDay("2026-09-30", overnight).toISOString()).toBe(
      "2026-09-30T23:00:59.999Z",
    );
  });

  it("every instant is in exactly one day window — the one businessDateKey gives", () => {
    const hourSets = [
      overnight,
      { start: "09:00", end: "23:00" },
      { start: "06:00", end: "06:00" },
      { start: "00:00", end: "23:59" },
    ];
    for (const hours of hourSets) {
      // Every 7 minutes across 3 days, incl. after close / before open.
      for (let t = Date.parse("2026-10-01T00:00:00Z"); t < Date.parse("2026-10-04T00:00:00Z"); t += 7 * 60_000) {
        for (const d of [new Date(t), new Date(t + 30_000), new Date(t + 59_999)]) {
          expect(windowsContaining(d, hours, "2026-10-02")).toEqual([businessDateKey(d, hours)]);
        }
      }
    }
  });

  it("a sale after overnight close counts in the next business day's report", () => {
    // 04:30 PKT 6 Oct, after the 04:00 close → business day 6 Oct.
    const d = new Date("2026-10-05T23:30:00.000Z");
    expect(businessDateKey(d, overnight)).toBe("2026-10-06");
    expect(d >= startOfBusinessDay("2026-10-06", overnight)).toBe(true);
    expect(d <= endOfBusinessDay("2026-10-06", overnight)).toBe(true);
  });

  it("reads hours from settings with defaults", () => {
    expect(businessDayHoursFromSettings(null)).toEqual({
      start: "00:00",
      end: "23:59",
    });
    expect(
      businessDayHoursFromSettings({
        businessDayStart: "12:00",
        businessDayEnd: "04:00",
      }),
    ).toEqual({ start: "12:00", end: "04:00" });
  });

  it("coerces noon and 12-hour clock strings", () => {
    expect(coerceBusinessTime("12:00")).toBe("12:00");
    expect(coerceBusinessTime("12:00 PM")).toBe("12:00");
    expect(coerceBusinessTime("12:00 AM")).toBe("00:00");
    expect(coerceBusinessTime("4:00 AM")).toBe("04:00");
    expect(coerceBusinessTime(12)).toBe("12:00");
  });
});
