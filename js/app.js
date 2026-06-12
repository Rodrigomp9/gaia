/* ============================================================
   GAIA — LOGIC LAYER
   ------------------------------------------------------------
   Renders the globe, handles search and interaction.
   Reads data ONLY from GaiaData (js/data.js), fed by the
   mind (js/mind.js).
   ============================================================ */

const COUNTRIES_URL =
  "https://raw.githubusercontent.com/vasturiano/globe.gl/master/example/datasets/ne_110m_admin_0_countries.geojson";

let countries = [];
let globe;
let selectedIso = null;
let humanityLive = false;
let planetPts = [];
let planetRings = [];
let voicePts = [];
let currentLocation = null;
let showPlanet = true;
let showVoices = true;
let showWell = true;

const THEME_LABELS = {
  children: "A future for the children",
  health: "Health and care",
  safety: "Safety and peace",
  environment: "The planet we share"
};

function refreshPoints() {
  globe.pointsData(
    (showPlanet ? planetPts : []).concat(showVoices ? voicePts : [])
  );
  globe.ringsData(showPlanet ? planetRings : []);
}

/* Color ramp for shared wellbeing: cold deep blue (low)
   → vivid aqua (mid) → luminous mint (high).
   Selected country glows gold. */
const lerp = (a, b, t) => Math.round(a + (b - a) * t);
const rampColor = s => {
  /* stops: low #29586E → mid #3FBFA8 → high #8FF0CF */
  let r, g, b;
  if (s < 0.5) {
    const t = s / 0.5;
    r = lerp(0x29, 0x3F, t); g = lerp(0x58, 0xBF, t); b = lerp(0x6E, 0xA8, t);
  } else {
    const t = (s - 0.5) / 0.5;
    r = lerp(0x3F, 0x8F, t); g = lerp(0xBF, 0xF0, t); b = lerp(0xA8, 0xCF, t);
  }
  return `rgba(${r}, ${g}, ${b}, ${(0.55 + 0.4 * s).toFixed(2)})`;
};

const hexColor = d => {
  if (d.properties.ISO_A3 === selectedIso) return "rgba(217, 164, 65, 0.95)";
  if (humanityLive && showWell) {
    const e = GaiaMind.indexFor(d);
    if (e && e.score != null) return rampColor(e.score);
    return "rgba(63, 191, 168, 0.22)";
  }
  return "rgba(63, 191, 168, 0.65)";
};

/* ---------- Intro ---------- */

function setupIntro() {
  const intro = document.getElementById("intro");
  const dismiss = () => {
    intro.classList.add("fade");
    if (globe) {
      globe.pointOfView({ lat: 10, lng: -30, altitude: 3.6 }, 0);
      globe.pointOfView({ lat: 10, lng: -30, altitude: 2.2 }, 2400);
    }
    setTimeout(() => intro.remove(), 1500);
  };
  intro.addEventListener("click", dismiss);
  setTimeout(() => { if (document.getElementById("intro")) dismiss(); }, 9000);
}

/* ---------- Boot ---------- */

async function init() {
  const res = await fetch(COUNTRIES_URL);
  const geo = await res.json();
  countries = geo.features;

  globe = Globe()(document.getElementById("globe-container"))
    .backgroundColor("#070B12")
    .showAtmosphere(true)
    .atmosphereColor("#3FBFA8")
    .atmosphereAltitude(0.18)
    .hexPolygonsData(countries)
    .hexPolygonResolution(3)
    .hexPolygonMargin(0.55)
    .hexPolygonUseDots(true)
    .hexPolygonColor(hexColor)
    .hexPolygonLabel(d => {
      const e = humanityLive ? GaiaMind.indexFor(d) : null;
      const score = e && e.score != null
        ? `<br><span style="color:#3FBFA8">Shared wellbeing: ${Math.round(e.score * 100)}%</span>`
        : "";
      return `
        <div style="
          font-family: Inter, sans-serif;
          font-size: 12px;
          color: #E8EDF2;
          background: rgba(10,16,26,0.9);
          border: 1px solid rgba(120,160,170,0.2);
          border-radius: 8px;
          padding: 6px 10px;
        ">${d.properties.ADMIN}${score}</div>
      `;
    })
    .onHexPolygonClick(d => openRegion(d));

  const controls = globe.controls();
  controls.autoRotate = true;
  controls.autoRotateSpeed = 0.35;
  controls.enableDamping = true;

  globe.pointOfView({ lat: 10, lng: -30, altitude: 3.6 }, 0);

  setupIntro();
  fillPulse();
  setupSearch();

  /* ---- Phase 3: Gaia begins to feel ----
     Each sense is independent. If one is slow or fails,
     the others live on. */

  /* Shared point accessors — planet gold, voices violet */
  globe
    .pointColor(d => d.type === "voice"
      ? "rgba(201, 184, 240, 0.9)"
      : "rgba(217, 164, 65, 0.85)")
    .pointAltitude(d => d.type === "voice" ? 0.012 : 0.004)
    .pointRadius(d => d.type === "voice"
      ? Math.min(1.1, 0.25 + 0.12 * Math.sqrt(d.count))
      : Math.max(0.12, d.mag * 0.07))
    .pointLabel(d => `
      <div style="
        font-family: Inter, sans-serif;
        font-size: 12px;
        color: #E8EDF2;
        background: rgba(10,16,26,0.9);
        border: 1px solid ${d.type === "voice"
          ? "rgba(201,184,240,0.4)" : "rgba(217,164,65,0.35)"};
        border-radius: 8px;
        padding: 6px 10px;
      ">${d.type === "voice"
        ? `${d.count} voice${d.count > 1 ? "s" : ""} · ${THEME_LABELS[d.theme] || d.theme}`
        : `M${d.mag.toFixed(1)} — ${d.place}`}</div>
    `);

  /* Sense 1 — the planet's pulse */
  GaiaMind.listenPlanet().then(planet => {
    if (planet.length) {
      planetRings = planet;
      globe
        .ringsData(planet)
        .ringColor(() => t => `rgba(217, 164, 65, ${Math.max(0, 0.7 - t)})`)
        .ringMaxRadius(d => Math.max(1.2, d.mag * 1.1))
        .ringPropagationSpeed(1.4)
        .ringRepeatPeriod(2600);
      planetPts = planet;
      refreshPoints();
    }
    fillPulse();
  });

  /* Sense 3 — voices spoken to Gaia */
  GaiaMind.listenVoices().then(v => {
    voicePts = v;
    refreshPoints();
    fillPulse();
  });

  /* Sense 2 — humanity's state, lights the countries up */
  GaiaMind.listenHumanity().then(idx => {
    if (idx && Object.keys(idx).length) {
      humanityLive = true;
      countries.forEach(c => { delete c.__gaiaEntry; });
      globe.hexPolygonColor(hexColor);
      startSynthesis(GaiaMind.synthesize());
    }
    fillPulse();
  });

  window.addEventListener("resize", () =>
    globe.width(window.innerWidth).height(window.innerHeight)
  );
}

/* ---------- Synthesis — Gaia speaks ---------- */

function startSynthesis(lines) {
  if (!lines.length) return;
  const box = document.getElementById("synthesis");
  const text = document.getElementById("syn-text");
  let i = 0;

  const show = () => {
    text.classList.remove("visible");
    setTimeout(() => {
      text.textContent = lines[i % lines.length];
      text.classList.add("visible");
      i++;
    }, 700);
  };

  box.classList.add("alive");
  show();
  setInterval(show, 10000);
}

/* ---------- Global pulse (left panel) ---------- */

function fillPulse() {
  document.getElementById("pulse-planet").textContent =
    GaiaData.globalPulse.planetSignals;
  document.getElementById("pulse-human").textContent =
    GaiaData.globalPulse.humanSignals;
  document.getElementById("pulse-voices").textContent =
    GaiaData.globalPulse.voices;
}

/* ---------- Region panel ---------- */

function openRegion(feature) {
  const name = feature.properties.ADMIN;
  const iso = feature.properties.ISO_A3;

  selectedIso = iso;
  globe.hexPolygonColor(hexColor);

  document.getElementById("region-name").textContent = name;

  const body = document.getElementById("region-body");
  const entry = GaiaMind.indexFor(feature);

  if (entry) {
    body.innerHTML =
      `<p style="font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:#56616F;margin-bottom:14px">What Gaia knows here</p>` +
      GaiaMind.humanIndicators.map(ind => {
        const v = entry[ind.key];
        const n = entry[ind.key + "_n"];
        if (v == null) return "";
        return `
          <div style="margin-bottom:14px">
            <div style="display:flex;justify-content:space-between;font-size:13px">
              <span>${ind.label}</span>
              <span style="color:#8B98A8">${Math.round(v * 10) / 10}${ind.unit}</span>
            </div>
            <div style="font-size:11px;color:#56616F;margin-top:2px">${ind.sub}</div>
            <div style="height:3px;background:rgba(255,255,255,0.06);border-radius:2px;margin-top:6px">
              <div style="height:3px;width:${Math.max(6, Math.round(100 * (n != null ? n : 0)))}%;background:#3FBFA8;border-radius:2px"></div>
            </div>
          </div>
        `;
      }).join("");

    if (entry.score != null) {
      body.innerHTML += `
        <div style="margin-top:18px;padding-top:14px;border-top:1px solid rgba(120,160,170,0.14);display:flex;justify-content:space-between;font-size:13px">
          <span style="color:#8B98A8">Shared wellbeing</span>
          <span style="color:#3FBFA8;font-family:Marcellus,serif;font-size:18px">${Math.round(entry.score * 100)}%</span>
        </div>`;
    }
  } else {
    body.textContent = GaiaData.emptyRegionMessage;
  }

  /* Real planetary signals near this region */
  const c0 = centroid(feature);
  currentLocation = { name, lat: c0.lat, lng: c0.lng };
  const near = GaiaMind.planetNear(c0.lat, c0.lng);
  const status = document.querySelector(".region-status");
  let sHtml = near > 0
    ? `Gaia also feels <span style="color:#D9A441">${near} planetary signal${near > 1 ? "s" : ""}</span> near this region in the last 7 days — live seismic data.`
    : `No planetary signals near this region in the last 7 days. The ground here is quiet.`;
  const vn = GaiaMind.voicesNear(c0.lat, c0.lng);
  if (vn.total > 0) {
    sHtml += `<br><span style="color:#C9B8F0">${vn.total} voice${vn.total > 1 ? "s have" : " has"} spoken to Gaia near here</span>` +
      (vn.top ? ` — most about <em>${THEME_LABELS[vn.top.theme] || vn.top.theme}</em>.` : ".");
  }
  status.innerHTML = sHtml;

  document.getElementById("region-panel").classList.add("open");

  globe.controls().autoRotate = false;
  globe.pointOfView({ lat: c0.lat, lng: c0.lng, altitude: 1.6 }, 1100);
}

function closeRegion() {
  document.getElementById("region-panel").classList.remove("open");
  selectedIso = null;
  globe.hexPolygonColor(hexColor);
  globe.controls().autoRotate = true;
}

/* Rough centroid from geometry — good enough for camera framing */
function centroid(feature) {
  let pts = [];
  const g = feature.geometry;
  const polys = g.type === "Polygon" ? [g.coordinates] : g.coordinates;
  polys.forEach(p => p[0].forEach(pt => pts.push(pt)));
  const lng = pts.reduce((s, p) => s + p[0], 0) / pts.length;
  const lat = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  return { lat, lng };
}

/* ---------- Search — countries + any place on Earth ---------- */

function setupSearch() {
  const input = document.getElementById("search");
  const results = document.getElementById("search-results");
  let debounce = null;
  let lastQuery = "";

  const render = (countryMatches, places, searching) => {
    results.innerHTML = "";

    countryMatches.forEach(c => {
      const btn = document.createElement("button");
      btn.textContent = c.properties.ADMIN;
      btn.onclick = () => {
        input.value = "";
        results.classList.remove("open");
        openRegion(c);
      };
      results.appendChild(btn);
    });

    if (searching) {
      const note = document.createElement("button");
      note.textContent = "Searching the world...";
      note.disabled = true;
      note.style.opacity = "0.55";
      note.style.cursor = "default";
      results.appendChild(note);
    }

    places.forEach(p => {
      const btn = document.createElement("button");
      btn.innerHTML = `${p.name}<span style="display:block;font-size:11.5px;color:#56616F;margin-top:1px">${p.kind}${p.country ? " — " + p.country : ""}</span>`;
      btn.onclick = () => {
        input.value = "";
        results.classList.remove("open");
        openPlace(p);
      };
      results.appendChild(btn);
    });

    results.classList.toggle("open",
      countryMatches.length + places.length > 0 || searching);
  };

  input.addEventListener("input", () => {
    const q = input.value.trim();
    lastQuery = q;
    clearTimeout(debounce);

    if (q.length < 2) { results.classList.remove("open"); return; }

    const countryMatches = countries
      .filter(c => c.properties.ADMIN.toLowerCase().includes(q.toLowerCase()))
      .slice(0, 4);

    render(countryMatches, [], q.length >= 3);

    if (q.length < 3) return;

    /* Gentle debounce — Nominatim asks for max 1 request/second */
    debounce = setTimeout(async () => {
      try {
        const url =
          "https://nominatim.openstreetmap.org/search?format=jsonv2" +
          "&limit=5&addressdetails=1&accept-language=en&q=" +
          encodeURIComponent(q);
        const res = await fetch(url);
        const raw = await res.json();
        if (lastQuery !== q) return; /* user kept typing */

        const places = raw
          .filter(r => r.lat && r.lon)
          .map(r => ({
            name: r.name || (r.display_name || "").split(",")[0],
            kind: (r.addresstype || r.type || "place")
              .replace(/_/g, " ")
              .replace(/^\w/, ch => ch.toUpperCase()),
            country: r.address && r.address.country,
            cc: r.address && r.address.country_code,
            lat: +r.lat,
            lng: +r.lon,
            type: r.addresstype || r.type
          }))
          .slice(0, 5);

        render(countryMatches, places, false);
      } catch (e) {
        if (lastQuery === q) render(countryMatches, [], false);
      }
    }, 500);
  });

  document.addEventListener("click", e => {
    if (!e.target.closest(".search-wrap")) results.classList.remove("open");
  });
}

/* ---------- Open a city, town or neighborhood ---------- */

function openPlace(p) {
  /* Gold marker where the place lives */
  globe
    .labelsData([p])
    .labelLat(d => d.lat)
    .labelLng(d => d.lng)
    .labelText(d => d.name)
    .labelSize(0.55)
    .labelDotRadius(0.22)
    .labelColor(() => "rgba(217, 164, 65, 0.95)")
    .labelResolution(2);

  /* How close the camera flies depends on the kind of place */
  const closeTypes = ["suburb", "neighbourhood", "quarter", "village", "hamlet"];
  const altitude = closeTypes.includes(p.type) ? 0.18
    : ["city", "town", "municipality"].includes(p.type) ? 0.35
    : 0.7;

  globe.controls().autoRotate = false;
  globe.pointOfView({ lat: p.lat, lng: p.lng, altitude }, 1400);

  /* Context: the country this place belongs to */
  let countryFeature = null;
  if (p.cc) {
    const cc = p.cc.toUpperCase();
    countryFeature = countries.find(c => c.properties.ISO_A2 === cc) || null;
  }
  if (!countryFeature && p.country) {
    const n = p.country.toLowerCase();
    countryFeature = countries.find(c =>
      (c.properties.ADMIN || "").toLowerCase() === n) || null;
  }

  selectedIso = countryFeature ? countryFeature.properties.ISO_A3 : null;
  globe.hexPolygonColor(hexColor);

  document.getElementById("region-name").textContent = p.name;

  const body = document.getElementById("region-body");
  const entry = countryFeature ? GaiaMind.indexFor(countryFeature) : null;

  let html = "";
  if (p.country) {
    html += `<p style="font-size:12px;color:#8B98A8;margin-bottom:16px">${p.kind} · ${p.country}</p>`;
  }

  if (entry) {
    html +=
      `<p style="font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:#56616F;margin-bottom:14px">What Gaia knows here</p>` +
      GaiaMind.humanIndicators.map(ind => {
        const v = entry[ind.key];
        const n = entry[ind.key + "_n"];
        if (v == null) return "";
        return `
          <div style="margin-bottom:14px">
            <div style="display:flex;justify-content:space-between;font-size:13px">
              <span>${ind.label}</span>
              <span style="color:#8B98A8">${Math.round(v * 10) / 10}${ind.unit}</span>
            </div>
            <div style="height:3px;background:rgba(255,255,255,0.06);border-radius:2px;margin-top:6px">
              <div style="height:3px;width:${Math.max(6, Math.round(100 * (n != null ? n : 0)))}%;background:#3FBFA8;border-radius:2px"></div>
            </div>
          </div>
        `;
      }).join("") +
      `<p style="font-size:12px;color:#56616F;margin-top:16px;line-height:1.6">Gaia's data resolution is national for now. Local signals arrive in a future phase.</p>`;
  } else {
    html += `<p>${GaiaData.emptyRegionMessage}</p>`;
  }
  body.innerHTML = html;

  /* Planetary signals near this exact place */
  currentLocation = { name: p.name + (p.country ? ", " + p.country : ""), lat: p.lat, lng: p.lng };
  const near = GaiaMind.planetNear(p.lat, p.lng);
  const status = document.querySelector(".region-status");
  let sHtml = near > 0
    ? `Gaia feels <span style="color:#D9A441">${near} planetary signal${near > 1 ? "s" : ""}</span> near here in the last 7 days — live seismic data.`
    : `No planetary signals near here in the last 7 days. The ground is quiet.`;
  const vn = GaiaMind.voicesNear(p.lat, p.lng);
  if (vn.total > 0) {
    sHtml += `<br><span style="color:#C9B8F0">${vn.total} voice${vn.total > 1 ? "s have" : " has"} spoken to Gaia near here</span>` +
      (vn.top ? ` — most about <em>${THEME_LABELS[vn.top.theme] || vn.top.theme}</em>.` : ".");
  }
  status.innerHTML = sHtml;

  document.getElementById("region-panel").classList.add("open");
}

document.getElementById("region-close").addEventListener("click", closeRegion);

/* ---------- About ---------- */

document.getElementById("about-open").addEventListener("click", () =>
  document.getElementById("about").classList.add("open"));
document.getElementById("about-close").addEventListener("click", () =>
  document.getElementById("about").classList.remove("open"));
document.getElementById("about").addEventListener("click", e => {
  if (e.target === e.currentTarget)
    e.currentTarget.classList.remove("open");
});

/* ---------- Speak to Gaia ---------- */

let chosenTheme = null;
let speakLocation = null;

function setupSpeak() {
  const modal = document.getElementById("speak");
  const chips = document.getElementById("theme-chips");

  Object.entries(THEME_LABELS).forEach(([key, label]) => {
    const b = document.createElement("button");
    b.textContent = label;
    b.onclick = () => {
      chosenTheme = key;
      [...chips.children].forEach(c => c.classList.remove("sel"));
      b.classList.add("sel");
    };
    chips.appendChild(b);
  });

  const whereLine = () => {
    document.getElementById("speak-where").textContent = speakLocation
      ? "Your voice will rest at: " + speakLocation.name
      : "No place chosen — your voice will speak for the whole Earth.";
  };

  document.getElementById("speak-open").addEventListener("click", () => {
    document.getElementById("speak-form").style.display = "";
    document.getElementById("speak-done").style.display = "none";
    document.getElementById("speak-error").style.display = "none";
    speakLocation = currentLocation || null;
    document.getElementById("speak-loc").value = speakLocation ? speakLocation.name : "";
    whereLine();
    modal.classList.add("open");
  });

  /* Location search inside the form (Nominatim, debounced) */
  const locInput = document.getElementById("speak-loc");
  const locResults = document.getElementById("speak-loc-results");
  let locDebounce = null, locLast = "";

  locInput.addEventListener("input", () => {
    const q = locInput.value.trim();
    locLast = q;
    clearTimeout(locDebounce);
    if (!q) { speakLocation = null; whereLine(); locResults.classList.remove("open"); return; }
    if (q.length < 3) { locResults.classList.remove("open"); return; }

    locDebounce = setTimeout(async () => {
      try {
        const url = "https://nominatim.openstreetmap.org/search?format=jsonv2" +
          "&limit=5&addressdetails=1&accept-language=en&q=" + encodeURIComponent(q);
        const res = await fetch(url);
        const raw = await res.json();
        if (locLast !== q) return;
        locResults.innerHTML = "";
        raw.filter(r => r.lat && r.lon).slice(0, 5).forEach(r => {
          const name = (r.name || (r.display_name || "").split(",")[0]) +
            (r.address && r.address.country ? ", " + r.address.country : "");
          const b = document.createElement("button");
          b.textContent = name;
          b.onclick = () => {
            speakLocation = { name, lat: +r.lat, lng: +r.lon };
            locInput.value = name;
            locResults.classList.remove("open");
            whereLine();
          };
          locResults.appendChild(b);
        });
        locResults.classList.toggle("open", locResults.children.length > 0);
      } catch (e) { locResults.classList.remove("open"); }
    }, 500);
  });

  document.getElementById("speak-close").addEventListener("click", () =>
    modal.classList.remove("open"));
  modal.addEventListener("click", e => {
    if (e.target === e.currentTarget) modal.classList.remove("open");
  });

  document.getElementById("speak-send").addEventListener("click", async () => {
    const err = document.getElementById("speak-error");
    const msg = document.getElementById("speak-text").value.trim();

    if (!chosenTheme) {
      err.textContent = "Choose a theme first."; err.style.display = ""; return;
    }
    if (msg.length < 2) {
      err.textContent = "Write a few words — Gaia is listening."; err.style.display = ""; return;
    }
    err.style.display = "none";

    const payload = {
      theme: chosenTheme,
      message: msg,
      lat: speakLocation ? speakLocation.lat : null,
      lng: speakLocation ? speakLocation.lng : null,
      place: speakLocation ? speakLocation.name : null
    };

    try {
      const res = await fetch("/api/voice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      if (!res.ok) throw new Error("channel closed");

      document.getElementById("speak-form").style.display = "none";
      document.getElementById("speak-done").style.display = "";
      document.getElementById("speak-text").value = "";

      /* Refresh the voices layer */
      GaiaMind.listenVoices().then(v => {
        voicePts = v; refreshPoints(); fillPulse();
      });
    } catch (e) {
      err.textContent = "The listening channel opens when Gaia is online (this is the local preview).";
      err.style.display = "";
    }
  });
}

function setupLegend() {
  const wire = (id, fn) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener("click", () => {
      el.classList.toggle("off");
      fn(!el.classList.contains("off"));
    });
  };
  wire("leg-planet", v => { showPlanet = v; refreshPoints(); });
  wire("leg-voices", v => { showVoices = v; refreshPoints(); });
  wire("leg-well",   v => { showWell = v; globe.hexPolygonColor(hexColor); });
}

setupSpeak();
setupLegend();
init();
