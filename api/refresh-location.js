import {
  applyLocationUpdate,
  readProgress,
  writeProgress,
} from "../lib/progressStore.js";

function isAuthorized(request) {
  const secret = process.env.CRON_SECRET;

  if (!secret) {
    return true;
  }

  return request.headers.authorization === `Bearer ${secret}`;
}

export default async function handler(request, response) {
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    return response.status(405).json({ error: "Method not allowed" });
  }

  if (!isAuthorized(request)) {
    return response.status(401).json({ error: "Unauthorized" });
  }

  if (!process.env.LOCATION_FEED_URL) {
    return response.status(200).json({
      ok: true,
      skipped: true,
      reason: "Configure LOCATION_FEED_URL to pull location updates, or post phone GPS updates directly to /api/location.",
    });
  }

  try {
    const feedResponse = await fetch(process.env.LOCATION_FEED_URL, {
      headers: process.env.LOCATION_FEED_SECRET
        ? { Authorization: `Bearer ${process.env.LOCATION_FEED_SECRET}` }
        : {},
    });

    if (!feedResponse.ok) {
      throw new Error(`Location feed returned ${feedResponse.status}.`);
    }

    const update = await feedResponse.json();
    const progress = await readProgress();
    const nextProgress = applyLocationUpdate(progress, update);

    await writeProgress(nextProgress);

    return response.status(200).json({
      ok: true,
      source: "feed",
      current: nextProgress.current,
      pathPoints: nextProgress.actualPath.length,
    });
  } catch (error) {
    return response.status(500).json({ error: error.message });
  }
}
