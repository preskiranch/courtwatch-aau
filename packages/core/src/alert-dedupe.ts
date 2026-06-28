import { dedupeKey } from "./change-detection.js";
import type { GameChangeEvent } from "./types.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number") return String(value);
  return "";
}

function recordString(record: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = stringValue(record[key]);
    if (value) return value;
  }
  return "";
}

function normalizedValue(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function eventTimestamp(event: GameChangeEvent): number {
  const timestamp = new Date(event.createdAt).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

export function alertSemanticKey(event: GameChangeEvent): string {
  if (event.eventType === "starting_soon") {
    const next = isRecord(event.newValue) ? event.newValue : {};
    const previous = isRecord(event.previousValue) ? event.previousValue : {};
    const reminderWindow = recordString(next, ["reminderMinutes", "reminderMinute", "minutesBefore"]) || recordString(previous, ["reminderMinutes", "reminderMinute", "minutesBefore"]);
    const startsAt = recordString(next, ["startsAt", "scheduledAt"]) || recordString(previous, ["startsAt", "scheduledAt"]);
    const teams = normalizedValue(
      [
        recordString(next, ["homeTeamNameSnapshot", "homeTeamName", "home"]),
        recordString(next, ["awayTeamNameSnapshot", "awayTeamName", "away"]),
        recordString(previous, ["homeTeamNameSnapshot", "homeTeamName", "home"]),
        recordString(previous, ["awayTeamNameSnapshot", "awayTeamName", "away"])
      ]
        .filter(Boolean)
        .join("|")
    );

    return dedupeKey(["alert", event.eventType, event.gameId ?? "", reminderWindow, startsAt, teams]);
  }

  return event.dedupeKey || dedupeKey(["alert", event.eventType, event.gameId ?? "", event.affectedTeamId ?? "", event.affectedProgramWatchlistId ?? ""]);
}

export function uniqueAlertEvents(events: GameChangeEvent[]): GameChangeEvent[] {
  const byKey = new Map<string, GameChangeEvent>();

  for (const event of events) {
    const key = alertSemanticKey(event);
    const existing = byKey.get(key);
    if (!existing || eventTimestamp(event) >= eventTimestamp(existing)) {
      byKey.set(key, event);
    }
  }

  return [...byKey.values()];
}
