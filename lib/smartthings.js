const SMARTTHINGS_BASE_URL = "https://api.smartthings.com/v1";

function getToken() {
  const token = process.env.SMARTTHINGS_TOKEN;

  if (!token) {
    throw new Error("SMARTTHINGS_TOKEN is not configured.");
  }

  return token;
}

async function smartThingsFetch(path) {
  const response = await fetch(`${SMARTTHINGS_BASE_URL}${path}`, {
    headers: {
      Authorization: `Bearer ${getToken()}`,
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`SmartThings returned ${response.status}: ${detail}`);
  }

  return response.json();
}

function readAttribute(status, capability, attribute) {
  return status?.components?.main?.[capability]?.[attribute]?.value;
}

function readNestedNumber(value, keys) {
  if (typeof value === "number") {
    return value;
  }

  if (!value || typeof value !== "object") {
    return undefined;
  }

  for (const key of keys) {
    const nextValue = value[key];

    if (typeof nextValue === "number") {
      return nextValue;
    }
  }

  return undefined;
}

function extractLocationFromStatus(status) {
  const candidates = [
    readAttribute(status, "location", "location"),
    readAttribute(status, "presenceSensor", "location"),
    readAttribute(status, "mobilePresence", "location"),
    readAttribute(status, "tagLocation", "location"),
    readAttribute(status, "find", "location"),
  ].filter(Boolean);

  for (const candidate of candidates) {
    const lat = readNestedNumber(candidate, ["lat", "latitude"]);
    const lng = readNestedNumber(candidate, ["lng", "lon", "long", "longitude"]);

    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      return {
        lat,
        lng,
        place: candidate.place || candidate.name || "SmartThings location",
        updatedAt: candidate.updatedAt || candidate.timestamp,
      };
    }
  }

  const latitude = readAttribute(status, "location", "latitude");
  const longitude = readAttribute(status, "location", "longitude");

  if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
    return {
      lat: latitude,
      lng: longitude,
      place: "SmartThings location",
    };
  }

  return undefined;
}

export async function listSmartThingsDevices() {
  return smartThingsFetch("/devices");
}

export async function getSmartThingsDeviceStatus(deviceId) {
  if (!deviceId) {
    throw new Error("SMARTTHINGS_DEVICE_ID is not configured.");
  }

  return smartThingsFetch(`/devices/${encodeURIComponent(deviceId)}/status`);
}

export async function getSmartThingsLocationUpdate() {
  const deviceId = process.env.SMARTTHINGS_DEVICE_ID;
  const status = await getSmartThingsDeviceStatus(deviceId);
  const location = extractLocationFromStatus(status);

  if (!location) {
    throw new Error(
      "SmartThings did not expose latitude/longitude for this device. SmartTags may be visible in SmartThings Find without exposing location through the public API.",
    );
  }

  return {
    ...location,
    place: process.env.SMARTTHINGS_PLACE_LABEL || location.place,
    updatedAt: location.updatedAt || new Date().toLocaleString("en-US", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "America/New_York",
    }),
  };
}
