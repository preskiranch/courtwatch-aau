import { describe, expect, it, vi } from "vitest";
import { ExposureEventsTournamentProvider, TournamentDiscoveryService, type TournamentProvider } from "./tournament-discovery.js";

function htmlResponse(value: string) {
  return new Response(value, { status: 200, headers: { "Content-Type": "text/html" } });
}

function jsonResponse(value: unknown) {
  return new Response(JSON.stringify(value), { status: 200, headers: { "Content-Type": "application/json" } });
}

describe("TournamentDiscoveryService", () => {
  it("includes Exposure/Jam On It-style public tournaments only when registered teams are public", async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === "POST") {
        return jsonResponse({
          Results: [
            { Link: "/910001/jam-on-it-memorial-day-classic" },
            { Link: "/910002/jam-on-it-no-team-list" },
            { Link: "/910001/jam-on-it-memorial-day-classic" }
          ]
        });
      }
      if (url.endsWith("/organizations/3461/jam-on-it")) {
        return htmlResponse(`
          <script>
            app.viewModel.events.init({ tokenName: 'X-Exposure-Token', tokenValue: 'public-token' });
          </script>
        `);
      }
      if (url.endsWith("/910001/jam-on-it-memorial-day-classic/search?eventid=910001&eventname=jam-on-it-memorial-day-classic")) {
        return jsonResponse({
          Teams: [{ Division: "Boys 8th Level 1", DivisionId: 1, Slug: "reno-hype", Value: 1001, Name: "Reno Hype (Boys 8th Level 1)" }]
        });
      }
      if (url.endsWith("/910002/jam-on-it-no-team-list/search?eventid=910002&eventname=jam-on-it-no-team-list")) {
        return jsonResponse({ Teams: [] });
      }
      if (url.endsWith("/910002/jam-on-it-no-team-list/teams")) {
        return htmlResponse("<html><body><div id=\"content\"></div></body></html>");
      }
      if (url.endsWith("/910001/jam-on-it-memorial-day-classic")) {
        return htmlResponse(`
          <html>
            <head>
              <title>Jam On It Memorial Day Classic - May 25-27, 2026 - Reno, NV</title>
              <meta name="twitter:title" content="Jam On It Memorial Day Classic" />
            </head>
            <body><a href="/organizations/3461/jam-on-it">Jam On It</a> Exposure Certified AAU Licensed Boys & Girls</body>
          </html>
        `);
      }
      if (url.endsWith("/910002/jam-on-it-no-team-list")) {
        return htmlResponse(`
          <html>
            <head>
              <title>Jam On It No Team List - May 26-27, 2026 - Reno, NV</title>
              <meta name="twitter:title" content="Jam On It No Team List" />
            </head>
            <body><a href="/organizations/3461/jam-on-it">Jam On It</a></body>
          </html>
        `);
      }
      throw new Error(`Unhandled URL ${url}`);
    }) as unknown as typeof fetch;

    const provider = new ExposureEventsTournamentProvider({ baseUrl: "https://basketball.exposureevents.com", fetchImpl });
    const result = await new TournamentDiscoveryService([provider]).discover(
      [
        {
          name: "Jam On It",
          provider: "exposure_events",
          enabled: true,
          url: "https://basketball.exposureevents.com/organizations/3461/jam-on-it",
          organizerName: "Jam On It"
        }
      ],
      { now: new Date("2026-05-24T12:00:00.000Z") }
    );

    expect(result.failures).toEqual([]);
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]?.event).toMatchObject({
      name: "Jam On It Memorial Day Classic",
      exposureEventId: 910001,
      city: "Reno",
      state: "NV",
      registeredTeamCount: 1,
      hasPublicTeamList: true
    });
    expect(result.candidates[0]?.teams.teams[0]?.name).toBe("Reno Hype");
  });

  it("does not crash dropdown discovery when a provider fails", async () => {
    const failingProvider: TournamentProvider = {
      providerName: "exposure_events",
      supportsPublicTeamLists: true,
      discoverEvents: async () => {
        throw new Error("source unavailable");
      },
      fetchRegisteredTeams: async () => ({ divisions: [], teams: [] })
    };

    const result = await new TournamentDiscoveryService([failingProvider]).discover([{ name: "Broken Source", provider: "exposure_events", enabled: true }], {
      now: new Date("2026-05-24T12:00:00.000Z")
    });

    expect(result.candidates).toEqual([]);
    expect(result.failures).toEqual([{ provider: "exposure_events", source: "Broken Source", message: "source unavailable" }]);
  });
});
