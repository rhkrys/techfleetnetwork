import { describe, expect, it } from "vitest";
import { groupConversationsByDate } from "./history";

const now = new Date("2026-08-18T12:00:00");
const at = (iso: string) => ({ id: iso, title: iso, updated_at: iso });

describe("groupConversationsByDate", () => {
  it("buckets by recency and omits empty buckets", () => {
    const groups = groupConversationsByDate(
      [
        at("2026-08-18T09:00:00"), // today
        at("2026-08-17T23:00:00"), // yesterday
        at("2026-08-14T10:00:00"), // previous 7 days
        at("2026-07-30T10:00:00"), // previous 30 days
        at("2026-01-01T10:00:00"), // older
      ],
      now
    );
    expect(groups.map((g) => g.label)).toEqual([
      "Today",
      "Yesterday",
      "Previous 7 Days",
      "Previous 30 Days",
      "Older",
    ]);
    expect(groups.every((g) => g.items.length === 1)).toBe(true);
  });

  it("preserves caller ordering within a bucket", () => {
    const a = at("2026-08-18T11:00:00");
    const b = at("2026-08-18T08:00:00");
    const [today] = groupConversationsByDate([a, b], now);
    expect(today.items.map((i) => i.id)).toEqual([a.id, b.id]);
  });

  it("drops nothing: unparseable dates land in Older", () => {
    const groups = groupConversationsByDate(
      [{ id: "x", title: "x", updated_at: "not-a-date" }],
      now
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].label).toBe("Older");
  });

  it("returns [] for no conversations", () => {
    expect(groupConversationsByDate([], now)).toEqual([]);
  });
});
