import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { list, put } from "@vercel/blob";

const PROGRESS_PATH = "ride-progress/progress.json";
const METERS_PER_MILE = 1609.344;
const ROUTE_SIMPLIFY_TOLERANCE_METERS = 25;
let cachedRoute = null;
let cachedProgressBlobUrl = null;

async function streamToText(stream) {
  const response = new Response(stream);
  return response.text();
}

export async function readFallbackProgress() {
  const file = await readFile(join(process.cwd(), "data", "progress.json"), "utf8");
  return hydrateRoute(JSON.parse(file));
}

function perpendicularDistance(point, start, end) {
  const latScale = 111320;
  const lngScale = Math.cos(((start.lat + end.lat) / 2) * Math.PI / 180) * latScale;
  const px = point.lng * lngScale;
  const py = point.lat * latScale;
  const sx = start.lng * lngScale;
  const sy = start.lat * latScale;
  const ex = end.lng * lngScale;
  const ey = end.lat * latScale;
  const dx = ex - sx;
  const dy = ey - sy;

  if (dx === 0 && dy === 0) {
    return Math.hypot(px - sx, py - sy);
  }

  const progress = Math.max(
    0,
    Math.min(1, ((px - sx) * dx + (py - sy) * dy) / (dx * dx + dy * dy)),
  );

  return Math.hypot(px - (sx + dx * progress), py - (sy + dy * progress));
}

function simplifyRoute(points, toleranceMeters) {
  if (points.length <= 2) {
    return points;
  }

  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];

  while (stack.length) {
    const [first, last] = stack.pop();
    let maxDistance = 0;
    let selectedIndex = 0;

    for (let index = first + 1; index < last; index += 1) {
      const distance = perpendicularDistance(points[index], points[first], points[last]);

      if (distance > maxDistance) {
        maxDistance = distance;
        selectedIndex = index;
      }
    }

    if (maxDistance > toleranceMeters) {
      keep[selectedIndex] = 1;
      stack.push([first, selectedIndex], [selectedIndex, last]);
    }
  }

  return points.filter((_, index) => keep[index]);
}

function round(value, precision = 5) {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}

function routeStartKey(routeStart) {
  if (!routeStart) {
    return null;
  }

  const lat = Number(routeStart.lat);
  const lng = Number(routeStart.lng);

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return null;
  }

  return `${round(lat, 6)},${round(lng, 6)}`;
}

function normalizeRouteWithMiles(route) {
  if (!Array.isArray(route) || route.length === 0) {
    return [];
  }

  const routeHasMiles = route.every((point) => Number.isFinite(Number(point.miles)));

  if (routeHasMiles) {
    return route.map((point) => ({
      ...point,
      lat: Number(point.lat),
      lng: Number(point.lng),
      miles: Number(point.miles),
    }));
  }

  let miles = 0;

  return route.map((point, index) => {
    if (index > 0) {
      miles += distanceBetween(route[index - 1], point);
    }

    return {
      ...point,
      lat: Number(point.lat),
      lng: Number(point.lng),
      miles,
    };
  });
}

function closestRouteMatch(point, route) {
  const normalizedRoute = normalizeRouteWithMiles(route);

  if (normalizedRoute.length <= 1) {
    return null;
  }

  let bestMatch = null;

  for (let index = 0; index < normalizedRoute.length - 1; index += 1) {
    const start = normalizedRoute[index];
    const end = normalizedRoute[index + 1];
    const projected = projectPointOnSegment(point, start, end);
    const segmentMiles = Math.max(Number(end.miles) - Number(start.miles), 0);
    const miles = Number(start.miles) + segmentMiles * projected.segmentProgress;

    if (!bestMatch || projected.distance < bestMatch.distance) {
      bestMatch = {
        ...projected,
        distance: projected.distance,
        miles,
        segmentIndex: index,
        route: normalizedRoute,
      };
    }
  }

  return bestMatch;
}

function rebasePointMiles(point, startMiles, connectorMiles) {
  const miles = Number(point?.miles);

  if (!point || !Number.isFinite(miles)) {
    return point;
  }

  return {
    ...point,
    miles: round(Math.max(miles - startMiles + connectorMiles, 0), 1),
  };
}

function applyRouteStart(progress) {
  const startKey = routeStartKey(progress.routeStart);

  if (!startKey || progress.routeStartApplied === startKey) {
    return progress;
  }

  const route = normalizeRouteWithMiles(progress.route);

  if (route.length <= 1) {
    return progress;
  }

  const routeStart = {
    lat: Number(progress.routeStart.lat),
    lng: Number(progress.routeStart.lng),
  };
  const match = closestRouteMatch(routeStart, route);

  if (!match) {
    return progress;
  }

  const startMiles = match.miles;
  const connectorMiles = distanceBetween(routeStart, match);
  const rebasedRoute = [
    {
      lat: round(routeStart.lat),
      lng: round(routeStart.lng),
      miles: 0,
    },
  ];

  if (connectorMiles > 0.01) {
    rebasedRoute.push({
      lat: round(match.lat),
      lng: round(match.lng),
      miles: round(connectorMiles, 3),
    });
  }

  route.slice(match.segmentIndex + 1).forEach((point) => {
    if (Number(point.miles) >= startMiles) {
      rebasedRoute.push({
        ...point,
        lat: round(point.lat),
        lng: round(point.lng),
        miles: round(Number(point.miles) - startMiles + connectorMiles, 3),
      });
    }
  });

  const totalMiles = round(
    Math.max(Number(route[route.length - 1].miles) - startMiles + connectorMiles, 0),
    1,
  );

  return {
    ...progress,
    subtitle: `Following the planned Ride with GPS route from ${
      progress.routeStart.place || "Shoreline, WA"
    } to 39.51, -74.32.`,
    totalMiles,
    current: rebasePointMiles(progress.current, startMiles, connectorMiles),
    actualPath: Array.isArray(progress.actualPath)
      ? progress.actualPath.map((point) => rebasePointMiles(point, startMiles, connectorMiles))
      : progress.actualPath,
    route: rebasedRoute,
    routeStartApplied: startKey,
  };
}

async function fetchRideWithGpsRoute(routeSource) {
  if (!routeSource) {
    return null;
  }

  if (cachedRoute?.routeSource === routeSource) {
    return cachedRoute;
  }

  const response = await fetch(`${routeSource}.json`, { cache: "force-cache" });

  if (!response.ok) {
    throw new Error(`Ride with GPS returned ${response.status}.`);
  }

  const routeData = await response.json();
  const rawRoute = routeData.track_points.map((point) => ({
    lat: point.y,
    lng: point.x,
    miles: point.d / METERS_PER_MILE,
  }));
  const route = rawRoute.map((point) => ({
    lat: round(point.lat),
    lng: round(point.lng),
    miles: round(point.miles, 3),
  }));

  cachedRoute = {
    routeSource,
    routeId: String(routeData.id),
    title: routeData.name,
    totalMiles: round(routeData.distance / METERS_PER_MILE, 1),
    route,
  };

  return cachedRoute;
}

async function hydrateRoute(progress) {
  if (Array.isArray(progress.route) && progress.route.length > 1) {
    return applyRouteStart(progress);
  }

  const routeSource = progress.routeSource;
  const routeData = await fetchRideWithGpsRoute(routeSource);

  if (!routeData) {
    return progress;
  }

  const start = routeData.route[0];
  const end = routeData.route[routeData.route.length - 1];

  return applyRouteStart({
    ...progress,
    routeId: routeData.routeId,
    routeSource,
    title: routeData.title || progress.title,
    subtitle:
      progress.subtitle ||
      `Following the planned Ride with GPS route from ${round(start.lat, 3)}, ${round(
        start.lng,
        3,
      )} to ${round(end.lat, 3)}, ${round(end.lng, 3)}.`,
    totalMiles: routeData.totalMiles,
    route: routeData.route,
  });
}

async function applyCanonicalRoute(progress, fallback) {
  const canonicalProgress = {
    ...progress,
    startedAt: fallback.startedAt,
    goals: fallback.goals,
    instagram: fallback.instagram,
    facebookLocation: fallback.facebookLocation,
    venmo: fallback.venmo,
    routeStart: fallback.routeStart,
  };

  if (!fallback?.routeId || progress?.routeId === fallback.routeId) {
    return hydrateRoute(canonicalProgress);
  }

  return hydrateRoute({
    ...canonicalProgress,
    routeId: fallback.routeId,
    routeSource: fallback.routeSource,
    title: fallback.title,
    subtitle: fallback.subtitle,
    totalMiles: fallback.totalMiles,
    route: fallback.route,
    routeStart: fallback.routeStart,
  });
}

export async function readProgress() {
  const fallback = await readFallbackProgress();

  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return fallback;
  }

  let blobUrl = cachedProgressBlobUrl;

  if (!blobUrl) {
    const result = await list({ prefix: PROGRESS_PATH, limit: 1 });
    const blob = result.blobs.find((item) => item.pathname === PROGRESS_PATH);

    if (!blob) {
      return fallback;
    }

    blobUrl = blob.url;
    cachedProgressBlobUrl = blobUrl;
  }

  const response = await fetch(blobUrl, { cache: "no-store" });

  if (!response.ok || !response.body) {
    cachedProgressBlobUrl = null;
    return fallback;
  }

  return applyCanonicalRoute(JSON.parse(await streamToText(response.body)), fallback);
}

export async function writeProgress(progress) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    throw new Error("BLOB_READ_WRITE_TOKEN is required to save progress.");
  }

  const { route, routeStartApplied, ...storedProgress } = progress;

  await put(PROGRESS_PATH, JSON.stringify(storedProgress, null, 2), {
    access: "public",
    allowOverwrite: true,
    cacheControlMaxAge: 60,
    contentType: "application/json",
  });
}

function toRadians(value) {
  return (Number(value) * Math.PI) / 180;
}

function distanceBetween(start, end) {
  const earthRadiusMiles = 3958.8;
  const startLat = toRadians(start.lat);
  const endLat = toRadians(end.lat);
  const latDelta = toRadians(end.lat - start.lat);
  const lngDelta = toRadians(end.lng - start.lng);
  const haversine =
    Math.sin(latDelta / 2) ** 2 +
    Math.cos(startLat) * Math.cos(endLat) * Math.sin(lngDelta / 2) ** 2;

  return 2 * earthRadiusMiles * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

function projectPointOnSegment(point, segmentStart, segmentEnd) {
  const latScale = 69;
  const lngScale =
    Math.cos(toRadians((Number(segmentStart.lat) + Number(segmentEnd.lat)) / 2)) *
    latScale;
  const latDelta = Number(segmentEnd.lat) - Number(segmentStart.lat);
  const lngDelta = Number(segmentEnd.lng) - Number(segmentStart.lng);
  const scaledLatDelta = latDelta * latScale;
  const scaledLngDelta = lngDelta * lngScale;
  const segmentLength =
    scaledLatDelta * scaledLatDelta + scaledLngDelta * scaledLngDelta;
  const pointLatDelta = (Number(point.lat) - Number(segmentStart.lat)) * latScale;
  const pointLngDelta = (Number(point.lng) - Number(segmentStart.lng)) * lngScale;
  const segmentProgress =
    segmentLength === 0
      ? 0
      : Math.min(
          Math.max(
            (pointLatDelta * scaledLatDelta + pointLngDelta * scaledLngDelta) /
              segmentLength,
            0,
          ),
          1,
        );
  const projected = {
    lat: segmentStart.lat + latDelta * segmentProgress,
    lng: segmentStart.lng + lngDelta * segmentProgress,
  };

  return {
    ...projected,
    segmentProgress,
    distance:
      ((Number(point.lat) - projected.lat) * latScale) ** 2 +
      ((Number(point.lng) - projected.lng) * lngScale) ** 2,
  };
}

function matchPointToRoute(progress, point) {
  const route = Array.isArray(progress.route) ? progress.route : [];
  const totalMiles = Number(progress.totalMiles);

  if (route.length < 2 || !Number.isFinite(totalMiles) || totalMiles <= 0) {
    return null;
  }

  const segmentMiles = [];
  const cumulativeMiles = [0];
  const routeHasMiles = route.every((point) => Number.isFinite(Number(point.miles)));

  for (let index = 0; index < route.length - 1; index += 1) {
    const miles = routeHasMiles
      ? Number(route[index + 1].miles) - Number(route[index].miles)
      : distanceBetween(route[index], route[index + 1]);
    segmentMiles.push(miles);
    cumulativeMiles.push(cumulativeMiles[index] + miles);
  }

  const routeMiles = cumulativeMiles[cumulativeMiles.length - 1];

  if (routeMiles <= 0) {
    return null;
  }

  let bestMatch = null;

  for (let index = 0; index < route.length - 1; index += 1) {
    const projected = projectPointOnSegment(point, route[index], route[index + 1]);

    if (!bestMatch || projected.distance < bestMatch.distance) {
      bestMatch = { ...projected, segmentIndex: index };
    }
  }

  const milesAlongRoute =
    cumulativeMiles[bestMatch.segmentIndex] +
    segmentMiles[bestMatch.segmentIndex] * bestMatch.segmentProgress;

  return {
    lat: bestMatch.lat,
    lng: bestMatch.lng,
    miles: (milesAlongRoute / routeMiles) * totalMiles,
    offRouteMiles: Math.sqrt(bestMatch.distance),
  };
}

function resolveLocationMiles(progress, updateMiles, estimatedMiles) {
  const previousMiles = Number(progress.current?.miles);
  const candidateMiles = Number(updateMiles ?? estimatedMiles ?? previousMiles ?? 0);

  if (!Number.isFinite(candidateMiles) || candidateMiles < 0) {
    throw new Error("miles must be a valid positive number.");
  }

  if (
    updateMiles == null &&
    Number.isFinite(previousMiles) &&
    estimatedMiles != null &&
    Number.isFinite(Number(estimatedMiles)) &&
    candidateMiles < previousMiles
  ) {
    return previousMiles;
  }

  return candidateMiles;
}

export function applyLocationUpdate(progress, update) {
  const lat = Number(update.lat);
  const lng = Number(update.lng);

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    throw new Error("lat and lng must be valid numbers.");
  }

  const routeMatch = matchPointToRoute(progress, { lat, lng });
  const estimatedMiles = routeMatch?.miles;
  const miles = resolveLocationMiles(progress, update.miles, estimatedMiles);

  const updatedAt = update.updatedAt || new Date().toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "America/New_York",
  });

  const place = String(update.place || progress.current?.place || "Latest location");
  const point = {
    place,
    lat: routeMatch?.lat ?? lat,
    lng: routeMatch?.lng ?? lng,
    sourceLat: lat,
    sourceLng: lng,
    miles,
    updatedAt,
  };

  const actualPath = Array.isArray(progress.actualPath)
    ? [...progress.actualPath]
    : [];
  const lastPoint = actualPath[actualPath.length - 1];

  if (!lastPoint || lastPoint.lat !== lat || lastPoint.lng !== lng) {
    actualPath.push(point);
  }

  const checkins = Array.isArray(progress.checkins) ? [...progress.checkins] : [];

  if (update.note) {
    checkins.unshift({
      date: updatedAt,
      place,
      note: String(update.note),
    });
  }

  return {
    ...progress,
    status: update.status || progress.status,
    current: point,
    actualPath,
    checkins: checkins.slice(0, 20),
  };
}
