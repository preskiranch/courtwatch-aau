import * as cheerio from "cheerio";
import { normalizeName } from "./normalization.js";
import { PublicExposurePageClient, type PublicExposureTeamResult } from "./public-exposure-page-client.js";
import type { TournamentEvent, TournamentEventStatus } from "./types.js";
import { DEFAULT_TOURNAMENT_TIMEZONE } from "./types.js";
import { deriveTournamentStatus, tournamentDedupeKey, tournamentTodayKey, tournamentWindowEndKey } from "./tournament-eligibility.js";

export type TournamentProviderName = "exposure_events" | "aau_event_finder";

export interface MajorTournamentSource {
  name: string;
  provider: TournamentProviderName;
  enabled: boolean;
  url?: string;
  eventUrls?: string[];
  organizerName?: string;
  sanctioningTags?: string[];
  timezone?: string;
  region?: string;
}

export interface TournamentDiscoveryWindow {
  startDate: string;
  endDate: string;
  now?: Date;
}

export interface DiscoveredTournamentEvent extends TournamentEvent {
  dropdownGroup: "upcoming";
}

export interface PublicTournamentCandidate {
  event: DiscoveredTournamentEvent;
  teams: PublicExposureTeamResult;
}

export interface TournamentProviderFailure {
  provider: string;
  source: string;
  message: string;
}

export interface TournamentDiscoveryResult {
  candidates: PublicTournamentCandidate[];
  failures: TournamentProviderFailure[];
}

export interface TournamentProvider {
  providerName: TournamentProviderName;
  supportsPublicTeamLists: boolean;
  discoverEvents(source: MajorTournamentSource, window: TournamentDiscoveryWindow): Promise<DiscoveredTournamentEvent[]>;
  fetchRegisteredTeams(event: DiscoveredTournamentEvent): Promise<PublicExposureTeamResult>;
}

export const DEFAULT_MAJOR_TOURNAMENT_SOURCES: MajorTournamentSource[] = [
  {
    name: "Jam On It",
    provider: "exposure_events",
    enabled: true,
    url: "https://basketball.exposureevents.com/organizations/3461/jam-on-it",
    organizerName: "Jam On It",
    sanctioningTags: ["Jam On It", "Exposure Events"],
    timezone: DEFAULT_TOURNAMENT_TIMEZONE
  },
  {
    name: "AAU Event Finder",
    provider: "aau_event_finder",
    enabled: true,
    organizerName: "AAU",
    sanctioningTags: ["AAU"]
  }
];

export class TournamentDiscoveryService {
  private readonly providers: Map<TournamentProviderName, TournamentProvider>;

  constructor(providers: TournamentProvider[] = [new ExposureEventsTournamentProvider(), new AauEventFinderTournamentProvider()]) {
    this.providers = new Map(providers.map((provider) => [provider.providerName, provider]));
  }

  async discover(sources: MajorTournamentSource[], options: { now?: Date; windowDays?: number } = {}): Promise<TournamentDiscoveryResult> {
    const startDate = tournamentTodayKey(options.now);
    const endDate = tournamentWindowEndKey(startDate, options.windowDays);
    const candidates: PublicTournamentCandidate[] = [];
    const failures: TournamentProviderFailure[] = [];
    const seen = new Set<string>();

    for (const source of sources.filter((item) => item.enabled)) {
      const provider = this.providers.get(source.provider);
      if (!provider) {
        failures.push({ provider: source.provider, source: source.name, message: "No provider adapter is registered for this source." });
        continue;
      }

      try {
        const events = await provider.discoverEvents(source, { startDate, endDate, now: options.now });
        for (const event of events) {
          const key = tournamentDedupeKey(event);
          if (seen.has(key)) continue;
          seen.add(key);
          if (!provider.supportsPublicTeamLists) continue;

          try {
            const teams = await provider.fetchRegisteredTeams(event);
            if (teams.teams.length === 0) continue;
            candidates.push({
              event: {
                ...event,
                hasPublicTeamList: true,
                registeredTeamCount: teams.teams.length,
                lastCheckedAt: new Date().toISOString(),
                lastSyncedAt: new Date().toISOString(),
                status: deriveTournamentStatus(event, startDate)
              },
              teams
            });
          } catch (error) {
            failures.push({ provider: provider.providerName, source: event.sourceUrl, message: errorMessage(error) });
          }

          await sleep(Number(process.env.TOURNAMENT_DISCOVERY_REQUEST_DELAY_MS ?? 125));
        }
      } catch (error) {
        failures.push({ provider: provider.providerName, source: source.url ?? source.name, message: errorMessage(error) });
      }
    }

    return { candidates, failures };
  }
}

export class ExposureEventsTournamentProvider implements TournamentProvider {
  readonly providerName = "exposure_events" as const;
  readonly supportsPublicTeamLists = true;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly publicClient: PublicExposurePageClient;

  constructor(options: { baseUrl?: string; fetchImpl?: typeof fetch } = {}) {
    this.baseUrl = options.baseUrl ?? process.env.EXPOSURE_PUBLIC_BASE_URL ?? "https://basketball.exposureevents.com";
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.publicClient = new PublicExposurePageClient({ baseUrl: this.baseUrl, fetchImpl: this.fetchImpl });
  }

  async discoverEvents(source: MajorTournamentSource, window: TournamentDiscoveryWindow): Promise<DiscoveredTournamentEvent[]> {
    const eventUrls = new Set<string>();
    for (const eventUrl of source.eventUrls ?? []) {
      const normalized = normalizeExposureEventUrl(eventUrl, this.baseUrl);
      if (normalized) eventUrls.add(normalized);
    }

    if (source.url) {
      const sourceUrl = new URL(source.url, this.baseUrl).toString();
      const html = await this.fetchText(sourceUrl);
      for (const eventUrl of parseExposureEventLinks(html, this.baseUrl)) eventUrls.add(eventUrl);
      for (const eventUrl of await this.fetchDirectoryEvents(sourceUrl, html, window)) eventUrls.add(eventUrl);
    }

    const events: DiscoveredTournamentEvent[] = [];
    for (const eventUrl of eventUrls) {
      const parsed = parseExposureEventUrl(eventUrl);
      if (!parsed) continue;
      const details = await this.fetchEventDetails(eventUrl, source);
      if (details.startDate > window.endDate || details.endDate < window.startDate) continue;
      events.push(details);
      await sleep(Number(process.env.TOURNAMENT_DISCOVERY_REQUEST_DELAY_MS ?? 125));
    }
    return dedupeDiscoveredEvents(events);
  }

  async fetchRegisteredTeams(event: DiscoveredTournamentEvent): Promise<PublicExposureTeamResult> {
    return this.publicClient.fetchTeams(event.exposureEventId, event.slug, event.timezone);
  }

  private async fetchEventDetails(eventUrl: string, source: MajorTournamentSource): Promise<DiscoveredTournamentEvent> {
    const parsed = parseExposureEventUrl(eventUrl);
    if (!parsed) throw new Error(`Unsupported Exposure event URL: ${eventUrl}`);
    const html = await this.fetchText(eventUrl);
    const $ = cheerio.load(html);
    const title = cleanText($("meta[property='og:title']").attr("content") || $("title").text());
    const twitterTitle = cleanText($("meta[name='twitter:title']").attr("content") || "");
    const description = cleanText($("meta[property='og:description']").attr("content") || $("meta[name='description']").attr("content") || "");
    const dateRange = parseDateRange(`${title} ${description}`);
    if (!dateRange) throw new Error(`Could not parse event date range from ${eventUrl}`);

    const name = twitterTitle || stripTitleSuffix(title, dateRange.raw) || `Exposure Event ${parsed.eventId}`;
    const location = parseLocationFromTitle(title, dateRange.raw) || parseLocationFromDescription(description) || "";
    const { city, state } = splitCityState(location);
    const organizer = cleanText($("a[href*='/organizations/']").first().text()) || source.organizerName || source.name;
    const bodyText = cleanText($("body").text());
    const status = bodyText.match(/\bcancelled\b/i) ? "cancelled" : deriveTournamentStatus({ startDate: dateRange.startDate, endDate: dateRange.endDate, status: "upcoming" });
    const sanctioningTags = dedupeStrings([...(source.sanctioningTags ?? []), ...parseSanctioningTags(bodyText), "Exposure Events"]);

    return {
      id: `event-${parsed.eventId}`,
      exposureEventId: parsed.eventId,
      externalProvider: this.providerName,
      externalId: String(parsed.eventId),
      slug: parsed.slug,
      sourceUrl: eventUrl,
      name,
      organizer,
      sport: "basketball",
      sanctioningTags,
      gender: parseGender(bodyText),
      ageOrGradeDivisions: parseAgeOrGradeDivisions(bodyText),
      venueName: parseVenueName($),
      city,
      state,
      region: source.region ?? state,
      startDate: dateRange.startDate,
      endDate: dateRange.endDate,
      location: location || [city, state].filter(Boolean).join(", "),
      officialUrl: eventUrl,
      timezone: source.timezone ?? DEFAULT_TOURNAMENT_TIMEZONE,
      registeredTeamCount: 0,
      hasPublicTeamList: false,
      lastCheckedAt: null,
      lastSyncedAt: null,
      lastTeamChangeAt: null,
      status,
      dropdownGroup: "upcoming"
    };
  }

  private async fetchDirectoryEvents(sourceUrl: string, html: string, window: TournamentDiscoveryWindow): Promise<string[]> {
    const token = parseExposureToken(html);
    if (!token) return [];
    const response = await this.fetchImpl(sourceUrl, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "X-Exposure-Token": token,
        "X-Requested-With": "XMLHttpRequest",
        "User-Agent": publicUserAgent()
      },
      body: new URLSearchParams({
        Page: "1",
        sportType: "1",
        EventType: "Tournament",
        StartDateString: dateKeyToExposureDate(window.startDate),
        EndDateString: dateKeyToExposureDate(window.endDate)
      }).toString()
    });
    if (!response.ok) throw new Error(`Exposure directory request failed with ${response.status}`);
    const payload = (await response.json()) as { Results?: Array<Record<string, unknown>> | null };
    return (payload.Results ?? [])
      .map((item) => stringValue(item.Link ?? item.Url ?? item.URL))
      .filter((value): value is string => Boolean(value))
      .map((value) => normalizeExposureEventUrl(value, this.baseUrl))
      .filter((value): value is string => Boolean(value));
  }

  private async fetchText(url: string): Promise<string> {
    const response = await this.fetchImpl(url, {
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "User-Agent": publicUserAgent()
      }
    });
    if (!response.ok) throw new Error(`Public Exposure page request failed with ${response.status}`);
    return response.text();
  }
}

export class AauEventFinderTournamentProvider implements TournamentProvider {
  readonly providerName = "aau_event_finder" as const;
  readonly supportsPublicTeamLists = false;

  async discoverEvents(): Promise<DiscoveredTournamentEvent[]> {
    return [];
  }

  async fetchRegisteredTeams(): Promise<PublicExposureTeamResult> {
    return { divisions: [], teams: [] };
  }
}

function dedupeDiscoveredEvents(events: DiscoveredTournamentEvent[]): DiscoveredTournamentEvent[] {
  const seen = new Set<string>();
  const result: DiscoveredTournamentEvent[] = [];
  for (const event of events) {
    const key = tournamentDedupeKey(event);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(event);
  }
  return result;
}

function parseExposureEventLinks(html: string, baseUrl: string): string[] {
  const $ = cheerio.load(html);
  const urls = new Set<string>();
  $("a[href]").each((_, element) => {
    const href = $(element).attr("href");
    if (!href) return;
    const url = normalizeExposureEventUrl(href, baseUrl);
    if (url) urls.add(url);
  });
  return Array.from(urls);
}

function normalizeExposureEventUrl(value: string, baseUrl: string): string | null {
  try {
    const url = new URL(value, baseUrl);
    const parsed = parseExposureEventUrl(url.toString());
    if (!parsed) return null;
    return new URL(`/${parsed.eventId}/${parsed.slug}`, url.origin).toString();
  } catch {
    return null;
  }
}

function parseExposureEventUrl(value: string): { eventId: number; slug: string } | null {
  try {
    const url = new URL(value);
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.length < 2) return null;
    const eventId = Number(parts[0]);
    if (!Number.isInteger(eventId) || eventId <= 0) return null;
    const slug = parts[1];
    if (!slug || ["teams", "schedule", "bracket", "organizations"].includes(slug)) return null;
    return { eventId, slug };
  } catch {
    return null;
  }
}

function parseExposureToken(html: string): string | null {
  return html.match(/tokenValue:\s*'([^']+)'/)?.[1] ?? html.match(/tokenValue:\s*"([^"]+)"/)?.[1] ?? null;
}

function parseDateRange(text: string): { startDate: string; endDate: string; raw: string } | null {
  const monthPattern = "(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)";
  const match = new RegExp(`${monthPattern}\\s+(\\d{1,2})(?:\\s*-\\s*(?:${monthPattern}\\s+)?(\\d{1,2}))?,\\s*(\\d{4})`, "i").exec(text);
  if (!match) return null;
  const startMonth = monthNumber(match[1] ?? "");
  const startDay = Number(match[2]);
  const endMonth = monthNumber(match[3] ?? "") || startMonth;
  const endDay = Number(match[4] ?? startDay);
  const year = Number(match[5]);
  if (!startMonth || !startDay || !endMonth || !endDay || !year) return null;
  return {
    startDate: dateKey(year, startMonth, startDay),
    endDate: dateKey(year, endMonth, endDay),
    raw: match[0]
  };
}

function stripTitleSuffix(title: string, dateText: string): string | null {
  const index = title.indexOf(dateText);
  if (index <= 0) return null;
  return cleanText(title.slice(0, index).replace(/\s+-\s*$/, ""));
}

function parseLocationFromTitle(title: string, dateText: string): string | null {
  const index = title.indexOf(dateText);
  if (index < 0) return null;
  return cleanText(title.slice(index + dateText.length).replace(/^\s+-\s*/, ""));
}

function parseLocationFromDescription(description: string): string | null {
  return cleanText(description.match(/\bat\s+-?\s*([A-Za-z .'-]+,\s*[A-Za-z .'-]+)/)?.[1] ?? "");
}

function splitCityState(location: string): { city: string | null; state: string | null } {
  const [city, ...rest] = location.split(",").map((part) => cleanText(part));
  return { city: city || null, state: cleanText(rest.join(", ")) || null };
}

function parseVenueName($: cheerio.CheerioAPI): string | null {
  const locationHeading = $("h2, h3").filter((_, element) => cleanText($(element).text()).toLowerCase() === "location").first();
  const firstText = cleanText(locationHeading.nextAll().filter((_, element) => cleanText($(element).text()).length > 0).first().text());
  return firstText || null;
}

function parseGender(text: string): string | null {
  if (/\bBoys\s*&\s*Girls\b/i.test(text)) return "Boys & Girls";
  if (/\bBoys\b/i.test(text) && /\bGirls\b/i.test(text)) return "Boys & Girls";
  if (/\bGirls\b/i.test(text)) return "Girls";
  if (/\bBoys\b/i.test(text)) return "Boys";
  return null;
}

function parseSanctioningTags(text: string): string[] {
  const tags: string[] = [];
  if (/\bAAU Licensed\b/i.test(text)) tags.push("AAU");
  if (/\bNCAA Certified\b/i.test(text)) tags.push("NCAA Certified");
  if (/\bExposure Certified\b/i.test(text)) tags.push("Exposure Certified");
  if (/\bJam On It\b/i.test(text)) tags.push("Jam On It");
  return tags;
}

function parseAgeOrGradeDivisions(text: string): string[] {
  const values = new Set<string>();
  for (const match of text.matchAll(/\b(?:Boys|Girls)\s+(?:\d{1,2}(?:st|nd|rd|th)|Varsity)\b/gi)) values.add(cleanText(match[0]));
  return Array.from(values).slice(0, 80);
}

function dateKey(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function monthNumber(month: string): number {
  const key = month.slice(0, 3).toLowerCase();
  return ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"].indexOf(key) + 1;
}

function dateKeyToExposureDate(dateKeyValue: string): string {
  const [year, month, day] = dateKeyValue.split("-").map(Number);
  return `${month}/${day}/${year}`;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function cleanText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function dedupeStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values.map(cleanText).filter(Boolean)) {
    const key = normalizeName(value);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }
  return result;
}

function publicUserAgent(): string {
  return "CourtWatchAAU/0.1 (+independent companion tracker; public cache-backed tournament discovery)";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown provider error";
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
