const routeStyle = {
  color: "#1f7a5b",
  weight: 5,
  opacity: 0.9,
};

const completedStyle = {
  color: "#cb4b35",
  weight: 6,
  opacity: 0.95,
};

const REFRESH_INTERVAL_MS = 10 * 60 * 1000;

const mapState = {
  map: null,
  layers: [],
};

const formatMiles = (value) =>
  new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

function toLatLng(point) {
  return [point.lat, point.lng];
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
  const count = document.querySelector("#goals-count");
  const completed = goals.filter((goal) => goal.done).length;

  list.innerHTML = "";
  count.textContent = `${completed}/${goals.length}`;

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

  instagramLink.href = instagramUrl;
  facebookLink.href = facebookUrl;
  venmoLink.href = venmoUrl;

  instagramLink.onclick = (event) => {
    event.preventDefault();
    window.location.assign(instagramUrl);
  };
  facebookLink.onclick = (event) => {
    event.preventDefault();
    window.location.assign(facebookUrl);
  };
  venmoLink.onclick = (event) => {
    event.preventDefault();
    window.location.assign(venmoUrl);
  };
}

function renderStats(data) {
  const progress = clamp(data.current.miles / data.totalMiles, 0, 1);
  const percent = Math.round(progress * 100);

  document.title = `${percent}% complete - ${data.title}`;
  document.querySelector("#ride-title").textContent = data.title;
  document.querySelector("#ride-subtitle").textContent =
    data.subtitle || "Following the road east.";
  document.querySelector("#ride-status").textContent = data.status;
  document.querySelector("#ride-clock").textContent = formatDuration(data.startedAt);
  document.querySelector("#current-place").textContent = data.current.place;
  document.querySelector("#last-updated").textContent =
    `Last updated ${data.current.updatedAt}`;
  document.querySelector("#miles-ridden").textContent = formatMiles(
    data.current.miles,
  );
  document.querySelector("#miles-left").textContent = formatMiles(
    Math.max(data.totalMiles - data.current.miles, 0),
  );
  document.querySelector("#progress-percent").textContent = `${percent}%`;
  document.querySelector("#progress-fill").style.width = `${percent}%`;

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

  const route = data.route.map(toLatLng);
  const completedRoute = completedRouteFor(data, progress);
  const routePoint = closestPointOnRoute(data.current, data.route);

  mapState.layers.push(L.polyline(route, routeStyle).addTo(mapState.map));
  mapState.layers.push(L.polyline(completedRoute, completedStyle).addTo(mapState.map));

  const markerIcon = L.divIcon({
    className: "ride-marker",
    iconSize: [34, 34],
    iconAnchor: [17, 17],
  });
  const marker = L.marker(toLatLng(routePoint), { icon: markerIcon }).addTo(
    mapState.map,
  );
  marker.bindPopup(`<strong>${data.current.place}</strong><br>${data.current.updatedAt}`);
  mapState.layers.push(marker);

  const bounds = L.latLngBounds([...route, ...completedRoute]);
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
  document.querySelector("#ride-status").textContent = "Needs data";
  document.querySelector("#current-place").textContent = "Could not load tracker";
  document.querySelector("#last-updated").textContent = error.message;
});
