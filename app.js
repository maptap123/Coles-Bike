const completedTrailColors = ["#c92932", "#fffaf1", "#1d4f8f"];
const completedTrailBaseStyle = {
  color: "#102022",
  weight: 8,
  opacity: 0.26,
};
const completedTrailStyle = {
  weight: 5,
  opacity: 0.96,
  lineCap: "round",
  lineJoin: "round",
};
const TRAIL_POINTS_PER_COLOR = 4;

const REFRESH_INTERVAL_MS = 60 * 1000;

const mapState = {
  map: null,
  layers: [],
};

const formatMiles = (value) =>
  new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

function setText(selector, value) {
  const element = document.querySelector(selector);

  if (element) {
    element.textContent = value;
  }
}

function setStyle(selector, property, value) {
  const element = document.querySelector(selector);

  if (element) {
    element.style[property] = value;
  }
}

function toLatLng(point) {
  return [point.lat, point.lng];
}

function hasSourceLocation(point) {
  return (
    Number.isFinite(Number(point?.sourceLat)) &&
    Number.isFinite(Number(point?.sourceLng))
  );
}

function sourceLatLng(point) {
  return [Number(point.sourceLat), Number(point.sourceLng)];
}

function lastRoutePoint(route) {
  return Array.isArray(route) && route.length > 0 ? route[route.length - 1] : null;
}

function formatCoordinate(value) {
  return Number(value).toFixed(4);
}

function projectPointOnSegment(point, segmentStart, segmentEnd) {
  const startLat = Number(segmentStart.lat);
  const startLng = Number(segmentStart.lng);
  const endLat = Number(segmentEnd.lat);
  const endLng = Number(segmentEnd.lng);
  const pointLat = Number(point.lat);
  const pointLng = Number(point.lng);
  const latScale = 69;
  const lngScale =
    Math.cos(((startLat + endLat) / 2) * Math.PI / 180) * latScale;
  const latDelta = endLat - startLat;
  const lngDelta = endLng - startLng;
  const scaledLatDelta = latDelta * latScale;
  const scaledLngDelta = lngDelta * lngScale;
  const segmentLength =
    scaledLatDelta * scaledLatDelta + scaledLngDelta * scaledLngDelta;
  const pointLatDelta = (pointLat - startLat) * latScale;
  const pointLngDelta = (pointLng - startLng) * lngScale;
  const segmentProgress =
    segmentLength === 0
      ? 0
      : clamp(
          (pointLatDelta * scaledLatDelta + pointLngDelta * scaledLngDelta) /
            segmentLength,
          0,
          1,
        );

  return {
    lat: startLat + latDelta * segmentProgress,
    lng: startLng + lngDelta * segmentProgress,
    distance:
      ((pointLat - (startLat + latDelta * segmentProgress)) * latScale) ** 2 +
      ((pointLng - (startLng + lngDelta * segmentProgress)) * lngScale) ** 2,
  };
}

function closestPointOnRoute(point, route) {
  if (!Array.isArray(route) || route.length <= 1) {
    return point;
  }

  let bestMatch = null;

  for (let index = 0; index < route.length - 1; index += 1) {
    const projected = projectPointOnSegment(point, route[index], route[index + 1]);

    if (!bestMatch || projected.distance < bestMatch.distance) {
      bestMatch = { ...projected, segmentIndex: index };
    }
  }

  return bestMatch || point;
}

function completedRouteFor(data) {
  const route = Array.isArray(data.route) ? data.route : [];

  if (route.length <= 1) {
    return route.map(toLatLng);
  }

  const bestMatch = closestPointOnRoute(data.current, route);

  const completedRoute = route.slice(0, bestMatch.segmentIndex + 1).map(toLatLng);
  completedRoute.push([bestMatch.lat, bestMatch.lng]);

  return completedRoute;
}

function routeColorSegments(route) {
  if (!Array.isArray(route) || route.length <= 1) {
    return [];
  }

  const segments = [];
  let startIndex = 0;
  let colorIndex = 0;

  while (startIndex < route.length - 1) {
    const endIndex = Math.min(
      startIndex + TRAIL_POINTS_PER_COLOR,
      route.length - 1,
    );

    segments.push({
      color: completedTrailColors[colorIndex % completedTrailColors.length],
      points: route.slice(startIndex, endIndex + 1),
    });

    startIndex = endIndex;
    colorIndex += 1;
  }

  return segments;
}

function drawCompletedTrail(map, route) {
  if (!Array.isArray(route) || route.length <= 1) {
    return;
  }

  mapState.layers.push(L.polyline(route, completedTrailBaseStyle).addTo(map));

  routeColorSegments(route).forEach((segment) => {
    mapState.layers.push(
      L.polyline(segment.points, {
        ...completedTrailStyle,
        color: segment.color,
      }).addTo(map),
    );
  });
}

function formatDuration(startDate) {
  if (!startDate) {
    return "0 days";
  }

  const start = new Date(startDate);

  if (Number.isNaN(start.getTime())) {
    return "0 days";
  }

  const elapsedMs = Math.max(Date.now() - start.getTime(), 0);
  const days = Math.floor(elapsedMs / 86400000);
  const hours = Math.floor((elapsedMs % 86400000) / 3600000);

  if (days <= 0) {
    return `${hours} hours riding`;
  }

  return `${days} days ${hours} hours`;
}

function renderGoals(goals = []) {
  const list = document.querySelector("#goals-list");
  const completed = goals.filter((goal) => goal.done).length;

  setText("#goals-count", `${completed}/${goals.length}`);

  if (!list) {
    return;
  }

  list.innerHTML = "";

  goals.forEach((goal) => {
    const item = document.createElement("li");
    const box = document.createElement("span");
    const text = document.createElement("span");
    const title = document.createElement("strong");
    const detail = document.createElement("span");

    box.className = goal.done ? "goal-box complete" : "goal-box";
    box.textContent = goal.done ? "X" : "";
    text.className = "goal-text";
    title.textContent = goal.label;
    detail.textContent = goal.detail || (goal.done ? "Completed" : "Still ahead");

    text.append(title, detail);
    item.append(box, text);
    list.append(item);
  });
}

function renderSocialLinks(data) {
  const instagramUrl = data.instagram?.url || "https://www.instagram.com/colethe_dude";
  const facebookUrl =
    data.facebookLocation?.url || "https://www.facebook.com/cole.jenkins.924808";
  const venmoUrl = data.venmo?.url || "https://venmo.com/u/colecampguy";
  const instagramLink = document.querySelector("#instagram-link");
  const facebookLink = document.querySelector("#facebook-link");
  const venmoLink = document.querySelector("#venmo-link");

  if (instagramLink) {
    instagramLink.href = instagramUrl;
    instagramLink.onclick = (event) => {
      event.preventDefault();
      window.location.assign(instagramUrl);
    };
  }

  if (facebookLink) {
    facebookLink.href = facebookUrl;
    facebookLink.onclick = (event) => {
      event.preventDefault();
      window.location.assign(facebookUrl);
    };
  }

  if (venmoLink) {
    venmoLink.href = venmoUrl;
    venmoLink.onclick = (event) => {
      event.preventDefault();
      window.location.assign(venmoUrl);
    };
  }
}

function renderStats(data) {
  const progress = clamp(data.current.miles / data.totalMiles, 0, 1);
  const percent = Math.round(progress * 100);

  document.title = `${percent}% complete - ${data.title}`;
  setText("#ride-title", data.title);
  setText("#ride-subtitle", data.subtitle || "Following the road east.");
  setText("#ride-status", data.status);
  setText("#ride-clock", formatDuration(data.startedAt));
  setText("#current-place", data.current.place);
  setText("#last-updated", `Last updated ${data.current.updatedAt}`);
  setText(
    "#phone-location",
    hasSourceLocation(data.current)
      ? `Phone GPS ${formatCoordinate(data.current.sourceLat)}, ${formatCoordinate(
          data.current.sourceLng,
        )}`
      : "",
  );
  setText("#miles-ridden", formatMiles(data.current.miles));
  setText("#miles-left", formatMiles(Math.max(data.totalMiles - data.current.miles, 0)));
  setText("#progress-percent", `${percent}%`);
  setStyle("#progress-fill", "width", `${percent}%`);

  return progress;
}

async function loadProgress() {
  let response = await fetch("/api/progress", { cache: "no-store" });

  if (!response.ok) {
    response = await fetch("data/progress.json", { cache: "no-store" });
  }

  if (!response.ok) {
    throw new Error("Could not load progress data.");
  }

  return response.json();
}

function createMap() {
  if (!window.L) {
    return null;
  }

  const map = L.map("map", {
    zoomControl: false,
    scrollWheelZoom: true,
  });

  L.control.zoom({ position: "bottomleft" }).addTo(map);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 18,
    attribution: "&copy; OpenStreetMap contributors",
  }).addTo(map);

  return map;
}

function clearRideLayers() {
  mapState.layers.forEach((layer) => layer.remove());
  mapState.layers = [];
}

function renderMap(data, progress) {
  if (!mapState.map) {
    mapState.map = createMap();
  }

  if (!mapState.map) {
    return;
  }

  clearRideLayers();

  const completedRoute = completedRouteFor(data, progress);
  const routePoint = closestPointOnRoute(data.current, data.route);
  const destination = lastRoutePoint(data.route);

  drawCompletedTrail(mapState.map, completedRoute);

  const markerIcon = L.divIcon({
    className: "ride-marker",
    iconSize: [34, 34],
    iconAnchor: [17, 17],
  });
  const marker = L.marker(toLatLng(routePoint), { icon: markerIcon }).addTo(
    mapState.map,
  );
  marker.bindPopup(
    `<strong>${data.current.place}</strong><br>${data.current.updatedAt}<br>Route progress`,
  );
  mapState.layers.push(marker);

  if (destination) {
    const destinationIcon = L.divIcon({
      className: "destination-marker",
      iconSize: [30, 42],
      iconAnchor: [15, 40],
    });
    const destinationMarker = L.marker(toLatLng(destination), {
      icon: destinationIcon,
    }).addTo(mapState.map);
    destinationMarker.bindPopup("<strong>Atlantic finish</strong>");
    mapState.layers.push(destinationMarker);
  }

  const boundsPoints = destination
    ? [...completedRoute, toLatLng(routePoint), toLatLng(destination)]
    : [...completedRoute, toLatLng(routePoint)];

  if (hasSourceLocation(data.current)) {
    const phoneIcon = L.divIcon({
      className: "phone-marker",
      iconSize: [22, 22],
      iconAnchor: [11, 11],
    });
    const phoneMarker = L.marker(sourceLatLng(data.current), { icon: phoneIcon }).addTo(
      mapState.map,
    );
    phoneMarker.bindPopup(
      `<strong>Phone GPS</strong><br>${data.current.updatedAt}<br>${formatCoordinate(
        data.current.sourceLat,
      )}, ${formatCoordinate(data.current.sourceLng)}`,
    );
    mapState.layers.push(phoneMarker);
    boundsPoints.push(sourceLatLng(data.current));
  }

  const bounds = L.latLngBounds(boundsPoints);
  mapState.map.fitBounds(bounds, { padding: [36, 36] });
}

async function refreshProgress() {
  const data = await loadProgress();
  const progress = renderStats(data);
  renderGoals(data.goals || []);
  renderSocialLinks(data);
  renderMap(data, progress);
}

async function init() {
  await refreshProgress();
  window.setInterval(refreshProgress, REFRESH_INTERVAL_MS);
}

init().catch((error) => {
  setText("#ride-status", "Needs data");
  setText("#current-place", "Could not load tracker");
  setText("#last-updated", error.message);
});
