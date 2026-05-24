import { z } from "zod";
import type { TournamentEvent } from "@courtwatch/core";
import { DEFAULT_TOURNAMENT_TIMEZONE } from "@courtwatch/core";

const ConfigSchema = z.object({
  NODE_ENV: z.string().default("development"),
  PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string().optional(),
  WEB_BASE_URL: z.string().default("http://localhost:3000"),
  API_BASE_URL: z.string().default("http://localhost:4000"),
  EXPOSURE_API_KEY: z.string().optional(),
  EXPOSURE_SECRET_KEY: z.string().optional(),
  EXPOSURE_EVENT_ID: z.coerce.number().default(255539),
  EXPOSURE_EVENT_SLUG: z.string().default("2026-reno-memorial-day-tournament"),
  EXPOSURE_EVENTS: z.string().optional(),
  DEFAULT_EXPOSURE_EVENT_ID: z.coerce.number().optional(),
  VAPID_PUBLIC_KEY: z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),
  PUSH_CONTACT_EMAIL: z.string().default("mailto:admin@example.com"),
  JWT_SECRET: z.string().optional(),
  ADMIN_SECRET: z.string().optional()
});

export const config = ConfigSchema.parse(process.env);

export function isDatabaseConfigured(): boolean {
  return Boolean(config.DATABASE_URL?.startsWith("postgresql://") || config.DATABASE_URL?.startsWith("postgres://"));
}

export function isExposureConfigured(): boolean {
  return Boolean(config.EXPOSURE_API_KEY && config.EXPOSURE_SECRET_KEY);
}

export interface TournamentSource extends TournamentEvent {}

const fallbackTournament: TournamentSource = {
  id: "event-reno-2026",
  exposureEventId: 255539,
  slug: "2026-reno-memorial-day-tournament",
  name: "2026 Reno Memorial Day Tournament",
  organizer: "Jam On It",
  startDate: "2026-05-23",
  endDate: "2026-05-25",
  location: "Reno, Nevada",
  officialUrl: "https://basketball.exposureevents.com/255539/2026-reno-memorial-day-tournament",
  timezone: DEFAULT_TOURNAMENT_TIMEZONE,
  lastSyncedAt: null
};

const TournamentSourceSchema = z
  .object({
    id: z.string().optional(),
    exposureEventId: z.coerce.number(),
    slug: z.string().trim().min(1),
    name: z.string().trim().min(1),
    organizer: z.string().trim().default("AAU Tournament"),
    startDate: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/),
    endDate: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/),
    location: z.string().trim().default("Location TBD"),
    officialUrl: z.string().trim().url().optional(),
    timezone: z.string().trim().default(DEFAULT_TOURNAMENT_TIMEZONE)
  })
  .transform((value): TournamentSource => {
    const id = value.id ?? `event-${value.exposureEventId}`;
    return {
      id,
      exposureEventId: value.exposureEventId,
      slug: value.slug,
      name: value.name,
      organizer: value.organizer,
      startDate: value.startDate,
      endDate: value.endDate,
      location: value.location,
      officialUrl: value.officialUrl ?? `https://basketball.exposureevents.com/${value.exposureEventId}/${value.slug}`,
      timezone: value.timezone,
      lastSyncedAt: null
    };
  });

export function configuredTournaments(): TournamentSource[] {
  const parsed = parseExposureEventsEnv(config.EXPOSURE_EVENTS);
  if (parsed.length > 0) return dedupeTournaments(parsed);

  if (config.EXPOSURE_EVENT_ID !== fallbackTournament.exposureEventId || config.EXPOSURE_EVENT_SLUG !== fallbackTournament.slug) {
    return [
      {
        ...fallbackTournament,
        id: `event-${config.EXPOSURE_EVENT_ID}`,
        exposureEventId: config.EXPOSURE_EVENT_ID,
        slug: config.EXPOSURE_EVENT_SLUG,
        name: "Configured AAU Tournament",
        organizer: "AAU Tournament",
        officialUrl: `https://basketball.exposureevents.com/${config.EXPOSURE_EVENT_ID}/${config.EXPOSURE_EVENT_SLUG}`
      }
    ];
  }

  return [fallbackTournament];
}

export function defaultTournament(): TournamentSource {
  const tournaments = configuredTournaments();
  const configuredDefault = config.DEFAULT_EXPOSURE_EVENT_ID;
  return tournaments.find((event) => event.exposureEventId === configuredDefault) ?? tournaments[0] ?? fallbackTournament;
}

export function tournamentForExposureEventId(exposureEventId?: number | null): TournamentSource {
  const tournaments = configuredTournaments();
  if (!exposureEventId) return defaultTournament();
  return tournaments.find((event) => event.exposureEventId === exposureEventId) ?? {
    ...fallbackTournament,
    id: `event-${exposureEventId}`,
    exposureEventId,
    slug: String(exposureEventId),
    name: `Exposure Event ${exposureEventId}`,
    organizer: "AAU Tournament",
    officialUrl: `https://basketball.exposureevents.com/${exposureEventId}`,
    startDate: fallbackTournament.startDate,
    endDate: fallbackTournament.endDate,
    location: "Location TBD"
  };
}

function parseExposureEventsEnv(raw: string | undefined): TournamentSource[] {
  if (!raw?.trim()) return [];
  try {
    const value = JSON.parse(raw) as unknown;
    const arrayValue = Array.isArray(value) ? value : [value];
    return arrayValue.map((item) => TournamentSourceSchema.parse(item));
  } catch (error) {
    throw new Error(`EXPOSURE_EVENTS must be valid JSON: ${error instanceof Error ? error.message : "unknown parse error"}`);
  }
}

function dedupeTournaments(tournaments: TournamentSource[]): TournamentSource[] {
  const byExposureId = new Map<number, TournamentSource>();
  for (const tournament of tournaments) byExposureId.set(tournament.exposureEventId, tournament);
  return Array.from(byExposureId.values());
}
