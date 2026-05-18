import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { list, put } from "@vercel/blob";

const PROGRESS_PATH = "ride-progress/progress.json";

async function streamToText(stream) {
  const response = new Response(stream);
  return response.text();
}

export async function readFallbackProgress() {
  const file = await readFile(join(process.cwd(), "data", "progress.json"), "utf8");
  return JSON.parse(file);
}

export async function readProgress() {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return readFallbackProgress();
  }

  const result = await list({ prefix: PROGRESS_PATH, limit: 1 });
  const blob = result.blobs.find((item) => item.pathname === PROGRESS_PATH);

  if (!blob) {
    return readFallbackProgress();
  }

  const response = await fetch(blob.url, { cache: "no-store" });

  if (!response.ok || !response.body) {
    return readFallbackProgress();
  }

  return JSON.parse(await streamToText(response.body));
}

export async function writeProgress(progress) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    throw new Error("BLOB_READ_WRITE_TOKEN is required to save progress.");
  }

  await put(PROGRESS_PATH, JSON.stringify(progress, null, 2), {
    access: "public",
    allowOverwrite: true,
    cacheControlMaxAge: 60,
    contentType: "application/json",
  });
}

export function applyLocationUpdate(progress, update) {
  const lat = Number(update.lat);
  const lng = Number(update.lng);
  const miles = Number(update.miles ?? progress.current?.miles ?? 0);

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    throw new Error("lat and lng must be valid numbers.");
  }

  if (!Number.isFinite(miles) || miles < 0) {
    throw new Error("miles must be a valid positive number.");
  }

  const updatedAt = update.updatedAt || new Date().toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "America/New_York",
  });

  const place = String(update.place || progress.current?.place || "Latest location");
  const point = { place, lat, lng, miles, updatedAt };

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
