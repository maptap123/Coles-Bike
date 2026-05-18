const completedTrailBaseStyle = {
  color: "#ffffff",
  weight: 10,
  opacity: 0.18,
};
const completedTrailStyle = {
  weight: 5,
  opacity: 0.55,
  lineCap: "round",
  lineJoin: "round",
};
const TRAIL_SEGMENT_SIZE = 3;

function lerpChannel(a, b, t) {
  return Math.round(a + (b - a) * t);
}

function trailColorAt(t) {
  const red = [191, 10, 48];
  const white = [240, 235, 220];
  const navy = [0, 40, 104];
  const [r1, g1, b1] = t < 0.5 ? red : white;
  const [r2, g2, b2] = t < 0.5 ? white : navy;
  const u = t < 0.5 ? t * 2 : (t - 0.5) * 2;
  return `rgb(${lerpChannel(r1, r2, u)},${lerpChannel(g1, g2, u)},${lerpChannel(b1, b2, u)})`;
}

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

function routePointForMiles(data) {
  const route = Array.isArray(data.route) ? data.route : [];
  const currentMiles = Number(data.current?.miles);

  if (route.length <= 1 || !Number.isFinite(currentMiles)) {
    return closestPointOnRoute(data.current, route);
  }

  const routeHasMiles = route.every((point) => Number.isFinite(Number(point.miles)));

  if (!routeHasMiles) {
    return closestPointOnRoute(data.current, route);
  }

  const routeEndMiles = Number(route[route.length - 1].miles);
  const totalMiles = Number(data.totalMiles);
  const targetMiles =
    Number.isFinite(totalMiles) && totalMiles > 0 && routeEndMiles > 0
      ? (clamp(currentMiles / totalMiles, 0, 1) * routeEndMiles)
      : currentMiles;

  if (targetMiles <= Number(route[0].miles)) {
    return route[0];
  }

  for (let index = 0; index < route.length - 1; index += 1) {
    const start = route[index];
    const end = route[index + 1];
    const startMiles = Number(start.miles);
    const endMiles = Number(end.miles);

    if (targetMiles <= endMiles) {
      const segmentProgress =
        endMiles === startMiles
          ? 0
          : clamp((targetMiles - startMiles) / (endMiles - startMiles), 0, 1);

      return {
        lat: Number(start.lat) + (Number(end.lat) - Number(start.lat)) * segmentProgress,
        lng: Number(start.lng) + (Number(end.lng) - Number(start.lng)) * segmentProgress,
        miles: targetMiles,
        segmentIndex: index,
      };
    }
  }

  return route[route.length - 1];
}

function completedRouteFor(data) {
  const route = Array.isArray(data.route) ? data.route : [];

  if (route.length <= 1) {
    return route.map(toLatLng);
  }

  const bestMatch = routePointForMiles(data);

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
  const last = route.length - 1;

  while (startIndex < last) {
    const endIndex = Math.min(startIndex + TRAIL_SEGMENT_SIZE, last);
    const t = last === 0 ? 0 : (startIndex + endIndex) / 2 / last;

    segments.push({
      color: trailColorAt(t),
      points: route.slice(startIndex, endIndex + 1),
    });

    startIndex = endIndex;
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
  const routePoint = routePointForMiles(data);
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

  const boundsPoints = [...completedRoute, toLatLng(routePoint)];

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
