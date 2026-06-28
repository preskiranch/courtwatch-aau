import { describe, expect, it } from "vitest";
import { uniqueAlertEvents } from "./alert-dedupe.js";
import { formatNotification, notificationHash } from "./notification.js";
import { seedChangeEvents } from "./seed-data.js";
import type { GameChangeEvent } from "./types.js";

describe("notification deduplication", () => {
  it("uses stable hashes for the same event/user/channel", () => {
    const first = notificationHash(seedChangeEvents[0]!, "user-1", "web_push");
    const second = notificationHash(seedChangeEvents[0]!, "user-1", "web_push");
    expect(first).toBe(second);
  });

  it("separates channels and users", () => {
    expect(notificationHash(seedChangeEvents[0]!, "user-1", "web_push")).not.toBe(notificationHash(seedChangeEvents[0]!, "user-2", "web_push"));
    expect(notificationHash(seedChangeEvents[0]!, "user-1", "web_push")).not.toBe(notificationHash(seedChangeEvents[0]!, "user-1", "expo"));
  });

  it("formats final placement alerts clearly", () => {
    const event: GameChangeEvent = {
      id: "result-alert-1",
      gameId: null,
      affectedTeamId: "team-1",
      affectedProgramWatchlistId: null,
      eventType: "final_placement",
      previousValue: null,
      newValue: {
        teamName: "NBC Bulls",
        divisionName: "13u Division 2",
        placementLabel: "Champion / 1st / Gold",
      },
      createdAt: "2026-06-07T01:00:00.000Z",
      notificationSent: false,
      dedupeKey: "final-placement:event:division:1:team-1",
    };

    expect(formatNotification(event, null, null)).toEqual({
      title: "Final result: NBC Bulls",
      body: "NBC Bulls posted Champion / 1st / Gold in 13u Division 2.",
    });
  });

  it("collapses duplicate starting-soon alerts for the same game", () => {
    const first: GameChangeEvent = {
      id: "start-soon-1",
      gameId: "game-splash-10u",
      affectedTeamId: null,
      affectedProgramWatchlistId: null,
      eventType: "starting_soon",
      previousValue: null,
      newValue: {
        startsAt: "2026-06-28T01:50:00.000Z",
        reminderMinutes: 60,
        homeTeamNameSnapshot: "Broadstone Ballers Blue",
        awayTeamNameSnapshot: "Splash City 10U"
      },
      createdAt: "2026-06-28T00:52:00.000Z",
      notificationSent: false,
      dedupeKey: "old-starting-soon-a"
    };
    const duplicate: GameChangeEvent = {
      ...first,
      id: "start-soon-2",
      createdAt: "2026-06-28T00:52:05.000Z",
      dedupeKey: "old-starting-soon-b"
    };

    const alerts = uniqueAlertEvents([first, duplicate]);

    expect(alerts).toHaveLength(1);
    expect(alerts[0]?.id).toBe("start-soon-2");
    expect(notificationHash(first, "user-1", "web_push")).toBe(notificationHash(duplicate, "user-1", "web_push"));
  });
});
