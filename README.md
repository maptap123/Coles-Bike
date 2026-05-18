# Ride Across America Tracker

A Vercel-ready tracker site for sharing bike trip progress with friends and family.

## How Updates Work

The website checks for new progress every 10 minutes. On Vercel, it reads the latest saved progress from Vercel Blob storage. If Blob is not configured yet, it falls back to `data/progress.json`.

Samsung SmartTags are useful for private bag tracking, but they do not expose a simple public website feed. The reliable setup is to send location from your phone with Android automation, a GPS tracker, or another location feed.

## Vercel Setup

Create a Vercel Blob store for the project, then add these environment variables:

- `BLOB_READ_WRITE_TOKEN`: created by Vercel Blob
- `TRACKER_UPDATE_SECRET`: a long random password for location updates
- `CRON_SECRET`: a long random password for the scheduled refresh endpoint
- `LOCATION_SOURCE`: set to `smartthings` to pull from SmartThings every 10 minutes
- `SMARTTHINGS_TOKEN`: your SmartThings API token
- `SMARTTHINGS_DEVICE_ID`: the SmartTag or device ID to read
- `SMARTTHINGS_PLACE_LABEL`: optional public label, such as `Latest bag location`
- `LOCATION_FEED_URL`: optional JSON feed for the 10-minute cron job
- `LOCATION_FEED_SECRET`: optional bearer token for that feed

The included `vercel.json` runs `/api/refresh-location` every 10 minutes.

## SmartThings Setup

Samsung SmartThings Find is the public-facing website for SmartTags, but this project uses the official SmartThings API instead of trying to scrape the website login. Scraping the website is fragile and can break on login, CAPTCHA, two-factor checks, or Samsung page changes.

To test whether your SmartTag exposes location through the API:

1. Go to `https://account.smartthings.com/tokens`.
2. Generate a token with device read scopes.
3. Add it to Vercel as `SMARTTHINGS_TOKEN`.
4. Add `TRACKER_UPDATE_SECRET`.
5. Call this protected endpoint:

`https://your-site.vercel.app/api/smartthings-devices`

Use this header:

`Authorization: Bearer YOUR_TRACKER_UPDATE_SECRET`

Find your tag/device in the response and copy its `deviceId` into `SMARTTHINGS_DEVICE_ID`. Then set `LOCATION_SOURCE=smartthings`.

If `/api/refresh-location` says SmartThings did not expose latitude/longitude, the tag is visible in SmartThings Find but hidden from the public API. In that case, use the phone automation endpoint below instead.

## Local SmartThings Find Scraper

If you want to try scraping the SmartThings Find website from this PC, use the local scraper. This should run on your own computer, not on Vercel.

The scraper keeps a browser profile in `scraper/browser-profile`, so you can log into Samsung once and reuse that session. It does not push to Git or redeploy Vercel. It sends location updates directly to `/api/location`, which is the safer path.

Setup:

1. Copy `scraper/.env.example` to `scraper/.env`.
2. Set `TRACKER_SITE_URL` and `TRACKER_UPDATE_SECRET`.
3. Run `npm run scraper:login`.
4. Log into Samsung in the browser window, then press Enter in the terminal.
5. Run `npm run scraper`.

The hard part is whether SmartThings Find exposes raw latitude/longitude in page text. If it does, the scraper may find it automatically. If not, inspect the page and set:

- `SMARTTHINGS_LOCATION_SELECTOR`, or
- `SMARTTHINGS_LAT_SELECTOR` and `SMARTTHINGS_LNG_SELECTOR`

If scraping fails, screenshots and errors are saved in `scraper/logs`.

## Push a Location Update

Send a POST request to:

`https://your-site.vercel.app/api/location`

Use this header:

`Authorization: Bearer YOUR_TRACKER_UPDATE_SECRET`

Send JSON like:

```json
{
  "place": "Kansas City, Missouri",
  "lat": 39.0997,
  "lng": -94.5786,
  "miles": 1840,
  "updatedAt": "May 16, 2026 at 8:30 AM",
  "note": "Rolling east after breakfast."
}
```

Every successful update moves the current marker and appends a point to `actualPath`. The public progress file is visible to site visitors, but writes are protected by `TRACKER_UPDATE_SECRET`.

## Edit the Starter Route

Edit `data/progress.json`:

- `current`: the public location shown now
- `totalMiles`: expected full trip distance
- `route`: the planned cross-country route
- `actualPath`: the real path published so far
- `checkins`: recent public notes

## Local Preview

Open `index.html` directly, or run a local static server from this folder. The full Vercel API flow requires `vercel dev`.
