"use strict";

const TIME_ZONE = "Europe/Bucharest";
const SAMPLE_QUERY_KEY = "sample";
const WEATHER_URL = new URL("https://api.open-meteo.com/v1/forecast");
const SAMPLE_DATA_URL = "data/weather.sample.json";

WEATHER_URL.search = new URLSearchParams({
  latitude: "44.4268",
  longitude: "26.1025",
  current: "temperature_2m,uv_index",
  hourly: "temperature_2m,uv_index",
  past_hours: "12",
  forecast_hours: "37",
  timezone: TIME_ZONE,
}).toString();

const state = {
  weather: null,
  charts: [],
};

const els = {
  currentTemp: document.getElementById("current-temp"),
  currentUv: document.getElementById("current-uv"),
  updatedStatus: document.getElementById("updated-status"),
  themeToggle: document.getElementById("theme-toggle"),
  themeToggleLabel: document.getElementById("theme-toggle-label"),
  weatherSourceLink: document.getElementById("weather-source-link"),
  dialog: document.getElementById("point-dialog"),
  dialogMetric: document.getElementById("dialog-metric"),
  dialogValue: document.getElementById("dialog-value"),
  dialogTime: document.getElementById("dialog-time"),
};

const formatLongDate = new Intl.DateTimeFormat("en-GB", {
  timeZone: "UTC",
  weekday: "short",
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

const formatUpdated = new Intl.DateTimeFormat("en-GB", {
  timeZone: TIME_ZONE,
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

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
  return String(Math.round(value));
}

function setStatus(message, isError = false) {
  els.updatedStatus.textContent = message;
  els.updatedStatus.classList.toggle("is-error", isError);
}

function toFiniteNumber(value) {
  if (value === null || value === undefined || value === "") {
    return NaN;
  }
  const number = Number(value);
  return Number.isFinite(number) ? number : NaN;
}

function parseOpenMeteoLocalTime(value) {
  if (!value || typeof value !== "string") {
    return null;
  }
  const cleaned = value.replace(/\.\d+$/, "");
  const withSeconds = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(cleaned)
    ? `${cleaned}:00`
    : cleaned;
  const date = new Date(`${withSeconds}Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function normalizeOpenMeteoWeather(payload) {
  if (!payload || typeof payload !== "object") {
    throw new Error("Weather data is empty.");
  }

  const times = Array.isArray(payload.hourly?.time) ? payload.hourly.time : [];
  const temperatures = Array.isArray(payload.hourly?.temperature_2m)
    ? payload.hourly.temperature_2m
    : [];
  const uvIndexes = Array.isArray(payload.hourly?.uv_index)
    ? payload.hourly.uv_index
    : [];

  const hourly = times
    .map((time, index) => ({
      forecastStart: time,
      temperature: toFiniteNumber(temperatures[index]),
      uvIndex: toFiniteNumber(uvIndexes[index]),
    }))
    .filter((hour) => Number.isFinite(hour.temperature) || Number.isFinite(hour.uvIndex));

  if (!hourly.length) {
    throw new Error("No hourly Open-Meteo points were found.");
  }

  return {
    generatedAt: new Date().toISOString(),
    source: "Open-Meteo",
    location: {
      name: "Bucharest, Romania",
      latitude: payload.latitude ?? 44.4268,
      longitude: payload.longitude ?? 26.1025,
      timezone: payload.timezone || TIME_ZONE,
    },
    current: {
      asOf: payload.current?.time || null,
      temperature: toFiniteNumber(payload.current?.temperature_2m),
      uvIndex: toFiniteNumber(payload.current?.uv_index),
    },
    hourly,
    attribution: {
      serviceName: "Open-Meteo",
      legalPageURL: "https://open-meteo.com/",
    },
  };
}

function isSampleMode() {
  return new URLSearchParams(window.location.search).has(SAMPLE_QUERY_KEY);
}

async function fetchWeather() {
  const url = isSampleMode() ? SAMPLE_DATA_URL : WEATHER_URL.toString();
  const response = await fetch(url, {
    headers: { Accept: "application/json" },
  });

  if (!response.ok) {
    throw new Error(`Weather data request failed with ${response.status}.`);
  }

  return normalizeOpenMeteoWeather(await response.json());
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
  const label = formatUpdated.format(generatedAt);
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
}

function openPointDialog(metric, value, isoTime, suffix) {
  els.dialogMetric.textContent = metric;
  els.dialogValue.textContent = suffix ? `${value} ${suffix}` : String(value);
  const date = parseOpenMeteoLocalTime(isoTime);
  els.dialogTime.textContent = date ? formatLongDate.format(date) : isoTime;

  if (typeof els.dialog.showModal === "function") {
    els.dialog.showModal();
  } else {
    els.dialog.setAttribute("open", "");
  }
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
          borderColor: config.color,
          backgroundColor: config.fill,
          borderWidth: 3,
          pointRadius: 3,
          pointHoverRadius: 6,
          pointBackgroundColor: cssVar("--surface"),
          pointBorderColor: config.color,
          pointBorderWidth: 2,
          tension: 0.28,
          fill: true,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        mode: "nearest",
        intersect: false,
      },
      onClick(event, _elements, chart) {
        const points = chart.getElementsAtEventForMode(
          event,
          "nearest",
          { intersect: false },
          true,
        );
        if (!points.length) {
          return;
        }
        const index = points[0].index;
        const source = hourly[index];
        const rawValue = source[config.key];
        const value = Number.isFinite(rawValue)
          ? config.key === "temperature"
            ? Math.round(rawValue * 10) / 10
            : Math.round(rawValue)
          : "--";
        openPointDialog(
          config.label,
          value,
          source.forecastStart,
          value === "--" ? "" : config.suffix,
        );
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
  state.charts = [
    buildChart("temperature-chart", hourly, {
      key: "temperature",
      label: "Temperature",
      suffix: "C",
      color: cssVar("--accent"),
      fill: "rgba(98, 214, 196, 0.16)",
      beginAtZero: false,
    }),
    buildChart("uv-chart", hourly, {
      key: "uvIndex",
      label: "UV Index",
      suffix: "",
      color: cssVar("--warm"),
      fill: "rgba(246, 184, 75, 0.18)",
      beginAtZero: true,
      suggestedMax: 11,
    }),
  ];
}

async function init() {
  setTheme(activeTheme());
  applyAttribution();
  els.themeToggle.addEventListener("click", () => {
    setTheme(activeTheme() === "dark" ? "light" : "dark");
  });

  try {
    const weather = await fetchWeather();
    state.weather = weather;
    renderCurrent(weather);
    renderCharts(weather.hourly);
  } catch (error) {
    els.currentTemp.textContent = "--";
    els.currentUv.textContent = "--";
    setStatus(
      isSampleMode()
        ? "Sample data could not be loaded."
        : "Weather data is not available right now. Please try again shortly.",
      true,
    );
    console.error(error);
  }
}

window.addEventListener("DOMContentLoaded", init);
