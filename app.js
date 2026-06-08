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
  chartMeta: new Map(),
};

const els = {
  currentTemp: document.getElementById("current-temp"),
  currentUv: document.getElementById("current-uv"),
  updatedStatus: document.getElementById("updated-status"),
  themeToggle: document.getElementById("theme-toggle"),
  themeToggleLabel: document.getElementById("theme-toggle-label"),
  weatherSourceLink: document.getElementById("weather-source-link"),
};

const formatReadoutTime = new Intl.DateTimeFormat("en-GB", {
  timeZone: "UTC",
  weekday: "short",
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

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
  return value.toFixed(1);
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
  state.chartMeta.clear();
}

function formatPointTime(isoTime) {
  const date = parseOpenMeteoLocalTime(isoTime);
  return date ? formatReadoutTime.format(date) : isoTime;
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
  const target = parseOpenMeteoLocalTime(currentTime)?.getTime();
  if (!Number.isFinite(target)) {
    return 0;
  }

  let nearest = 0;
  let nearestDistance = Infinity;
  hourly.forEach((hour, index) => {
    const time = parseOpenMeteoLocalTime(hour.forecastStart)?.getTime();
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

async function init() {
  Chart.register(guideLinePlugin);
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
