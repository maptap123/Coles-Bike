# Ride Across America Tracker

A Vercel-ready tracker site for sharing bike trip progress with friends and family.

## How Updates Work

The website checks for new saved progress every 10 minutes. On Vercel, it reads the latest saved progress from Vercel Blob storage. If Blob is not configured yet, it falls back to `data/progress.json`.

Location updates now come from the phone's GPS. Set up the phone to send one protected POST request to `/api/location` once an hour. The site snaps that point to the planned Ride with GPS route, moves the current marker along the route line, and keeps the raw phone coordinates as `sourceLat` and `sourceLng`.

## Vercel Setup

Create a Vercel Blob store for the project, then add these environment variables:

- `BLOB_READ_WRITE_TOKEN`: created by Vercel Blob
- `TRACKER_UPDATE_SECRET`: a long random password for location updates
- `INSTAGRAM_ACCESS_TOKEN`: Instagram Graph API token used to load the latest four posts
- `INSTAGRAM_USER_ID`: optional Instagram user ID; defaults to `me`
- `CRON_SECRET`: optional long random password for the scheduled refresh endpoint
- `LOCATION_FEED_URL`: optional JSON feed for a scheduled refresh endpoint
- `LOCATION_FEED_SECRET`: optional bearer token for that feed

The default `vercel.json` does not schedule a cron job so it can deploy cleanly on Hobby/free Vercel projects. If the phone posts directly to `/api/location`, the hourly phone automation is enough.

## Phone GPS Updates

The easiest phone setup is a GET request with everything in the URL:

```text
https://your-site.vercel.app/api/location?secret=YOUR_TRACKER_UPDATE_SECRET&place=Latest%20phone%20GPS&lat=39.0997&lng=-94.5786
```

In Tasker, use `Get Location v2`, then add an `HTTP Request` action with method `GET` and a URL like:

```text
https://your-site.vercel.app/api/location?secret=YOUR_TRACKER_UPDATE_SECRET&place=Latest%20phone%20GPS&lat=%gl_latitude&lng=%gl_longitude
```

You can also send a POST request to:

`https://your-site.vercel.app/api/location`

Use this header:

`Authorization: Bearer YOUR_TRACKER_UPDATE_SECRET`

Send JSON like:

```json
{
  "place": "Kansas City, Missouri",
  "lat": 39.0997,
  "lng": -94.5786,
  "updatedAt": "May 16, 2026 at 8:30 AM"
}
```

`miles` is optional. If it is not sent, the tracker estimates mileage from the phone's GPS point along the planned route.

Every successful update moves the current marker and appends a point to `actualPath`. The public progress file is visible to site visitors, but writes are protected by `TRACKER_UPDATE_SECRET`.

For an hourly phone setup, use an automation app such as Shortcuts on iPhone or MacroDroid/Tasker on Android. Configure it to collect the current GPS coordinates and send the JSON body above once an hour.

The completed line on the map follows the planned route instead of drawing straight lines between hourly phone updates. The starter route in `data/progress.json` comes from `https://ridewithgps.com/routes/54272880` and includes simplified mile markers for the full path.

## Edit the Starter Route

Edit `data/progress.json`:

- `current`: the public location shown now
- `totalMiles`: expected full trip distance
- `routeSource`: the planned Ride with GPS route URL
- `actualPath`: the real path published so far
- `facebookLocation`: optional override for the Facebook profile or place link
- `instagram`: Instagram profile link and optional fallback post links

## Local Preview

Open `index.html` directly, or run a local static server from this folder. The full Vercel API flow requires `vercel dev`.
