"use strict";

const SAMPLE_QUERY_KEY = "sample";
const SAMPLE_DATA_URL = "data/weather.sample.json";
const LOCATION_STORAGE_KEY = "weather-location-v1";
const GEOCODING_ENDPOINT = "https://geocoding-api.open-meteo.com/v1/search";
const WEATHER_ENDPOINT = "https://api.open-meteo.com/v1/forecast";
const MIN_SEARCH_LENGTH = 2;
const MAX_RESULTS = 6;

const BUCHAREST_LOCATION = Object.freeze({
  id: "bucharest-ro",
  name: "Bucharest",
  admin1: "Bucharest",
  country: "Romania",
  latitude: 44.4268,
  longitude: 26.1025,
  timezone: "Europe/Bucharest",
});

const state = {
  weather: null,
  charts: [],
  chartMeta: new Map(),
  selectedLocation: null,
  searchQuery: "",
  searchResults: [],
  searchRequestId: 0,
  searchController: null,
  searchTimer: null,
  forecastRequestId: 0,
  forecastController: null,
  pickerOpen: false,
  activeResultIndex: -1,
  deviceSuggestion: null,
  selectionLoading: false,
};

const els = {
  currentTemp: document.getElementById("current-temp"),
  currentUv: document.getElementById("current-uv"),
  updatedStatus: document.getElementById("updated-status"),
  themeToggle: document.getElementById("theme-toggle"),
  themeToggleLabel: document.getElementById("theme-toggle-label"),
  weatherSourceLink: document.getElementById("weather-source-link"),
  selectedLocationName: document.getElementById("selected-location-name"),
  locationPicker: document.getElementById("location-picker"),
  locationTrigger: document.getElementById("location-trigger"),
  locationPopover: document.getElementById("location-popover"),
  locationSearch: document.getElementById("location-search"),
  locationResults: document.getElementById("location-results"),
  searchStatus: document.getElementById("search-status"),
  bucharestOption: document.getElementById("bucharest-option"),
  deviceLocation: document.getElementById("device-location"),
  deviceSuggestion: document.getElementById("device-suggestion"),
  geolocationStatus: document.getElementById("geolocation-status"),
  selectionStatus: document.getElementById("selection-status"),
};

const COLOR_BANDS = {
  temperature: [
    { max: 20.999, line: "#38a6f8", fill: "rgba(56, 166, 248, 0.22)" },
    { max: 23.999, line: "#31b871", fill: "rgba(49, 184, 113, 0.22)" },
    { max: 27.999, line: "#f2c94c", fill: "rgba(242, 201, 76, 0.24)" },
    { max: 30.999, line: "#f2994a", fill: "rgba(242, 153, 74, 0.25)" },
    { max: Infinity, line: "#eb5757", fill: "rgba(235, 87, 87, 0.26)" },
  ],
  uvIndex: [
    { max: 2.999, line: "#31b871", fill: "rgba(49, 184, 113, 0.23)" },
    { max: 5.999, line: "#f2c94c", fill: "rgba(242, 201, 76, 0.25)" },
    { max: 7.999, line: "#f2994a", fill: "rgba(242, 153, 74, 0.26)" },
    { max: Infinity, line: "#eb5757", fill: "rgba(235, 87, 87, 0.28)" },
  ],
};

const guideLinePlugin = {
  id: "guideLine",
  afterDatasetsDraw(chart) {
    const index = chart.$activeIndex;
    if (!Number.isInteger(index) || index < 0) {
      return;
    }

    const { ctx, chartArea, scales } = chart;
    const x = scales.x.getPixelForValue(index);
    if (!Number.isFinite(x)) {
      return;
    }

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(x, chartArea.top);
    ctx.lineTo(x, chartArea.bottom);
    ctx.lineWidth = 2;
    ctx.strokeStyle = cssVar("--text");
    ctx.setLineDash([5, 5]);
    ctx.stroke();
    ctx.restore();
  },
};

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function activeTheme() {
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}

function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem("weather-theme", theme);
  els.themeToggle.setAttribute(
    "aria-label",
    theme === "dark" ? "Switch to light theme" : "Switch to dark theme",
  );
  els.themeToggleLabel.textContent = theme === "dark" ? "Dark" : "Light";
  if (state.weather) {
    renderCharts(state.weather.hourly);
  }
}

function roundedTemperature(value) {
  if (!Number.isFinite(value)) {
    return "--";
  }
  return `${Math.round(value * 10) / 10} C`;
}

function roundedUv(value) {
  if (!Number.isFinite(value)) {
    return "--";
  }
  return value.toFixed(1);
}

function setStatus(message, isError = false) {
  els.updatedStatus.textContent = message;
  els.updatedStatus.classList.toggle("is-error", isError);
}

function toFiniteNumber(value) {
  if (value === null || value === undefined || value === "") return NaN;
  const number = Number(value);
  return Number.isFinite(number) ? number : NaN;
}

function isValidLocation(location) {
  return Boolean(location && typeof location === "object" &&
    ["id", "name", "country", "timezone"].every((key) =>
      typeof location[key] === "string" && location[key].trim()) &&
    Number.isFinite(location.latitude) && location.latitude >= -90 && location.latitude <= 90 &&
    Number.isFinite(location.longitude) && location.longitude >= -180 && location.longitude <= 180 &&
    (location.admin1 === undefined || typeof location.admin1 === "string"));
}

function canonicalLocation(location) {
  const normalized = {
    id: String(location?.id || ""), name: String(location?.name || ""),
    country: String(location?.country || ""), latitude: Number(location?.latitude),
    longitude: Number(location?.longitude), timezone: String(location?.timezone || ""),
  };
  if (location?.admin1) normalized.admin1 = String(location.admin1);
  return normalized;
}

function loadStoredLocation() {
  try {
    const parsed = JSON.parse(localStorage.getItem(LOCATION_STORAGE_KEY));
    if (parsed?.version !== 1 || !isValidLocation(parsed.location)) return null;
    return canonicalLocation(parsed.location);
  } catch { return null; }
}

function saveStoredLocation(location) {
  if (!isValidLocation(location)) return false;
  try {
    localStorage.setItem(LOCATION_STORAGE_KEY, JSON.stringify({ version: 1, location: canonicalLocation(location) }));
    return true;
  } catch { return false; }
}

function locationLabel(location) {
  return [...new Set([location.name, location.admin1, location.country].filter(Boolean))].join(", ");
}

function buildWeatherUrl(location) {
  if (!isValidLocation(location)) throw new Error("Invalid location.");
  const url = new URL(WEATHER_ENDPOINT);
  url.search = new URLSearchParams({
    latitude: String(location.latitude), longitude: String(location.longitude),
    current: "temperature_2m,uv_index", hourly: "temperature_2m,uv_index",
    past_hours: "12", forecast_hours: "37", timezone: location.timezone,
  }).toString();
  return url;
}

function buildGeocodingUrl(query) {
  const url = new URL(GEOCODING_ENDPOINT);
  url.search = new URLSearchParams({ name: query.trim(), count: String(MAX_RESULTS), language: "en", format: "json" }).toString();
  return url;
}

function parseOpenMeteoLocalTime(value) {
  if (typeof value !== "string") return null;
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!match) return null;
  return { year: +match[1], month: +match[2], day: +match[3], hour: +match[4], minute: +match[5], second: +(match[6] || 0), value };
}

function wallClockValue(value) {
  const part = parseOpenMeteoLocalTime(value);
  return part ? Date.UTC(part.year, part.month - 1, part.day, part.hour, part.minute, part.second) : NaN;
}

function normalizeOpenMeteoWeather(payload, requestedLocation) {
  if (!payload || typeof payload !== "object") throw new Error("Weather data is empty.");
  const times = Array.isArray(payload.hourly?.time) ? payload.hourly.time : [];
  const temperatures = Array.isArray(payload.hourly?.temperature_2m) ? payload.hourly.temperature_2m : [];
  const uvIndexes = Array.isArray(payload.hourly?.uv_index) ? payload.hourly.uv_index : [];
  const hourly = times.map((time, index) => ({ forecastStart: time, temperature: toFiniteNumber(temperatures[index]), uvIndex: toFiniteNumber(uvIndexes[index]) }))
    .filter((hour) => Number.isFinite(hour.temperature) || Number.isFinite(hour.uvIndex));
  if (!hourly.length) throw new Error("No hourly Open-Meteo points were found.");
  const timezone = typeof payload.timezone === "string" && payload.timezone ? payload.timezone : requestedLocation.timezone;
  return {
    generatedAt: new Date().toISOString(), source: "Open-Meteo",
    location: { ...requestedLocation, latitude: toFiniteNumber(payload.latitude) || requestedLocation.latitude, longitude: toFiniteNumber(payload.longitude) || requestedLocation.longitude, timezone },
    current: { asOf: payload.current?.time || null, temperature: toFiniteNumber(payload.current?.temperature_2m), uvIndex: toFiniteNumber(payload.current?.uv_index) },
    hourly, attribution: { serviceName: "Open-Meteo", legalPageURL: "https://open-meteo.com/" },
  };
}

function isSampleMode() { return new URLSearchParams(window.location.search).has(SAMPLE_QUERY_KEY); }

async function fetchWeather(location, signal) {
  const url = isSampleMode() ? SAMPLE_DATA_URL : buildWeatherUrl(location).toString();
  const response = await fetch(url, { headers: { Accept: "application/json" }, signal });
  if (!response.ok) throw new Error(`Weather data request failed with ${response.status}.`);
  return normalizeOpenMeteoWeather(await response.json(), isSampleMode() ? BUCHAREST_LOCATION : location);
}

function safeDateFormatter(options, timezone) {
  try { return new Intl.DateTimeFormat("en-GB", { ...options, timeZone: timezone === "auto" ? "UTC" : timezone }); }
  catch { return new Intl.DateTimeFormat("en-GB", { ...options, timeZone: "UTC" }); }
}

function renderCurrent(weather) {
  els.currentTemp.textContent = roundedTemperature(weather.current.temperature);
  els.currentUv.textContent = roundedUv(weather.current.uvIndex);

  if (isSampleMode()) {
    setStatus("Showing sample data for local testing.");
    return;
  }

  const generatedAt = weather.generatedAt ? new Date(weather.generatedAt) : null;
  if (!generatedAt || Number.isNaN(generatedAt.getTime())) {
    setStatus("Loaded weather data. Update time is unavailable.");
    return;
  }

  const ageMinutes = Math.max(0, Math.round((Date.now() - generatedAt.getTime()) / 60000));
  const stale = ageMinutes > 120;
  const timezone = weather.location.timezone;
  const label = safeDateFormatter({ day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", timeZoneName: "short" }, timezone).format(generatedAt);
  setStatus(
    stale
      ? `Last updated ${label}. Data may be stale.`
      : `Last updated ${label}.`,
    stale,
  );
}

function applyAttribution() {
  els.weatherSourceLink.href = "https://open-meteo.com/";
  els.weatherSourceLink.textContent = "Weather data by Open-Meteo";
}

function destroyCharts() {
  for (const chart of state.charts) {
    chart.destroy();
  }
  state.charts = [];
  state.chartMeta.clear();
}

function formatPointTime(isoTime) {
  const part = parseOpenMeteoLocalTime(isoTime);
  if (!part) return isoTime;
  const proxy = new Date(Date.UTC(part.year, part.month - 1, part.day, part.hour, part.minute));
  return safeDateFormatter({ weekday: "short", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }, "UTC").format(proxy);
}

function formatMetricValue(value, config) {
  if (!Number.isFinite(value)) {
    return "--";
  }
  const rounded = config.key === "temperature"
    ? Math.round(value * 10) / 10
    : value.toFixed(1);
  return config.suffix ? `${rounded} ${config.suffix}` : String(rounded);
}

function bandForValue(value, key, colorType = "line") {
  const bands = COLOR_BANDS[key] || [];
  const band = bands.find((entry) => value <= entry.max) || bands.at(-1);
  return band ? band[colorType] : cssVar("--accent");
}

function segmentColor(config) {
  return (context) => {
    const first = context.p0.parsed.y;
    const second = context.p1.parsed.y;
    const value = Number.isFinite(first) && Number.isFinite(second)
      ? (first + second) / 2
      : first;
    return bandForValue(value, config.key);
  };
}

function createBandGradient(context, config) {
  const chart = context.chart;
  const { chartArea, scales } = chart;
  if (!chartArea) {
    return bandForValue(0, config.key, "fill");
  }

  const gradient = chart.ctx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
  const bands = COLOR_BANDS[config.key] || [];
  const min = scales.y.min;
  const max = scales.y.max;
  const range = max - min || 1;

  const stops = [
    { value: max, color: bandForValue(max, config.key, "fill") },
    ...bands
      .filter((band) => Number.isFinite(band.max) && band.max > min && band.max < max)
      .flatMap((band) => [
        { value: band.max + 0.001, color: bandForValue(band.max + 0.001, config.key, "fill") },
        { value: band.max, color: band.fill },
      ]),
    { value: min, color: bandForValue(min, config.key, "fill") },
  ];

  stops
    .sort((a, b) => b.value - a.value)
    .forEach((stop) => {
      const offset = Math.min(1, Math.max(0, (max - stop.value) / range));
      gradient.addColorStop(offset, stop.color);
    });

  return gradient;
}

function nearestIndexForCurrent(hourly, currentTime) {
  const target = wallClockValue(currentTime);
  if (!Number.isFinite(target)) {
    return 0;
  }

  let nearest = 0;
  let nearestDistance = Infinity;
  hourly.forEach((hour, index) => {
    const time = wallClockValue(hour.forecastStart);
    if (!Number.isFinite(time)) {
      return;
    }
    const distance = Math.abs(time - target);
    if (distance < nearestDistance) {
      nearest = index;
      nearestDistance = distance;
    }
  });
  return nearest;
}

function updateReadout(chart, index) {
  const meta = state.chartMeta.get(chart);
  if (!meta) {
    return;
  }

  const clampedIndex = Math.min(Math.max(index, 0), meta.hourly.length - 1);
  const point = meta.hourly[clampedIndex];
  meta.timeEl.textContent = formatPointTime(point.forecastStart);
  meta.valueEl.textContent = formatMetricValue(point[meta.config.key], meta.config);
  chart.$activeIndex = clampedIndex;
  chart.update("none");
}

function resetReadout(chart) {
  const meta = state.chartMeta.get(chart);
  if (!meta) {
    return;
  }
  updateReadout(chart, meta.defaultIndex);
}

function indexFromPointer(chart, clientX) {
  const x = clientX - chart.canvas.getBoundingClientRect().left;
  const rawIndex = chart.scales.x.getValueForPixel(x);
  const index = Math.round(Number(rawIndex));
  if (!Number.isFinite(index)) {
    return null;
  }
  return Math.min(Math.max(index, 0), chart.data.labels.length - 1);
}

function wireChartPointerEvents(chart) {
  let dragging = false;

  chart.canvas.addEventListener("pointermove", (event) => {
    if (event.pointerType !== "mouse" && !dragging) {
      return;
    }
    const index = indexFromPointer(chart, event.clientX);
    if (index !== null) {
      updateReadout(chart, index);
    }
  });

  chart.canvas.addEventListener("pointerdown", (event) => {
    dragging = true;
    chart.canvas.setPointerCapture(event.pointerId);
    const index = indexFromPointer(chart, event.clientX);
    if (index !== null) {
      updateReadout(chart, index);
    }
  });

  chart.canvas.addEventListener("pointerup", (event) => {
    dragging = false;
    if (chart.canvas.hasPointerCapture(event.pointerId)) {
      chart.canvas.releasePointerCapture(event.pointerId);
    }
    resetReadout(chart);
  });

  chart.canvas.addEventListener("pointercancel", () => {
    dragging = false;
    resetReadout(chart);
  });

  chart.canvas.addEventListener("pointerleave", () => {
    if (!dragging) {
      resetReadout(chart);
    }
  });
}

function buildChart(canvasId, hourly, config) {
  const ctx = document.getElementById(canvasId);
  const labels = hourly.map((hour) => hour.forecastStart.slice(11, 16));
  const values = hourly.map((hour) =>
    Number.isFinite(hour[config.key]) ? hour[config.key] : null,
  );
  const textColor = cssVar("--text");
  const mutedColor = cssVar("--muted");
  const gridColor = cssVar("--line");

  return new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          data: values,
          borderColor: bandForValue(0, config.key),
          backgroundColor(context) {
            return createBandGradient(context, config);
          },
          borderWidth: 3,
          pointRadius: 3,
          pointHoverRadius: 6,
          pointBackgroundColor: cssVar("--surface"),
          pointBorderColor(context) {
            return bandForValue(context.parsed?.y ?? 0, config.key);
          },
          pointBorderWidth: 2,
          segment: {
            borderColor: segmentColor(config),
          },
          tension: 0.28,
          fill: true,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        axis: "x",
        mode: "index",
        intersect: false,
      },
      scales: {
        x: {
          grid: {
            color: gridColor,
            tickColor: gridColor,
          },
          ticks: {
            color: mutedColor,
            maxRotation: 0,
            autoSkip: true,
            autoSkipPadding: 18,
          },
        },
        y: {
          beginAtZero: config.beginAtZero,
          suggestedMax: config.suggestedMax,
          grid: {
            color: gridColor,
          },
          ticks: {
            color: mutedColor,
            callback(value) {
              return config.key === "temperature" ? `${value} C` : value;
            },
          },
        },
      },
      plugins: {
        legend: {
          display: false,
        },
        tooltip: {
          enabled: false,
        },
      },
      color: textColor,
    },
  });
}

function renderCharts(hourly) {
  destroyCharts();
  const defaultIndex = nearestIndexForCurrent(hourly, state.weather?.current?.asOf);
  const chartConfigs = [
    {
      canvasId: "temperature-chart",
      key: "temperature",
      label: "Temperature",
      suffix: "C",
      timeEl: document.getElementById("temperature-readout-time"),
      valueEl: document.getElementById("temperature-readout-value"),
      beginAtZero: false,
    },
    {
      canvasId: "uv-chart",
      key: "uvIndex",
      label: "UV Index",
      suffix: "",
      timeEl: document.getElementById("uv-readout-time"),
      valueEl: document.getElementById("uv-readout-value"),
      beginAtZero: true,
      suggestedMax: 11,
    },
  ];

  state.charts = chartConfigs.map((config) => {
    const chart = buildChart(config.canvasId, hourly, config);
    state.chartMeta.set(chart, {
      config,
      defaultIndex,
      hourly,
      timeEl: config.timeEl,
      valueEl: config.valueEl,
    });
    updateReadout(chart, defaultIndex);
    wireChartPointerEvents(chart);
    return chart;
  });
}

function setPickerOpen(open) {
  state.pickerOpen = open;
  els.locationPopover.hidden = !open;
  els.locationTrigger.setAttribute("aria-expanded", String(open));
  if (open) requestAnimationFrame(() => els.locationSearch.focus());
  else { els.locationSearch.setAttribute("aria-activedescendant", ""); els.locationTrigger.focus(); }
}

function setSelectionLoading(loading) {
  state.selectionLoading = loading;
  els.locationPopover.setAttribute("aria-busy", String(loading));
  els.locationTrigger.classList.toggle("is-loading", loading);
}

function renderSearchResults() {
  els.locationResults.replaceChildren();
  state.searchResults.forEach((location, index) => {
    const button = document.createElement("button");
    button.type = "button"; button.role = "option"; button.id = `location-result-${index}`;
    button.className = "location-option"; button.dataset.index = String(index);
    button.setAttribute("aria-selected", String(index === state.activeResultIndex));
    button.textContent = locationLabel(location);
    button.addEventListener("click", () => selectLocation(location, { persist: true }));
    els.locationResults.append(button);
  });
  els.locationSearch.setAttribute("aria-expanded", String(state.pickerOpen && state.searchResults.length > 0));
}

async function searchLocations(query) {
  const requestId = ++state.searchRequestId;
  state.searchController?.abort();
  state.searchController = new AbortController();
  els.searchStatus.textContent = "Searching…";
  try {
    const response = await fetch(buildGeocodingUrl(query), { signal: state.searchController.signal });
    if (!response.ok) throw new Error(String(response.status));
    const payload = await response.json();
    if (requestId !== state.searchRequestId) return;
    state.searchResults = (payload.results || []).map((result) => canonicalLocation({
      id: `open-meteo-${result.id}`, name: result.name, admin1: result.admin1,
      country: result.country, latitude: result.latitude, longitude: result.longitude,
      timezone: result.timezone,
    })).filter(isValidLocation).slice(0, MAX_RESULTS);
    state.activeResultIndex = -1; renderSearchResults();
    els.searchStatus.textContent = state.searchResults.length ? `${state.searchResults.length} locations found.` : "No matching locations found.";
  } catch (error) {
    if (error.name === "AbortError") return;
    if (requestId === state.searchRequestId) { state.searchResults = []; renderSearchResults(); els.searchStatus.textContent = "Search is unavailable. Try again."; els.searchStatus.classList.add("is-error"); }
  }
}

async function selectLocation(location, { persist = false } = {}) {
  if (!isValidLocation(location)) return;
  if (isSampleMode()) { els.selectionStatus.textContent = "Sample mode always uses the Bucharest fixture."; return; }
  const requestId = ++state.forecastRequestId;
  state.forecastController?.abort(); state.forecastController = new AbortController();
  setSelectionLoading(true); els.selectionStatus.textContent = `Loading ${locationLabel(location)}…`; setStatus(`Loading weather for ${locationLabel(location)}…`);
  try {
    const weather = await fetchWeather(location, state.forecastController.signal);
    if (requestId !== state.forecastRequestId) return;
    state.selectedLocation = canonicalLocation(location); state.weather = weather;
    if (persist) saveStoredLocation(state.selectedLocation);
    els.selectedLocationName.textContent = locationLabel(state.selectedLocation);
    els.selectionStatus.textContent = `${locationLabel(state.selectedLocation)} selected.`;
    renderCurrent(weather); renderCharts(weather.hourly); renderSearchResults(); setPickerOpen(false);
  } catch (error) {
    if (error.name !== "AbortError" && requestId === state.forecastRequestId) {
      els.selectionStatus.textContent = `Could not load ${locationLabel(location)}. Your previous weather is still shown.`;
      setStatus(state.weather ? "Location update failed. Previously loaded weather remains available." : "Weather data is not available right now. Please retry.", true);
      console.error(error);
    }
  } finally { if (requestId === state.forecastRequestId) setSelectionLoading(false); }
}

function requestDeviceLocation() {
  if (!navigator.geolocation) { els.geolocationStatus.textContent = "Geolocation is not supported by this browser."; return; }
  els.deviceLocation.disabled = true; els.geolocationStatus.textContent = "Waiting for location permission…";
  navigator.geolocation.getCurrentPosition(({ coords }) => {
    els.deviceLocation.disabled = false;
    const suggestion = canonicalLocation({ id: `device-${coords.latitude.toFixed(5)}-${coords.longitude.toFixed(5)}`, name: "Current location", country: "Coordinates from this device", latitude: coords.latitude, longitude: coords.longitude, timezone: "auto" });
    if (!isValidLocation(suggestion)) { els.geolocationStatus.textContent = "The device returned invalid coordinates."; return; }
    state.deviceSuggestion = suggestion;
    els.deviceSuggestion.hidden = false; els.deviceSuggestion.replaceChildren();
    const details = document.createElement("p"); details.textContent = `${coords.latitude.toFixed(4)}, ${coords.longitude.toFixed(4)} (no city name inferred)`;
    const confirm = document.createElement("button"); confirm.type = "button"; confirm.className = "location-option"; confirm.textContent = "Select and save Current location";
    confirm.addEventListener("click", () => selectLocation(suggestion, { persist: true }));
    els.deviceSuggestion.append(details, confirm); els.geolocationStatus.textContent = "Device coordinates are ready. Confirm to load and save them.";
  }, (error) => {
    els.deviceLocation.disabled = false;
    const messages = { 1: "Location permission was denied. Your current selection is unchanged.", 2: "Your location is currently unavailable.", 3: "The location request timed out." };
    els.geolocationStatus.textContent = messages[error.code] || "The location request failed.";
  }, { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 });
}

function wirePicker() {
  els.locationTrigger.addEventListener("click", () => setPickerOpen(!state.pickerOpen));
  els.bucharestOption.addEventListener("click", () => selectLocation(BUCHAREST_LOCATION, { persist: true }));
  els.deviceLocation.addEventListener("click", requestDeviceLocation);
  els.locationSearch.addEventListener("input", () => {
    clearTimeout(state.searchTimer); state.searchQuery = els.locationSearch.value.trim(); state.searchRequestId++; state.searchController?.abort();
    els.searchStatus.classList.remove("is-error");
    if (state.searchQuery.length < MIN_SEARCH_LENGTH) { state.searchResults = []; renderSearchResults(); els.searchStatus.textContent = "Type at least 2 characters to search."; return; }
    state.searchTimer = setTimeout(() => searchLocations(state.searchQuery), 300);
  });
  els.locationSearch.addEventListener("keydown", (event) => {
    if (event.key === "Escape") { event.preventDefault(); setPickerOpen(false); return; }
    if (!["ArrowDown", "ArrowUp", "Enter"].includes(event.key) || !state.searchResults.length) return;
    event.preventDefault();
    if (event.key === "Enter" && state.activeResultIndex >= 0) { selectLocation(state.searchResults[state.activeResultIndex], { persist: true }); return; }
    state.activeResultIndex = event.key === "ArrowDown" ? (state.activeResultIndex + 1) % state.searchResults.length : (state.activeResultIndex - 1 + state.searchResults.length) % state.searchResults.length;
    els.locationSearch.setAttribute("aria-activedescendant", `location-result-${state.activeResultIndex}`); renderSearchResults();
  });
  document.addEventListener("keydown", (event) => { if (event.key === "Escape" && state.pickerOpen) setPickerOpen(false); });
  document.addEventListener("pointerdown", (event) => { if (state.pickerOpen && !els.locationPicker.contains(event.target)) setPickerOpen(false); });
}

async function init() {
  Chart.register(guideLinePlugin); setTheme(activeTheme()); applyAttribution(); wirePicker();
  els.themeToggle.addEventListener("click", () => setTheme(activeTheme() === "dark" ? "light" : "dark"));
  if (isSampleMode()) {
    state.selectedLocation = BUCHAREST_LOCATION; els.selectedLocationName.textContent = "Bucharest, Romania · Sample fixture";
    els.locationTrigger.disabled = true; els.locationTrigger.textContent = "Locations unavailable in sample mode";
    try { const weather = await fetchWeather(BUCHAREST_LOCATION); state.weather = weather; renderCurrent(weather); renderCharts(weather.hourly); }
    catch (error) { setStatus("Sample data could not be loaded.", true); console.error(error); }
    return;
  }
  const initial = loadStoredLocation() || BUCHAREST_LOCATION;
  state.selectedLocation = initial; els.selectedLocationName.textContent = locationLabel(initial);
  await selectLocation(initial, { persist: false });
}

window.addEventListener("DOMContentLoaded", init);
