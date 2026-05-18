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

  return (
    request.headers.authorization === `Bearer ${secret}` ||
    request.query?.secret === secret
  );
}

export default async function handler(request, response) {
  if (!["GET", "POST"].includes(request.method)) {
    response.setHeader("Allow", "GET, POST");
    return response.status(405).json({ error: "Method not allowed" });
  }

  if (!isAuthorized(request)) {
    return response.status(401).json({ error: "Unauthorized" });
  }

  try {
    const progress = await readProgress();
    const update = request.method === "GET" ? request.query : request.body || {};
    const nextProgress = applyLocationUpdate(progress, update);

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
