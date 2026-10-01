/* =========================================================
   SKYCAST — Weather Dashboard
   Data: Open-Meteo (free, no API key needed)
   ========================================================= */

const API = {
  geocode: "https://geocoding-api.open-meteo.com/v1/search",
  forecast: "https://api.open-meteo.com/v1/forecast",
  reverse: "https://api.bigdatacloud.net/data/reverse-geocode-client",
};

const DEFAULT_PLACE = {
  name: "Dar es Salaam",
  country: "Tanzania",
  latitude: -6.82349,
  longitude: 39.26951,
};

const $ = (sel) => document.querySelector(sel);

/* ---------- Safe localStorage helpers ---------- */
function storageGet(key) {
  try {
    return JSON.parse(localStorage.getItem(`skycast:${key}`));
  } catch (e) {
    return null;
  }
}
function storageSet(key, value) {
  try {
    localStorage.setItem(`skycast:${key}`, JSON.stringify(value));
  } catch (e) {}
}
const storage = { get: storageGet, set: storageSet };

const state = {
  place: null,
  unit: storage.get("unit") || "celsius",
  recent: storage.get("recent") || [],
};


/* ---------- Weather codes (WMO) → label, icon, theme ---------- */
function describe(code, isDay = true) {
  const sun = isDay ? "fa-sun" : "fa-moon";
  const partly = isDay ? "fa-cloud-sun" : "fa-cloud-moon";
  const clear = isDay ? "clear-day" : "clear-night";
  const cloudy = isDay ? "cloudy" : "cloudy-night";

  const map = {
    0: ["Clear sky", sun, clear],
    1: ["Mainly clear", partly, clear],
    2: ["Partly cloudy", partly, cloudy],
    3: ["Overcast", "fa-cloud", cloudy],
    45: ["Fog", "fa-smog", "fog"],
    48: ["Rime fog", "fa-smog", "fog"],
    51: ["Light drizzle", "fa-cloud-rain", "rain"],
    53: ["Drizzle", "fa-cloud-rain", "rain"],
    55: ["Heavy drizzle", "fa-cloud-rain", "rain"],
    56: ["Freezing drizzle", "fa-cloud-rain", "rain"],
    57: ["Freezing drizzle", "fa-cloud-rain", "rain"],
    61: ["Light rain", "fa-cloud-rain", "rain"],
    63: ["Rain", "fa-cloud-showers-heavy", "rain"],
    65: ["Heavy rain", "fa-cloud-showers-heavy", "rain"],
    66: ["Freezing rain", "fa-cloud-showers-heavy", "rain"],
    67: ["Freezing rain", "fa-cloud-showers-heavy", "rain"],
    71: ["Light snow", "fa-snowflake", "snow"],
    73: ["Snow", "fa-snowflake", "snow"],
    75: ["Heavy snow", "fa-snowflake", "snow"],
    77: ["Snow grains", "fa-snowflake", "snow"],
    80: ["Rain showers", isDay ? "fa-cloud-sun-rain" : "fa-cloud-moon-rain", "rain"],
    81: ["Rain showers", "fa-cloud-showers-heavy", "rain"],
    82: ["Violent showers", "fa-cloud-showers-water", "storm"],
    85: ["Snow showers", "fa-snowflake", "snow"],
    86: ["Heavy snow showers", "fa-snowflake", "snow"],
    95: ["Thunderstorm", "fa-cloud-bolt", "storm"],
    96: ["Thunderstorm & hail", "fa-cloud-bolt", "storm"],
    99: ["Thunderstorm & hail", "fa-cloud-bolt", "storm"],
  };

  const [label, icon, theme] = map[code] || ["Unknown", "fa-cloud", cloudy];
  return { label, icon, theme };
}

/* ---------- Small helpers ---------- */
const round = (n) => Math.round(n);
const deg = () => (state.unit === "celsius" ? "°C" : "°F");
const windUnit = () => (state.unit === "celsius" ? "km/h" : "mph");

// Open-Meteo returns local times like "2026-10-01T18:00" — read them without timezone shifts
function parseLocal(iso) {
  const [date, time = "00:00"] = iso.split("T");
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  return new Date(y, m - 1, d, hh, mm);
}

function formatHour(iso) {
  const h = parseLocal(iso).getHours();
  const suffix = h >= 12 ? "PM" : "AM";
  return `${h % 12 || 12} ${suffix}`;
}

function formatClock(iso) {
  return parseLocal(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function compass(degrees) {
  const dirs = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  return dirs[Math.round(degrees / 45) % 8];
}

function uvLevel(uv) {
  if (uv < 3) return "Low";
  if (uv < 6) return "Moderate";
  if (uv < 8) return "High";
  if (uv < 11) return "Very high";
  return "Extreme";
}

function placeLabel(p) {
  return [p.name, p.admin1 && p.admin1 !== p.name ? p.admin1 : null, p.country]
    .filter(Boolean)
    .join(", ");
}

function escapeHTML(str) {
  return String(str).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

/* ---------- Status messages ---------- */
function showStatus(message, type = "loading") {
  const el = $("#status");
  el.className = `status is-visible ${type === "error" ? "is-error" : ""}`;
  el.innerHTML =
    type === "loading"
      ? `<span class="spinner"></span> ${escapeHTML(message)}`
      : `<i class="fa-solid fa-triangle-exclamation"></i> ${escapeHTML(message)}`;
}

function hideStatus() {
  $("#status").className = "status";
}

/* ---------- API calls ---------- */
async function searchCities(query) {
  const url = `${API.geocode}?name=${encodeURIComponent(query)}&count=6&language=en&format=json`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("City search failed");
  const data = await res.json();
  return data.results || [];
}

async function fetchForecast({ latitude, longitude }) {
  const params = new URLSearchParams({
    latitude,
    longitude,
    current:
      "temperature_2m,relative_humidity_2m,apparent_temperature,is_day,weather_code,pressure_msl,wind_speed_10m,wind_direction_10m",
    hourly: "temperature_2m,weather_code,precipitation_probability,is_day",
    daily:
      "weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset,uv_index_max,precipitation_probability_max",
    timezone: "auto",
    forecast_days: 7,
    temperature_unit: state.unit,
    wind_speed_unit: state.unit === "celsius" ? "kmh" : "mph",
  });
  const res = await fetch(`${API.forecast}?${params}`);
  if (!res.ok) throw new Error("Could not load the forecast");
  return res.json();
}

/* ---------- Load + render ---------- */
async function loadWeather(place) {
  state.place = place;
  storage.set("place", place);
  $("#dashboard").classList.add("is-loading");
  showStatus(`Loading weather for ${place.name}…`);

  try {
    const data = await fetchForecast(place);
    render(data, place);
    hideStatus();
    addRecent(place);
  } catch (err) {
    showStatus(`${err.message}. Check your connection and try again.`, "error");
  } finally {
    $("#dashboard").classList.remove("is-loading");
  }
}

function render(data, place) {
  const { current, hourly, daily } = data;
  const isDay = current.is_day === 1;
  const info = describe(current.weather_code, isDay);

  // Theme + animated sky
  document.body.className = `theme-${info.theme}`;
  setPrecipitation(info.theme);
  document.title = `${round(current.temperature_2m)}${deg()} · ${place.name} — SkyCast`;

  // Current
  $("#city").textContent = placeLabel(place);
  $("#localTime").textContent = parseLocal(current.time).toLocaleString([], {
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "numeric",
    minute: "2-digit",
  });
  $("#dayNight").innerHTML = isDay
    ? '<i class="fa-solid fa-sun"></i> Day'
    : '<i class="fa-solid fa-moon"></i> Night';
  $("#currentIcon").innerHTML = `<i class="fa-solid ${info.icon}"></i>`;
  $("#temp").textContent = round(current.temperature_2m);
  $("#tempUnit").textContent = deg();
  $("#desc").textContent = info.label;
  $("#hi").textContent = `${round(daily.temperature_2m_max[0])}°`;
  $("#lo").textContent = `${round(daily.temperature_2m_min[0])}°`;
  $("#feels").textContent = `${round(current.apparent_temperature)}°`;

  // Highlights
  const humidity = current.relative_humidity_2m;
  $("#humidity").textContent = `${humidity}%`;
  $("#humidityBar").style.width = `${humidity}%`;

  $("#wind").textContent = `${round(current.wind_speed_10m)} ${windUnit()}`;
  $("#windDirText").textContent = compass(current.wind_direction_10m);
  // Arrow points where the wind is blowing TO (icon's default points north-east = 45°)
  $("#windArrow").style.transform = `rotate(${current.wind_direction_10m + 180 - 45}deg)`;

  const uv = daily.uv_index_max[0] ?? 0;
  $("#uv").textContent = uv.toFixed(1);
  $("#uvText").textContent = uvLevel(uv);

  $("#pressure").textContent = round(current.pressure_msl);

  const rain = daily.precipitation_probability_max[0] ?? 0;
  $("#rainChance").textContent = `${rain}%`;
  $("#rainBar").style.width = `${rain}%`;

  $("#sunrise").textContent = formatClock(daily.sunrise[0]);
  $("#sunset").textContent = formatClock(daily.sunset[0]);
  placeSun(current.time, daily.sunrise[0], daily.sunset[0]);

  renderHourly(hourly, current.time);
  renderDaily(daily);
}

function placeSun(now, rise, set) {
  const t = parseLocal(now).getTime();
  const r = parseLocal(rise).getTime();
  const s = parseLocal(set).getTime();
  const progress = Math.min(Math.max((t - r) / (s - r), 0), 1);
  const dot = $("#sunDot");
  dot.style.left = `${progress * 100}%`;
  // Follow the arc: highest at midday
  dot.style.top = `${(1 - Math.sin(progress * Math.PI)) * 100}%`;
  dot.style.opacity = t < r || t > s ? 0.35 : 1;
}

function renderHourly(hourly, nowIso) {
  const currentHour = nowIso.slice(0, 13); // "YYYY-MM-DDTHH"
  let start = hourly.time.findIndex((t) => t.startsWith(currentHour));
  if (start < 0) start = 0;

  const html = hourly.time
    .slice(start, start + 24)
    .map((time, i) => {
      const idx = start + i;
      const info = describe(hourly.weather_code[idx], hourly.is_day[idx] === 1);
      const rain = hourly.precipitation_probability[idx];
      return `
        <div class="hour ${i === 0 ? "hour--now" : ""}" title="${info.label}">
          <span class="hour__time">${i === 0 ? "Now" : formatHour(time)}</span>
          <i class="fa-solid ${info.icon}" aria-hidden="true"></i>
          <span class="hour__temp">${round(hourly.temperature_2m[idx])}°</span>
          <span class="hour__rain">${rain > 0 ? `<i class="fa-solid fa-droplet"></i> ${rain}%` : ""}</span>
        </div>`;
    })
    .join("");

  const track = $("#hourly");
  track.innerHTML = html;
  track.scrollLeft = 0;
}

function renderDaily(daily) {
  const weekMin = Math.min(...daily.temperature_2m_min);
  const weekMax = Math.max(...daily.temperature_2m_max);
  const span = weekMax - weekMin || 1;

  $("#daily").innerHTML = daily.time
    .map((date, i) => {
      const d = parseLocal(date);
      const info = describe(daily.weather_code[i], true);
      const lo = daily.temperature_2m_min[i];
      const hi = daily.temperature_2m_max[i];
      const left = ((lo - weekMin) / span) * 100;
      const width = ((hi - lo) / span) * 100;
      const name = i === 0 ? "Today" : d.toLocaleDateString([], { weekday: "long" });
      const rain = daily.precipitation_probability_max[i] ?? 0;

      return `
        <li>
          <span class="day__name">${name}<small>${d.toLocaleDateString([], { day: "numeric", month: "short" })}</small></span>
          <i class="fa-solid ${info.icon}" title="${info.label}" aria-label="${info.label}"></i>
          <span class="day__rain"><i class="fa-solid fa-droplet" style="font-size:.75rem;color:inherit"></i> ${rain}%</span>
          <span class="day__lo">${round(lo)}°</span>
          <div class="range"><span style="left:${left}%;width:${Math.max(width, 4)}%"></span></div>
          <span class="day__hi">${round(hi)}°</span>
        </li>`;
    })
    .join("");
}

/* ---------- Rain / snow particles ---------- */
function setPrecipitation(theme) {
  const layer = $("#precip");
  layer.innerHTML = "";
  if (!["rain", "storm", "snow"].includes(theme)) return;

  const isSnow = theme === "snow";
  const count = isSnow ? 60 : theme === "storm" ? 120 : 80;
  const frag = document.createDocumentFragment();

  for (let i = 0; i < count; i++) {
    const p = document.createElement("span");
    p.className = isSnow ? "flake" : "drop";
    p.style.left = `${Math.random() * 110}%`;
    p.style.animationDuration = `${isSnow ? 6 + Math.random() * 6 : 0.6 + Math.random() * 0.5}s`;
    p.style.animationDelay = `${-Math.random() * 10}s`;
    p.style.setProperty("--drift", `${isSnow ? (Math.random() - 0.5) * 120 : -40}px`);
    if (isSnow) p.style.transform = `scale(${0.4 + Math.random() * 0.8})`;
    frag.appendChild(p);
  }
  layer.appendChild(frag);
}

/* ---------- Recent searches ---------- */
function addRecent(place) {
  const key = (p) => `${p.latitude.toFixed(2)},${p.longitude.toFixed(2)}`;
  state.recent = [place, ...state.recent.filter((p) => key(p) !== key(place))].slice(0, 5);
  storage.set("recent", state.recent);
  renderRecent();
}

function renderRecent() {
  const wrap = $("#recent");
  wrap.innerHTML = "";
  state.recent.forEach((place) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.innerHTML = `<i class="fa-solid fa-clock-rotate-left"></i>${escapeHTML(place.name)}`;
    btn.addEventListener("click", () => loadWeather(place));
    wrap.appendChild(btn);
  });
}

/* ---------- Search with suggestions ---------- */
(function setupSearch() {
  const form = $("#searchForm");
  const input = $("#searchInput");
  const list = $("#suggestions");
  let results = [];
  let active = -1;
  let timer;

  const close = () => {
    list.classList.remove("is-open");
    active = -1;
  };

  const choose = (place) => {
    input.value = "";
    close();
    input.blur();
    loadWeather(place);
  };

  const highlight = () =>
    [...list.children].forEach((li, i) => li.classList.toggle("is-active", i === active));

  input.addEventListener("input", () => {
    clearTimeout(timer);
    const q = input.value.trim();
    if (q.length < 2) return close();

    timer = setTimeout(async () => {
      try {
        results = await searchCities(q);
      } catch {
        results = [];
      }
      if (input.value.trim() !== q) return; // a newer search is on the way

      list.innerHTML = results.length
        ? results
            .map(
              (p, i) => `
              <li role="option" data-i="${i}">
                <i class="fa-solid fa-location-dot"></i>
                <div>${escapeHTML(p.name)}<small>${escapeHTML(
                [p.admin1, p.country].filter(Boolean).join(", ")
              )}</small></div>
              </li>`
            )
            .join("")
        : `<li class="empty">No cities found for “${escapeHTML(q)}”</li>`;
      list.classList.add("is-open");
      active = -1;
    }, 300);
  });

  list.addEventListener("mousedown", (e) => {
    const li = e.target.closest("li[data-i]");
    if (li) {
      e.preventDefault();
      choose(results[li.dataset.i]);
    }
  });

  input.addEventListener("keydown", (e) => {
    if (!list.classList.contains("is-open") || !results.length) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      active = (active + 1) % results.length;
      highlight();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      active = (active - 1 + results.length) % results.length;
      highlight();
    } else if (e.key === "Escape") {
      close();
    }
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (active >= 0 && results[active]) return choose(results[active]);

    const q = input.value.trim();
    if (!q) return;
    try {
      const found = await searchCities(q);
      if (found.length) choose(found[0]);
      else showStatus(`No city called “${q}” was found. Try another spelling.`, "error");
    } catch {
      showStatus("City search failed. Check your connection.", "error");
    }
  });

  input.addEventListener("blur", () => setTimeout(close, 150));
})();

/* ---------- Geolocation ---------- */
$("#locateBtn").addEventListener("click", () => {
  if (!navigator.geolocation) {
    return showStatus("Your browser doesn't support location access.", "error");
  }
  showStatus("Finding your location…");

  navigator.geolocation.getCurrentPosition(
    async ({ coords }) => {
      const place = {
        name: "My location",
        country: "",
        latitude: coords.latitude,
        longitude: coords.longitude,
      };
      try {
        const res = await fetch(
          `${API.reverse}?latitude=${coords.latitude}&longitude=${coords.longitude}&localityLanguage=en`
        );
        const data = await res.json();
        place.name = data.city || data.locality || "My location";
        place.admin1 = data.principalSubdivision;
        place.country = data.countryName || "";
      } catch {
        /* keep "My location" */
      }
      loadWeather(place);
    },
    () => showStatus("Location access was denied. Search for a city instead.", "error"),
    { timeout: 10000 }
  );
});

/* ---------- °C / °F toggle ---------- */
document.querySelectorAll(".units__btn").forEach((btn) => {
  const sync = () =>
    document.querySelectorAll(".units__btn").forEach((b) => {
      const on = b.dataset.unit === state.unit;
      b.classList.toggle("is-active", on);
      b.setAttribute("aria-pressed", on);
    });

  btn.addEventListener("click", () => {
    if (btn.dataset.unit === state.unit) return;
    state.unit = btn.dataset.unit;
    storage.set("unit", state.unit);
    sync();
    if (state.place) loadWeather(state.place);
  });
  sync();
});

/* ---------- Start ---------- */
renderRecent();
loadWeather(storage.get("place") || DEFAULT_PLACE);
