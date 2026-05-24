# CourtWatch AAU

CourtWatch AAU is a separate sibling app built from the CourtWatch Reno workflow. It keeps the same mobile-first PWA experience, team follow list, unified schedule, alerts, push notification hooks, admin sync, and Exposure public/API fallback, but it supports multiple AAU/Exposure tournaments through a tournament selector.

The original `courtwatch-reno` folder is not modified by this app.

## What Changed From Reno

- Adds `GET /api/events` and `?eventId=` scoping on dashboard, teams, games, alerts, results, and current-event routes.
- Supports an `EXPOSURE_EVENTS` JSON array for multiple tournaments.
- The tournament selector shows tournaments with registered team data. On a fresh empty database it falls back to configured tournaments so the first sync can be run.
- Keeps followed teams scoped by tournament view, so following a team in one event does not show it in another event dashboard.
- Prefixes public Exposure IDs with the event id to avoid cross-tournament team/game id collisions.
- Admin sync runs every configured tournament by default, or one event when `eventId` is provided.
- Keeps the Reno app UX and tabs: Dashboard, Schedule, Teams, Alerts, Settings.

## Configure Tournaments

Use `EXPOSURE_EVENTS` for production. Each object needs the Exposure event id and public slug:

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

## Checks

```bash
npm run typecheck
npm run lint
npm run test:run
npm run build
```
