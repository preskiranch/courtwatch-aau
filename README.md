# CourtWatch AAU

CourtWatch AAU is a separate sibling app built from the CourtWatch Reno workflow. It keeps the same mobile-first PWA experience, team follow list, unified schedule, alerts, push notification hooks, admin sync, and Exposure public/API fallback, but it supports multiple AAU/Exposure tournaments through a tournament selector.

The original `courtwatch-reno` folder is not modified by this app.

## What Changed From Reno

- Adds `GET /api/events` and `?eventId=` scoping on dashboard, teams, games, alerts, results, and current-event routes.
- Supports an `EXPOSURE_EVENTS` JSON array for multiple tournaments.
- The tournament selector shows only tournaments with public registered team data and at least one registered team.
- Adds provider-based public discovery for upcoming major youth basketball tournaments, starting with Exposure/Jam On It-style sources.
- Keeps followed teams scoped by tournament view, so following a team in one event does not show it in another event dashboard.
- Prefixes public Exposure IDs with the event id to avoid cross-tournament team/game id collisions.
- Admin sync runs every configured tournament by default, or one event when `eventId` is provided.
- Keeps the Reno app UX and tabs: Dashboard, Schedule, Teams, Alerts, Settings.

## Configure Tournaments

Use `EXPOSURE_EVENTS` for manually tracked production events. Each object needs the Exposure event id and public slug:

```bash
EXPOSURE_EVENTS='[
  {
    "exposureEventId": 255539,
    "slug": "2026-reno-memorial-day-tournament",
    "name": "2026 Reno Memorial Day Tournament",
    "organizer": "Jam On It",
    "startDate": "2026-05-23",
    "endDate": "2026-05-25",
    "location": "Reno, Nevada",
    "timezone": "America/Los_Angeles"
  }
]'
DEFAULT_EXPOSURE_EVENT_ID=255539
```

If `EXPOSURE_EVENTS` is empty, the app falls back to legacy `EXPOSURE_EVENT_ID` and `EXPOSURE_EVENT_SLUG`.

## Public Discovery

The worker calls `POST /api/admin/discover-tournaments` at least daily. Discovery looks from today through today plus 90 days and saves dropdown-eligible tournaments when:

- the source is public and does not require login, payment, CAPTCHA bypass, private API access, or organizer-only permission
- the event is basketball from an enabled AAU/major tournament source
- the event is upcoming or active, not completed/cancelled/unavailable
- the provider exposes a public registered-team list
- the registered-team endpoint/page can be fetched publicly; if teams are not posted yet, the dropdown shows `teams not posted yet`

Default sources are configured in `MAJOR_TOURNAMENT_SOURCES`. The built-in providers are:

- `exposure_events`: public Exposure Basketball organization pages and event URLs. Defaults include Jam On It, Grassroots 365, and Zero Gravity public sources.
- `public_html`: non-Exposure public event pages. This is intentionally configuration-driven and only publishes an event after a reachable public team-list page is found.
- `aau_event_finder`: conservative discovery placeholder. AAU listings are not shown unless public registered-team data can be fetched.

```bash
MAJOR_TOURNAMENT_SOURCES='[
  {
    "name": "Jam On It",
    "provider": "exposure_events",
    "enabled": true,
    "url": "https://basketball.exposureevents.com/organizations/3461/jam-on-it",
    "eventUrls": [
      "https://basketball.exposureevents.com/256931/2026-the-battleground",
      "https://basketball.exposureevents.com/255723/2026-las-vegas-showtime",
      "https://basketball.exposureevents.com/255725/2026-grand-finale"
    ],
    "organizerName": "Jam On It",
    "sanctioningTags": ["Jam On It", "Exposure Events"],
    "timezone": "America/Los_Angeles"
  },
  {
    "name": "Grassroots 365",
    "provider": "exposure_events",
    "enabled": true,
    "url": "https://basketball.exposureevents.com/organizations/21530/grassroots-365",
    "eventUrls": [
      "https://basketball.exposureevents.com/252014/g365-memorial-day-challenge",
      "https://basketball.exposureevents.com/252017/g365-kings-of-the-south",
      "https://basketball.exposureevents.com/252018/g365-sactown-swish"
    ],
    "organizerName": "Grassroots 365",
    "sanctioningTags": ["Grassroots 365", "Exposure Events"],
    "timezone": "America/Los_Angeles"
  },
  {
    "name": "Zero Gravity Basketball",
    "provider": "exposure_events",
    "enabled": true,
    "url": "https://basketball.exposureevents.com/organizations/18316/zero-gravity-basketball",
    "organizerName": "Zero Gravity Basketball",
    "sanctioningTags": ["Zero Gravity", "Exposure Events"],
    "timezone": "America/Los_Angeles"
  },
  {
    "name": "Configured Public HTML Sources",
    "provider": "public_html",
    "enabled": true,
    "eventUrls": [],
    "eventLinkPatterns": ["tournament|event"],
    "teamListLinkPatterns": ["registered\\\\s+teams?|participating\\\\s+teams?|teams?"],
    "teamSelectors": ["[data-team-name]"],
    "organizerName": "Public Tournament Source",
    "sanctioningTags": ["Public Source"],
    "timezone": "America/Los_Angeles"
  },
  {
    "name": "AAU Event Finder",
    "provider": "aau_event_finder",
    "enabled": true,
    "organizerName": "AAU",
    "sanctioningTags": ["AAU"]
  }
]'
```

The AAU adapter is intentionally conservative: AAU listings are not shown in the normal dropdown unless a provider can fetch a public registered-team endpoint or page. Exposure listings can also be disabled by the platform; when that happens the app logs the provider result and keeps using recent valid cached tournament data. Add known public Exposure tournament URLs to `eventUrls` when an organizer page does not list events publicly.

For non-Exposure sources, use `public_html` with either `eventUrls` or a public index `url` plus `eventLinkPatterns`. The provider checks `robots.txt` by default and refuses blocked paths. It will not publish events that require login, CAPTCHA, payment, private APIs, or hidden team data.

## Local Setup

```bash
npm ci
cp .env.example .env
npm run db:generate
npm run typecheck
npm run test:run
npm run build
```

Without `DATABASE_URL`, the API runs from built-in mock data with two tournaments so the selector can be tested locally.

Run locally:

```bash
npm run dev:api
npm run dev
```

Open `http://localhost:3000`.

## API Routes

- `GET /api/events`
- `GET /api/events/current?eventId=255539`
- `GET /api/dashboard?eventId=255539`
- `GET /api/teams?eventId=255539&search=Splash`
- `POST /api/teams/:teamId/follow`
- `DELETE /api/teams/:teamId/follow`
- `GET /api/games?eventId=255539`
- `GET /api/results?eventId=255539&scope=watched`
- `GET /api/alerts?eventId=255539`
- `POST /api/admin/sync-now` syncs all configured tournaments
- `POST /api/admin/sync-now?eventId=255539` syncs one tournament
- `POST /api/admin/discover-tournaments` runs public tournament discovery for the dropdown

## Checks

```bash
npm run typecheck
npm run lint
npm run test:run
npm run build
```
