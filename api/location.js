import {
  applyLocationUpdate,
  readProgress,
  writeProgress,
} from "../lib/progressStore.js";

function isAuthorized(request) {
  const secret = process.env.TRACKER_UPDATE_SECRET;

  if (!secret) {
    return false;
  }

  return request.headers.authorization === `Bearer ${secret}`;
}

export default async function handler(request, response) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    return response.status(405).json({ error: "Method not allowed" });
  }

  if (!isAuthorized(request)) {
    return response.status(401).json({ error: "Unauthorized" });
  }

  try {
    const progress = await readProgress();
    const nextProgress = applyLocationUpdate(progress, request.body || {});

    await writeProgress(nextProgress);

    return response.status(200).json({
      ok: true,
      current: nextProgress.current,
      pathPoints: nextProgress.actualPath.length,
    });
  } catch (error) {
    return response.status(400).json({ error: error.message });
  }
}
