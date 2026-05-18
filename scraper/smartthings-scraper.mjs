import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { chromium } from "playwright";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, "..");
const profileDir = join(__dirname, "browser-profile");
const logsDir = join(__dirname, "logs");

function parseEnvFile(text) {
  return Object.fromEntries(
    text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"))
      .map((line) => {
        const index = line.indexOf("=");
        const key = line.slice(0, index).trim();
        const value = line.slice(index + 1).trim().replace(/^["']|["']$/g, "");
        return [key, value];
      })
      .filter(([key]) => key),
  );
}

async function loadLocalEnv() {
  for (const file of [join(rootDir, ".env.local"), join(__dirname, ".env")]) {
    if (!existsSync(file)) {
      continue;
    }

    const values = parseEnvFile(await readFile(file, "utf8"));

    for (const [key, value] of Object.entries(values)) {
      process.env[key] ||= value;
    }
  }
}

function requireEnv(name) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`${name} is required.`);
  }

  return value;
}

function minutesToMs(value) {
  const minutes = Number(value || 30);
  return Math.max(minutes, 1) * 60 * 1000;
}

function toNumber(text) {
  const match = String(text).match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : undefined;
}

function isUsLikeCoordinate(lat, lng) {
  return lat >= 18 && lat <= 72 && lng >= -170 && lng <= -50;
}

function findCoordinates(text) {
  const matches = [...String(text).matchAll(/(-?\d{1,2}\.\d{4,})\D+(-?\d{2,3}\.\d{4,})/g)];

  for (const match of matches) {
    const lat = Number(match[1]);
    const lng = Number(match[2]);

    if (Number.isFinite(lat) && Number.isFinite(lng) && isUsLikeCoordinate(lat, lng)) {
      return { lat, lng };
    }
  }

  return undefined;
}

async function readText(page, selector) {
  if (!selector) {
    return undefined;
  }

  const locator = page.locator(selector).first();

  if ((await locator.count()) === 0) {
    return undefined;
  }

  return locator.textContent({ timeout: 5000 });
}

async function scrapeLocation(page) {
  const latText = await readText(page, process.env.SMARTTHINGS_LAT_SELECTOR);
  const lngText = await readText(page, process.env.SMARTTHINGS_LNG_SELECTOR);
  const placeText = await readText(page, process.env.SMARTTHINGS_PLACE_SELECTOR);

  if (latText && lngText) {
    return {
      lat: toNumber(latText),
      lng: toNumber(lngText),
      place: placeText?.trim() || process.env.SMARTTHINGS_PLACE_LABEL || "SmartThings Find",
    };
  }

  const locationText = await readText(page, process.env.SMARTTHINGS_LOCATION_SELECTOR);
  const sourceText = locationText || (await page.locator("body").innerText({ timeout: 10000 }));
  const coordinates = findCoordinates(sourceText);

  if (!coordinates) {
    throw new Error(
      "Could not find latitude/longitude on the SmartThings page. Set SMARTTHINGS_LOCATION_SELECTOR, or separate SMARTTHINGS_LAT_SELECTOR and SMARTTHINGS_LNG_SELECTOR after inspecting the page.",
    );
  }

  return {
    ...coordinates,
    place: placeText?.trim() || process.env.SMARTTHINGS_PLACE_LABEL || "SmartThings Find",
  };
}

async function pushLocation(update) {
  const siteUrl = requireEnv("TRACKER_SITE_URL").replace(/\/$/, "");
  const secret = requireEnv("TRACKER_UPDATE_SECRET");
  const response = await fetch(`${siteUrl}/api/location`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(update),
  });

  const body = await response.text();

  if (!response.ok) {
    throw new Error(`Tracker update failed with ${response.status}: ${body}`);
  }

  return body;
}

async function saveFailure(page, error) {
  await mkdir(logsDir, { recursive: true });

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const screenshotPath = join(logsDir, `smartthings-${stamp}.png`);
  const textPath = join(logsDir, `smartthings-${stamp}.txt`);

  await page.screenshot({ path: screenshotPath, fullPage: true });
  await writeFile(textPath, String(error.stack || error.message || error));

  console.error(`Saved failure details to ${screenshotPath}`);
}

async function waitForLoginIfRequested(page) {
  if (process.env.SCRAPER_LOGIN_ONLY !== "true" && process.env.SCRAPER_WAIT_FOR_LOGIN !== "true") {
    return;
  }

  const rl = createInterface({ input, output });
  console.log("Log into Samsung/SmartThings in the browser window, then press Enter here.");
  await rl.question("");
  rl.close();

  if (process.env.SCRAPER_LOGIN_ONLY === "true") {
    await page.context().close();
    process.exit(0);
  }
}

async function run() {
  await loadLocalEnv();
  await mkdir(profileDir, { recursive: true });

  const url = process.env.SMARTTHINGS_FIND_URL || "https://smartthingsfind.samsung.com/";
  const intervalMs = minutesToMs(process.env.SCRAPER_INTERVAL_MINUTES);
  const context = await chromium.launchPersistentContext(profileDir, {
    channel: process.env.PLAYWRIGHT_CHANNEL || "chrome",
    headless: false,
    viewport: { width: 1365, height: 900 },
  });
  const page = context.pages()[0] || (await context.newPage());

  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  await waitForLoginIfRequested(page);

  async function tick() {
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
      await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});

      const location = await scrapeLocation(page);
      const update = {
        ...location,
        updatedAt: new Date().toLocaleString("en-US", {
          dateStyle: "medium",
          timeStyle: "short",
          timeZone: process.env.TRACKER_TIMEZONE || "America/New_York",
        }),
        note: process.env.SMARTTHINGS_UPDATE_NOTE || undefined,
      };

      const result = await pushLocation(update);
      console.log(`[${new Date().toISOString()}] Updated tracker: ${result}`);
    } catch (error) {
      console.error(`[${new Date().toISOString()}] ${error.message}`);
      await saveFailure(page, error).catch((saveError) => {
        console.error(`Could not save failure screenshot: ${saveError.message}`);
      });
    }
  }

  await tick();
  setInterval(tick, intervalMs);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
