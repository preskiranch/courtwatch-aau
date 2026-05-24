import { afterEach, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { normalizeName, seedGames, seedSnapshot } from "@courtwatch/core";
import type { Game, Team, TournamentEvent } from "@courtwatch/core";
import { createApp } from "./app.js";
import { MockStore } from "./store.js";

describe("CourtWatch API", () => {
  beforeEach(() => {
    process.env.COURTWATCH_TODAY = "2026-05-24";
  });

  afterEach(() => {
    delete process.env.COURTWATCH_TODAY;
  });

  it("returns a dashboard response", async () => {
    const app = createApp(new MockStore(), null);
    const response = await request(app).get("/api/dashboard").expect(200);
    expect(response.body.event.exposureEventId).toBe(255539);
    expect(response.body.events.map((event: { exposureEventId: number }) => event.exposureEventId)).toContain(900001);
    expect(response.body.programs).toHaveLength(1);
    expect(response.body.programs[0].teams).toHaveLength(0);
  });

  it("scopes teams and followed dashboard state by selected tournament", async () => {
    const app = createApp(new MockStore(), null);
    const events = await request(app).get("/api/events").expect(200);
    expect(events.body.map((event: { exposureEventId: number }) => event.exposureEventId)).toEqual([255539, 900001]);

    const sampleTeams = await request(app).get("/api/teams?eventId=900001").set("x-courtwatch-client-id", "client-multi-123").expect(200);
    expect(sampleTeams.body.map((team: { id: string }) => team.id)).toContain("team-sample-comets-5");
    expect(sampleTeams.body.map((team: { id: string }) => team.id)).not.toContain("team-splash-4th");

    await request(app).post("/api/teams/team-sample-comets-5/follow").set("x-courtwatch-client-id", "client-multi-123").expect(201);
    const sampleDashboard = await request(app).get("/api/dashboard?eventId=900001").set("x-courtwatch-client-id", "client-multi-123").expect(200);
    expect(sampleDashboard.body.event.exposureEventId).toBe(900001);
    expect(sampleDashboard.body.programs[0].teams.map((team: { id: string }) => team.id)).toEqual(["team-sample-comets-5"]);

    const renoDashboard = await request(app).get("/api/dashboard?eventId=255539").set("x-courtwatch-client-id", "client-multi-123").expect(200);
    expect(renoDashboard.body.programs[0].teams).toHaveLength(0);
  });

  it("hides unsynced tournaments without recent public team-list data from the selector", async () => {
    const snapshot = structuredClone(seedSnapshot);
    snapshot.events.push({
      ...seedSnapshot.event,
      id: "event-empty-aau-2026",
      exposureEventId: 910000,
      externalId: "910000",
      slug: "empty-aau-classic",
      name: "Empty AAU Classic",
      sourceUrl: "https://basketball.exposureevents.com/910000/empty-aau-classic",
      officialUrl: "https://basketball.exposureevents.com/910000/empty-aau-classic",
      registeredTeamCount: 0,
      hasPublicTeamList: true,
      lastCheckedAt: null,
      lastSyncedAt: null
    });
    const app = createApp(new MockStore(snapshot), null);
    const events = await request(app).get("/api/events").expect(200);
    expect(events.body.map((event: { exposureEventId: number }) => event.exposureEventId)).toEqual([255539, 900001]);
  });

  it("returns public-source dropdown tournaments up to 90 days out even before teams post", async () => {
    const eligible = eventFixture(910001, {
      name: "Jam On It Memorial Day Classic",
      organizer: "Jam On It",
      city: "Reno",
      state: "Nevada",
      startDate: "2026-05-25",
      endDate: "2026-05-27",
      hasPublicTeamList: true,
      status: "upcoming"
    });
    const duplicate = eventFixture(910001, {
      id: "event-duplicate-jam-on-it",
      name: "Jam On It Memorial Day Classic Duplicate",
      startDate: "2026-05-25",
      hasPublicTeamList: true
    });
    const within90Days = eventFixture(910002, { name: "Within 90 Days Classic", startDate: "2026-07-01", endDate: "2026-07-02", hasPublicTeamList: true });
    const tooFarAway = eventFixture(910008, { name: "Too Far Classic", startDate: "2026-08-25", endDate: "2026-08-26", hasPublicTeamList: true });
    const noPublicTeams = eventFixture(910003, { name: "AAU Event Finder Listing", externalProvider: "aau_event_finder", hasPublicTeamList: false });
    const zeroTeams = eventFixture(910004, { name: "Zero Team Classic", hasPublicTeamList: true });
    const completed = eventFixture(910005, { name: "Completed Classic", startDate: "2026-05-20", endDate: "2026-05-21", hasPublicTeamList: true, status: "completed" });
    const cancelled = eventFixture(910006, { name: "Cancelled Classic", hasPublicTeamList: true, status: "cancelled" });
    const unavailable = eventFixture(910007, { name: "Unavailable Classic", hasPublicTeamList: true, status: "unavailable" });
    const snapshot = {
      ...structuredClone(seedSnapshot),
      event: eligible,
      events: [eligible, duplicate, within90Days, tooFarAway, noPublicTeams, zeroTeams, completed, cancelled, unavailable],
      teams: [teamFixture(eligible), teamFixture(duplicate), teamFixture(within90Days), teamFixture(tooFarAway), teamFixture(noPublicTeams), teamFixture(completed), teamFixture(cancelled), teamFixture(unavailable)]
    };
    const app = createApp(new MockStore(snapshot), null);
    const events = await request(app).get("/api/events").expect(200);

    expect(events.body.map((event: { name: string }) => event.name)).toEqual(["Jam On It Memorial Day Classic", "Zero Team Classic", "Within 90 Days Classic"]);
    expect(events.body[0]).toMatchObject({
      name: "Jam On It Memorial Day Classic",
      registeredTeamCount: 1,
      hasPublicTeamList: true
    });
    expect(events.body[1]).toMatchObject({
      name: "Zero Team Classic",
      registeredTeamCount: 0,
      hasPublicTeamList: true
    });
  });

  it("returns an empty dropdown list when no upcoming public team-list tournaments are eligible", async () => {
    const privateEvent = eventFixture(920001, { name: "Private Team List Classic", hasPublicTeamList: false });
    const snapshot = {
      ...structuredClone(seedSnapshot),
      event: privateEvent,
      events: [privateEvent],
      teams: [teamFixture(privateEvent)]
    };
    const app = createApp(new MockStore(snapshot), null);
    const events = await request(app).get("/api/events").expect(200);
    expect(events.body).toEqual([]);
  });

  it("lets a user follow and unfollow a selected team", async () => {
    const app = createApp(new MockStore(), null);
    await request(app).post("/api/teams/team-splash-4th/follow").expect(201);
    const followed = await request(app).get("/api/dashboard").expect(200);
    expect(followed.body.programs[0].teams.map((team: { id: string }) => team.id)).toContain("team-splash-4th");
    await request(app).delete("/api/teams/team-splash-4th/follow").expect(204);
    const unfollowed = await request(app).get("/api/dashboard").expect(200);
    expect(unfollowed.body.programs[0].teams).toHaveLength(0);
  });

  it("keeps followed teams separate by browser client id", async () => {
    const app = createApp(new MockStore(), null);

    await request(app).post("/api/teams/team-splash-4th/follow").set("x-courtwatch-client-id", "client-alpha-123").expect(201);

    const alpha = await request(app).get("/api/dashboard").set("x-courtwatch-client-id", "client-alpha-123").expect(200);
    const beta = await request(app).get("/api/dashboard").set("x-courtwatch-client-id", "client-beta-456").expect(200);

    expect(alpha.body.programs[0].teams.map((team: { id: string }) => team.id)).toEqual(["team-splash-4th"]);
    expect(beta.body.programs[0].teams).toHaveLength(0);

    await request(app).post("/api/teams/team-splash-6th/follow").set("x-courtwatch-client-id", "client-beta-456").expect(201);

    const alphaAfterBetaFollow = await request(app).get("/api/dashboard").set("x-courtwatch-client-id", "client-alpha-123").expect(200);
    expect(alphaAfterBetaFollow.body.programs[0].teams.map((team: { id: string }) => team.id)).toEqual(["team-splash-4th"]);
  });

  it("returns anonymous follower counts for teams that are already followed", async () => {
    const app = createApp(new MockStore(), null);

    await request(app).post("/api/teams/team-splash-4th/follow").set("x-courtwatch-client-id", "client-alpha-123").expect(201);
    await request(app).post("/api/teams/team-splash-4th/follow").set("x-courtwatch-client-id", "client-beta-456").expect(201);

    const teams = await request(app).get("/api/teams?search=Splash").set("x-courtwatch-client-id", "client-alpha-123").expect(200);
    const splash4 = teams.body.find((team: { id: string }) => team.id === "team-splash-4th");
    expect(splash4.followerCount).toBe(2);
    expect(splash4.isFollowed).toBe(true);

    const dashboard = await request(app).get("/api/dashboard").set("x-courtwatch-client-id", "client-alpha-123").expect(200);
    expect(dashboard.body.programs[0].teams[0].followerCount).toBe(2);
  });

  it("searches registered teams without using player names", async () => {
    const snapshot = structuredClone(seedSnapshot);
    snapshot.players = [
      {
        id: "player-test-1",
        eventId: snapshot.event.id,
        teamId: "team-splash-4th",
        exposurePlayerId: "test-1",
        firstName: "Jordan",
        lastName: "Sample",
        fullName: "Jordan Sample",
        normalizedName: normalizeName("Jordan Sample"),
        jerseyNumber: "12",
        position: "G",
        grade: "4th",
        rawJson: {},
        lastSeenAt: new Date().toISOString()
      }
    ];
    const app = createApp(new MockStore(snapshot), null);
    const response = await request(app).get("/api/teams?search=Jordan").expect(200);
    expect(response.body).toHaveLength(0);
  });

  it("sorts registered teams alphabetically while keeping duplicate team names together", async () => {
    const snapshot = structuredClone(seedSnapshot);
    const ids = ["team-splash-6th", "team-premier-10u", "team-splash-4th", "team-norcal-6", "team-splash-3rd", "team-arsenal-boys-8"];
    snapshot.teams = ids.map((id) => {
      const team = seedSnapshot.teams.find((item) => item.id === id);
      if (!team) throw new Error(`Missing seed team ${id}`);
      return team;
    });
    const app = createApp(new MockStore(snapshot), null);
    const response = await request(app).get("/api/teams").expect(200);
    expect(response.body.map((team: { id: string }) => team.id)).toEqual([
      "team-norcal-6",
      "team-premier-10u",
      "team-splash-3rd",
      "team-splash-4th",
      "team-splash-6th",
      "team-arsenal-boys-8"
    ]);
  });

  it("returns final results without changing saved followed teams", async () => {
    const snapshot = structuredClone(seedSnapshot);
    snapshot.games = [
      {
        ...seedGames[0]!,
        id: "game-gold-final",
        exposureGameId: "game-gold-final",
        divisionId: "division-boys-4th-green",
        gameType: "Gold Championship",
        homeTeamId: "team-splash-4th",
        awayTeamId: "team-premier-10u",
        homeTeamNameSnapshot: "Splash City",
        awayTeamNameSnapshot: "Premier 10U Gold",
        homeScore: 42,
        awayScore: 38,
        status: "final",
        rawJson: { BracketUrl: "https://basketball.exposureevents.com/255539/2026-reno-memorial-day-tournament/bracket/test" }
      } satisfies Game
    ];
    const app = createApp(new MockStore(snapshot), null);

    await request(app).post("/api/teams/team-splash-4th/follow").set("x-courtwatch-client-id", "client-results-123").expect(201);
    const results = await request(app).get("/api/results").set("x-courtwatch-client-id", "client-results-123").expect(200);
    expect(results.body[0].rows.map((result: { placement: number; medalLabel: string; teamId: string }) => [result.placement, result.medalLabel, result.teamId])).toEqual([
      [1, "Gold", "team-splash-4th"],
      [2, "Silver", "team-premier-10u"]
    ]);

    const dashboard = await request(app).get("/api/dashboard").set("x-courtwatch-client-id", "client-results-123").expect(200);
    expect(dashboard.body.programs[0].teams.map((team: { id: string }) => team.id)).toEqual(["team-splash-4th"]);
  });

  it("tracks active online users with a heartbeat", async () => {
    const app = createApp(new MockStore(), null);
    const response = await request(app).post("/api/presence/heartbeat").send({ clientId: "test-client-1", page: "dashboard" }).expect(200);
    expect(response.body.activeUsers).toBeGreaterThanOrEqual(1);
    expect(response.body.pages.dashboard).toBeGreaterThanOrEqual(1);
  });

  it("protects admin sync with ADMIN_SECRET when configured", async () => {
    process.env.ADMIN_SECRET = "test-secret";
    const app = createApp(new MockStore(), null);
    await request(app).post("/api/admin/sync-now").expect(401);
    await request(app).post("/api/admin/sync-now").set("x-admin-secret", "test-secret").expect(200);
    delete process.env.ADMIN_SECRET;
  });
});

function eventFixture(exposureEventId: number, overrides: Partial<TournamentEvent> = {}): TournamentEvent {
  const slug = overrides.slug ?? `event-${exposureEventId}`;
  return {
    ...seedSnapshot.event,
    id: overrides.id ?? `event-${exposureEventId}`,
    exposureEventId,
    externalProvider: overrides.externalProvider ?? "exposure_events",
    externalId: overrides.externalId ?? String(exposureEventId),
    slug,
    sourceUrl: overrides.sourceUrl ?? `https://basketball.exposureevents.com/${exposureEventId}/${slug}`,
    name: overrides.name ?? `Event ${exposureEventId}`,
    startDate: overrides.startDate ?? "2026-05-25",
    endDate: overrides.endDate ?? "2026-05-26",
    officialUrl: overrides.officialUrl ?? `https://basketball.exposureevents.com/${exposureEventId}/${slug}`,
    registeredTeamCount: overrides.registeredTeamCount ?? 0,
    hasPublicTeamList: overrides.hasPublicTeamList ?? true,
    lastCheckedAt: overrides.lastCheckedAt ?? "2026-05-24T12:00:00.000Z",
    lastSyncedAt: overrides.lastSyncedAt ?? "2026-05-24T12:00:00.000Z",
    lastTeamChangeAt: overrides.lastTeamChangeAt ?? "2026-05-24T12:00:00.000Z",
    status: overrides.status ?? "upcoming",
    ...overrides
  };
}

function teamFixture(event: TournamentEvent): Team {
  const baseTeam = seedSnapshot.teams[0]!;
  return {
    ...baseTeam,
    id: `team-${event.exposureEventId}-${baseTeam.exposureTeamId}`,
    eventId: event.id,
    exposureTeamId: `${event.exposureEventId}-${baseTeam.exposureTeamId}`,
    sourceUrl: event.officialUrl
  };
}
