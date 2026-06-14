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
let hoverCountry = null;
let humanityLive = false;
let planetPts = [];
let planetRings = [];
let voicePts = [];
let currentLocation = null;
let showPlanet = true;
let showVoices = true;
let showWell = true;

const THEME_LABELS = {
  cost: "Cost of Living",
  safety: "Safety",
  health: "Health",
  work: "Work & Opportunity",
  education: "Education",
  environment: "Environment"
};

function refreshPoints() {
  /* Voices ARE the planet's pulse now — each one a ripple of human
     experience. Gold = something getting worse, aqua = getting better.
     A central dot marks the place; rings pulse outward from it. */
  const vp = showVoices ? voicePts : [];
  globe.pointsData(vp);
  globe.ringsData(vp);
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
  if (hoverCountry && d === hoverCountry) return "rgba(217, 164, 65, 0.9)";
  if (humanityLive && showWell) {
    const e = GaiaMind.indexFor(d);
    if (e && e.score != null) return rampColor(e.score);
    return "rgba(63, 191, 168, 0.22)";
  }
  return "rgba(63, 191, 168, 0.65)";
};

/* ---------- Unified hover (dots + invisible territory) ----------
   Two sensors feed one state: the dots (when the cursor is on
   one) and the invisible country shapes (when it's between
   dots). A short damper ignores the null blips in between. */

/* ---------- Country under the cursor (pure math) ----------
   Screen position -> lat/lng -> point-in-polygon test.
   No 3D sensors, no gaps between dots, no flicker. */

function bboxOf(f) {
  let minLng = 999, minLat = 999, maxLng = -999, maxLat = -999;
  const g = f.geometry;
  const polys = g.type === "Polygon" ? [g.coordinates] : g.coordinates;
  polys.forEach(p => p[0].forEach(pt => {
    if (pt[0] < minLng) minLng = pt[0];
    if (pt[0] > maxLng) maxLng = pt[0];
    if (pt[1] < minLat) minLat = pt[1];
    if (pt[1] > maxLat) maxLat = pt[1];
  }));
  return [minLng, minLat, maxLng, maxLat];
}

function pointInRing(lat, lng, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];
    if (((yi > lat) !== (yj > lat)) &&
        (lng < (xj - xi) * (lat - yi) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}

function countryAt(lat, lng) {
  for (const c of countries) {
    const b = c.__bbox || (c.__bbox = bboxOf(c));
    if (lng < b[0] || lat < b[1] || lng > b[2] || lat > b[3]) continue;
    const g = c.geometry;
    const polys = g.type === "Polygon" ? [g.coordinates] : g.coordinates;
    for (const p of polys) {
      if (pointInRing(lat, lng, p[0])) return c;
    }
  }
  return null;
}

function setupCountryPointer() {
  const el = document.getElementById("globe-container");
  let raf = null, lastEvt = null;

  /* Our own tooltip — follows the math, not the dots */
  const tip = document.createElement("div");
  tip.id = "country-tip";
  document.body.appendChild(tip);

  const updateTip = (f, x, y) => {
    if (!f) { tip.style.display = "none"; return; }
    const e = humanityLive ? GaiaMind.indexFor(f) : null;
    tip.innerHTML = `<b>${f.properties.ADMIN}</b>` +
      (e && e.score != null
        ? `<br><span style="color:#3FBFA8">Shared wellbeing: ${Math.round(e.score * 100)}%</span>`
        : "");
    tip.style.display = "block";
    const pad = 16;
    const tw = tip.offsetWidth, th = tip.offsetHeight;
    let tx = x + pad, ty = y + pad;
    if (tx + tw > window.innerWidth - 8) tx = x - tw - pad;
    if (ty + th > window.innerHeight - 8) ty = y - th - pad;
    tip.style.left = tx + "px";
    tip.style.top = ty + "px";
  };

  el.addEventListener("mousemove", e => {
    lastEvt = e;
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = null;
      const r = el.getBoundingClientRect();
      const c = globe.toGlobeCoords(lastEvt.clientX - r.left, lastEvt.clientY - r.top);
      const f = c ? countryAt(c.lat, c.lng) : null;
      if (f !== hoverCountry) {
        hoverCountry = f;
        globe.hexPolygonColor(hexColor);
        el.style.cursor = f ? "pointer" : "";
      }
      updateTip(f, lastEvt.clientX, lastEvt.clientY);
    });
  });

  el.addEventListener("mouseleave", () => updateTip(null, 0, 0));

  /* Click anywhere inside a country opens it (drag = rotate, not click) */
  let downX = 0, downY = 0;
  el.addEventListener("mousedown", e => { downX = e.clientX; downY = e.clientY; });
  el.addEventListener("click", e => {
    if (Math.hypot(e.clientX - downX, e.clientY - downY) > 6) return;
    const r = el.getBoundingClientRect();
    const c = globe.toGlobeCoords(e.clientX - r.left, e.clientY - r.top);
    const f = c ? countryAt(c.lat, c.lng) : null;
    if (f) openRegion(f);
  });
}

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

;

  const controls = globe.controls();
  controls.autoRotate = true;
  controls.autoRotateSpeed = 0.35;
  controls.enableDamping = true;

  globe.pointOfView({ lat: 10, lng: -30, altitude: 3.6 }, 0);

  setupIntro();
  setupCountryPointer();
  fillPulse();
  setupSearch();

  /* ---- Phase 3: Gaia begins to feel ----
     Each sense is independent. If one is slow or fails,
     the others live on. */

  /* Central dot for each voice — gold (worse) or aqua (better) */
  globe
    .pointColor(d => d.direction === "better"
      ? "rgba(63, 191, 168, 0.95)"
      : "rgba(217, 164, 65, 0.95)")
    .pointAltitude(0.012)
    .pointRadius(d => Math.min(1.1, 0.22 + 0.12 * Math.sqrt(d.count || 1)))
    .pointLabel(d => `
      <div style="
        font-family: Inter, sans-serif;
        font-size: 12px;
        color: #E8EDF2;
        background: rgba(10,16,26,0.9);
        border: 1px solid ${d.direction === "better"
          ? "rgba(63,191,168,0.4)" : "rgba(217,164,65,0.4)"};
        border-radius: 8px;
        padding: 6px 10px;
      ">${d.count} voice${d.count > 1 ? "s" : ""} · ${THEME_LABELS[d.theme] || d.theme}<br>
        <span style="color:${d.direction === "better" ? "#3FBFA8" : "#D9A441"}">${d.direction === "better" ? "improving" : "concern"}</span></div>
    `);

  /* The pulse of the planet is now human: voices ripple outward,
     gold where things worsen, aqua where they improve. */
  globe
    .ringColor(d => {
      const better = d.direction === "better";
      return t => better
        ? `rgba(63, 191, 168, ${Math.max(0, 0.7 - t)})`
        : `rgba(217, 164, 65, ${Math.max(0, 0.7 - t)})`;
    })
    .ringMaxRadius(d => Math.max(1.4, Math.min(5, 1.2 + (d.count || 1) * 0.5)))
    .ringPropagationSpeed(1.3)
    .ringRepeatPeriod(2400);

  /* Resonance counts */
  GaiaMind.listenResonance();

  /* Voices — the planet's human pulse */
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
      const di = GaiaMind.dailyInsight();
      if (di) {
        document.getElementById("daily-text").textContent = di;
        document.getElementById("daily").classList.add("alive");
      }
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
    (GaiaData.voicePoints ? GaiaData.voicePoints.length : 0);
  document.getElementById("pulse-human").textContent =
    GaiaData.globalPulse.humanSignals;
  document.getElementById("pulse-voices").textContent =
    GaiaData.globalPulse.voices;
}

/* ---------- Narrative panel — Gaia's understanding ---------- */

function narrativeHtml(entry) {
  const lines = GaiaMind.narrate(entry);
  let html =
    `<p style="font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:#56616F;margin-bottom:14px">Gaia's understanding</p>` +
    lines.map(l =>
      `<p style="font-size:13.5px;line-height:1.75;color:#B8C2CE;margin-bottom:12px">${l}</p>`
    ).join("");

  if (entry.score != null) {
    const wAvg = 0.5; /* normalized world midpoint */
    const rel = entry.score > wAvg + 0.07 ? "above" : entry.score < wAvg - 0.07 ? "below" : "near";
    html += `
      <div style="margin-top:16px;padding-top:14px;border-top:1px solid rgba(120,160,170,0.14);display:flex;justify-content:space-between;align-items:baseline">
        <span style="color:#8B98A8;font-size:12.5px">Shared wellbeing — ${rel} the world average</span>
        <span style="color:#3FBFA8;font-family:Marcellus,serif;font-size:18px">${Math.round(entry.score * 100)}%</span>
      </div>`;
  }
  html += `<p style="font-size:11px;color:#56616F;margin-top:14px">Computed from open World Bank data. Nothing invented.</p>`;
  return html;
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
    body.innerHTML = narrativeHtml(entry);
  } else {
    body.textContent = GaiaData.emptyRegionMessage;
  }

  /* Human voices near this region */
  const c0 = centroid(feature);
  currentLocation = { name, lat: c0.lat, lng: c0.lng };
  const status = document.querySelector(".region-status");
  const vn = GaiaMind.voicesNear(c0.lat, c0.lng);
  let sHtml = vn.total > 0
    ? `<span style="color:#C9B8F0">${vn.total} voice${vn.total > 1 ? "s have" : " has"} spoken to Gaia near here</span>`
    : `No voices have spoken to Gaia near here yet. This region is quiet — for now.`;
  if (vn.total > 0) {
    sHtml += ``  +
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
      btn.innerHTML = `${p.name}<span style="display:block;font-size:11.5px;color:#56616F;margin-top:1px">${p.sub || p.kind}</span>`;
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
          .map(r => {
            const ad = r.address || {};
            const region = ad.state || ad.region || ad.province || ad.state_district || ad.county || "";
            const kind = (r.addresstype || r.type || "place")
              .replace(/_/g, " ").replace(/^\w/, ch => ch.toUpperCase());
            /* Subtitle that disambiguates same-named places:
               "Municipality · Paraná — Brazil" */
            const parts = [kind];
            if (region) parts.push(region);
            const sub = parts.join(" · ") + (ad.country ? " — " + ad.country : "");
            return {
              name: r.name || (r.display_name || "").split(",")[0],
              kind, region, sub,
              country: ad.country,
              cc: ad.country_code,
              lat: +r.lat,
              lng: +r.lon,
              type: r.addresstype || r.type
            };
          })
          .slice(0, 6);

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
    html += narrativeHtml(entry) +
      `<p style="font-size:11px;color:#56616F;margin-top:6px">Gaia's data resolution is national for now. Local signals arrive in a future phase.</p>`;
  } else {
    html += `<p>${GaiaData.emptyRegionMessage}</p>`;
  }
  body.innerHTML = html;

  /* Human voices near this exact place */
  currentLocation = { name: p.name + (p.region ? ", " + p.region : "") + (p.country ? ", " + p.country : ""), lat: p.lat, lng: p.lng };
  const status = document.querySelector(".region-status");
  const vn = GaiaMind.voicesNear(p.lat, p.lng);
  let sHtml = vn.total > 0
    ? `<span style="color:#C9B8F0">${vn.total} voice${vn.total > 1 ? "s have" : " has"} spoken to Gaia near here</span>` +
      (vn.top ? ` — most about <em>${THEME_LABELS[vn.top.theme] || vn.top.theme}</em>.` : ".")
    : `No voices have spoken to Gaia near here yet. Be the first to share what you're experiencing.`;
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
let chosenDirection = null;
let speakLocation = null;

function setupSpeak() {
  const modal = document.getElementById("speak");
  const chips = document.getElementById("theme-chips");

  const dirCards = document.getElementById("direction-choice");
  if (dirCards) {
    [...dirCards.querySelectorAll(".dir-card")].forEach(card => {
      card.addEventListener("click", () => {
        chosenDirection = card.dataset.dir;
        [...dirCards.children].forEach(c => c.classList.remove("sel"));
        card.classList.add("sel");
        document.getElementById("speak-rest").style.display = "";
      });
    });
  }

  GaiaMind.voiceThemes.forEach(t => {
    const b = document.createElement("button");
    b.textContent = t.label;
    b.onclick = () => {
      chosenTheme = t.key;
      [...chips.children].forEach(c => c.classList.remove("sel"));
      b.classList.add("sel");
      const ta = document.getElementById("speak-text");
      if (ta) ta.placeholder = chosenDirection === "better"
        ? "What is improving here? What seems to be helping?"
        : t.prompt;
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
    chosenDirection = null;
    chosenTheme = null;
    document.querySelectorAll("#direction-choice .dir-card").forEach(c => c.classList.remove("sel"));
    document.querySelectorAll("#theme-chips button").forEach(c => c.classList.remove("sel"));
    document.getElementById("speak-rest").style.display = "none";
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
        raw.filter(r => r.lat && r.lon).slice(0, 6).forEach(r => {
          const ad = r.address || {};
          const region = ad.state || ad.region || ad.province || ad.state_district || ad.county || "";
          const base = r.name || (r.display_name || "").split(",")[0];
          /* Full name disambiguates: "Londrina, Paraná, Brazil" */
          const name = base + (region ? ", " + region : "") + (ad.country ? ", " + ad.country : "");
          const b = document.createElement("button");
          b.innerHTML = `${base}<span style="display:block;font-size:11px;color:#56616F">${[region, ad.country].filter(Boolean).join(" — ")}</span>`;
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

    if (!chosenDirection) {
      err.textContent = "First choose: getting worse or getting better?"; err.style.display = ""; return;
    }
    if (!chosenTheme) {
      err.textContent = "Choose a theme."; err.style.display = ""; return;
    }
    if (msg.length < 2) {
      err.textContent = "Write a few words — Gaia is listening."; err.style.display = ""; return;
    }
    err.style.display = "none";

    const payload = {
      theme: chosenTheme,
      direction: chosenDirection,
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

      const t = GaiaMind.voiceThemes.find(v => v.key === chosenTheme);
      const echo = document.getElementById("speak-echo");
      if (echo && t) {
        const better = chosenDirection === "better";
        const head = better
          ? "Your voice strengthens a signal of improvement"
          : "Your voice joins a signal of concern";
        const col = better ? "#3FBFA8" : "#D9A441";

        const axis = better ? GaiaData.voiceBetter : GaiaData.voiceWorse;
        const relatedThemeKeys = GaiaMind.voiceThemes.filter(v => v.layer2 === t.layer2).map(v => v.key);
        const relatedVoices = relatedThemeKeys
          .reduce((s, k) => s + (((axis && axis.byTheme) || {})[k] || 0), 0) + 1;
        const relatedRegions = new Set(
          (GaiaData.voicePoints || [])
            .filter(p => relatedThemeKeys.includes(p.theme) &&
              (better ? p.direction === "better" : p.direction !== "better"))
            .map(p => Math.round(p.lat / 8) + "," + Math.round(p.lng / 8))
        ).size || 1;

        const placeLine = speakLocation ? speakLocation.name.split(",")[0] : "worldwide";

        echo.innerHTML =
          `<p style="font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:#56616F;margin-bottom:10px">${head}</p>` +
          `<p style="font-family:Marcellus,serif;font-size:21px;color:${col}">${t.layer2}</p>` +
          `<div style="margin-top:12px;font-size:13px;color:#8B98A8;line-height:1.9">` +
            `<div>Theme · <span style="color:#E8EDF2">${t.label}</span></div>` +
            `<div>Region · <span style="color:#E8EDF2">${placeLine}</span></div>` +
            `<div>Related voices · <span style="color:#E8EDF2">${relatedVoices}</span></div>` +
            `<div>Regions reporting · <span style="color:#E8EDF2">${relatedRegions}</span></div>` +
            `<div>State · <span style="color:${col}">Listening</span></div>` +
          `</div>` +
          `<div style="margin-top:14px;padding-top:12px;border-top:1px solid rgba(120,160,170,0.14)">` +
            `<p style="font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#56616F;margin-bottom:6px">Why your voice matters</p>` +
            `<p style="font-size:12.5px;color:#8B98A8;line-height:1.6">When many people describe similar experiences across different places, Gaia can detect emerging human signals that no one could see alone.</p>` +
          `</div>` +
          `<button id="echo-explore" class="speak-btn" style="width:100%;margin-top:14px;justify-content:center">Explore this signal in the Pulse</button>`;

        /* Speak → Echo → Pulse flow */
        const ex = document.getElementById("echo-explore");
        if (ex) ex.addEventListener("click", () => {
          document.getElementById("speak").classList.remove("open");
          renderHumanityPulse();
          document.getElementById("hpulse").classList.add("open");
        });

        /* Save to local history (no login, browser only) */
        rememberContribution({
          theme: t.label, layer2: t.layer2, direction: chosenDirection,
          place: speakLocation ? speakLocation.name.split(",")[0] : "Worldwide",
          date: Date.now()
        });
      }
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

/* Resonance memory — one gesture per theme per browser */
let resoMemory = {};
try { resoMemory = JSON.parse(localStorage.getItem("gaia_resonance") || "{}"); } catch (e) {}
function hasResonated(theme) { return !!resoMemory[theme]; }
function rememberResonance(theme) {
  resoMemory[theme] = true;
  try { localStorage.setItem("gaia_resonance", JSON.stringify(resoMemory)); } catch (e) {}
}

/* ---------- Humanity Pulse panel ---------- */

function renderHumanityPulse() {
  const body = document.getElementById("hpulse-body");
  const foot = document.getElementById("hpulse-foot");
  const themes = GaiaMind.humanityPulse();
  const totalVoices = themes.reduce((s, t) => s + t.voices, 0);

  /* Layer 3 — emerging signals, shown above the themes */
  const dotColor = { green: "#3FBFA8", amber: "#D9A441", yellow: "#C9B8F0" };
  const sigBox = document.getElementById("hpulse-signals");

  const renderSignalGroup = (title, list, accent) => {
    const named = list.filter(s => s.tier);
    if (named.length) {
      return `<p class="about-sub" style="margin-top:0 !important;color:${accent} !important">${title}</p>` +
        named.map(s => `
          <div style="padding:12px 0;border-bottom:1px solid rgba(120,160,170,0.1)">
            <div style="display:flex;justify-content:space-between;align-items:baseline">
              <span style="font-size:14px;color:#E8EDF2">${s.signal}</span>
              <span style="font-size:11.5px;color:#56616F">${s.regions} region${s.regions === 1 ? "" : "s"}</span>
            </div>
            <div style="display:flex;align-items:center;gap:6px;margin-top:5px">
              <span style="width:8px;height:8px;border-radius:50%;background:${dotColor[s.dot]};display:inline-block"></span>
              <span style="font-size:11.5px;color:#8B98A8">${s.tier} · ${s.tierLabel}</span>
            </div>
          </div>`).join("");
    }
    const heard = GaiaData.globalPulse.voices;
    const isImprove = accent === "#3FBFA8";
    const heardLine = (typeof heard === "number" && heard > 0)
      ? `${heard} voice${heard === 1 ? "" : "s"} heard so far. ` : "";
    const body = isImprove
      ? `Gaia is listening. ${heardLine}The first improvement signals appear when people share what is getting better across regions.`
      : `Gaia is listening. ${heardLine}A collective signal will be named when enough voices gather across regions.`;
    return `<p class="about-sub" style="margin-top:0 !important;color:${accent} !important">${title}</p>` +
      `<p style="font-size:13px;color:#8B98A8;line-height:1.6;margin-bottom:8px">${body}</p>`;
  };

  if (sigBox) {
    /* Humanity Snapshot — makes the observatory feel alive */
    const pts = GaiaData.voicePoints || [];
    const totalVoices = GaiaData.globalPulse.voices;
    const regionCount = new Set(
      pts.map(p => Math.round(p.lat / 8) + "," + Math.round(p.lng / 8))
    ).size;
    const byTheme = GaiaData.voiceByTheme || {};
    let topTheme = null, topN = 0;
    Object.entries(byTheme).forEach(([k, n]) => { if (n > topN) { topN = n; topTheme = k; } });
    const topLabel = topTheme ? (THEME_LABELS[topTheme] || topTheme) : "—";

    const snapshot = `
      <div style="border:1px solid rgba(120,160,170,0.18);border-radius:12px;padding:16px 18px;margin-bottom:22px;background:rgba(255,255,255,0.02)">
        <p class="about-sub" style="margin-top:0 !important">Humanity snapshot</p>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:4px">
          <div><div style="font-family:Marcellus,serif;font-size:22px;color:#E8EDF2">${typeof totalVoices === "number" ? totalVoices : "—"}</div><div style="font-size:11.5px;color:#56616F">voices heard</div></div>
          <div><div style="font-family:Marcellus,serif;font-size:22px;color:#E8EDF2">${regionCount || "—"}</div><div style="font-size:11.5px;color:#56616F">regions represented</div></div>
          <div style="grid-column:1/-1"><div style="font-size:14px;color:#C9B8F0">${topLabel}</div><div style="font-size:11.5px;color:#56616F">most active topic</div></div>
        </div>
      </div>`;

    const worse = GaiaMind.emergingSignals();
    const better = GaiaMind.improvementSignals();
    const helps = GaiaMind.whatHelps();

    let html = snapshot;
    html += renderSignalGroup("Emerging concerns", worse, "#D9A441");
    html += `<div style="height:20px"></div>`;
    html += renderSignalGroup("Signals of improvement", better, "#3FBFA8");

    if (helps.length) {
      html += `<div style="height:20px"></div>` +
        `<p class="about-sub" style="margin-top:0 !important;color:#3FBFA8 !important">Where things improve, people mention</p>` +
        helps.map(h => `<div style="font-size:13px;color:#8B98A8;margin-bottom:8px"><span style="color:#E8EDF2">${h.label}:</span> ${h.words.join(", ")}</div>`).join("");
    }

    html += `<div style="height:14px"></div><p style="font-size:11.5px;color:#56616F;line-height:1.6;margin-bottom:18px;font-style:italic">Gaia measures the voices that choose to participate — not humanity itself.</p>`;
    sigBox.innerHTML = html;
  }

  const themesHeader = `<p class="about-sub" style="margin-top:4px">Explore by topic</p>`;
  body.innerHTML = themesHeader + themes.map(t => `
    <div style="border:1px solid rgba(120,160,170,0.14);border-radius:12px;padding:16px 18px;margin-bottom:12px">
      <div style="display:flex;justify-content:space-between;align-items:baseline">
        <span style="font-size:14.5px;color:#E8EDF2">${t.label}</span>
        <span style="font-family:Marcellus,serif;font-size:18px;color:#C9B8F0">${t.voices}</span>
      </div>
      <div style="font-size:11.5px;color:#56616F;margin-top:2px">
        voice${t.voices === 1 ? "" : "s"}${t.regions ? ` · ${t.regions} region${t.regions === 1 ? "" : "s"}` : ""}
      </div>
      ${(() => {
        const v = t.voices || 0;
        if (v === 0) return "";
        /* Below a real sample, never claim a trend — just name the stage */
        let label, col;
        if (v < 15)      { label = "New signal";     col = "#56616F"; }
        else if (v < 120){ label = "Growing";        col = "#D9A441"; }
        else if (v < 800){ label = "Emerging";       col = "#D9A441"; }
        else             { label = "Strong signal";  col = "#3FBFA8"; }
        return `<div style="font-size:12px;color:${col};margin-top:6px">${label}</div>`;
      })()}
      ${t.growingIn && t.growingIn.length ? `<div style="font-size:12px;color:#8B98A8;margin-top:6px">Voiced in: ${t.growingIn.join(", ")}</div>` : ""}
      ${(t.voices >= 10 && t.concerns && t.concerns.length) ? `<div style="font-size:12px;color:#8B98A8;margin-top:6px">Common words: ${t.concerns.join(", ")}</div>` : ""}
      <div style="display:flex;justify-content:space-between;align-items:center;margin-top:12px">
        <button class="reso-btn" data-theme="${t.key}" ${hasResonated(t.key) ? "disabled" : ""}>
          ${hasResonated(t.key) ? "You feel the same ✓" : "I feel the same"}
        </button>
        <span style="font-size:11.5px;color:#56616F">${t.resonance ? t.resonance + " feel the same" : ""}</span>
      </div>
    </div>
  `).join("");

  body.querySelectorAll(".reso-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      const theme = btn.dataset.theme;
      btn.disabled = true;
      btn.textContent = "You feel the same ✓";
      rememberResonance(theme);
      try {
        await GaiaMind.resonate(theme,
          currentLocation ? currentLocation.lat : null,
          currentLocation ? currentLocation.lng : null);
        await GaiaMind.listenResonance();
        renderHumanityPulse();
      } catch (e) {
        /* Local preview: the gesture is kept, the count waits for Gaia online */
      }
    });
  });

  foot.textContent = totalVoices > 0
    ? `Gaia has heard ${totalVoices} voice${totalVoices === 1 ? "" : "s"} so far. Patterns emerge when many speak — collective questions are never rushed.`
    : "Gaia is listening. The first voices will appear here — patterns emerge when many speak.";
}

function setupHumanityPulse() {
  const modal = document.getElementById("hpulse");
  document.getElementById("pulse-open").addEventListener("click", () => {
    renderHumanityPulse();
    modal.classList.add("open");
  });
  document.getElementById("hpulse-close").addEventListener("click", () =>
    modal.classList.remove("open"));
  modal.addEventListener("click", e => {
    if (e.target === e.currentTarget) modal.classList.remove("open");
  });
}

/* ---------- Share this insight ---------- */

function setupShare() {
  const btn = document.getElementById("daily-share");
  btn.addEventListener("click", async () => {
    const insight = document.getElementById("daily-text").textContent;
    if (!insight) return;
    const text = `"${insight}"\n\n— GAIA, an assistant for collective understanding\n${location.origin}`;
    if (navigator.share) {
      try { await navigator.share({ text }); } catch (e) { /* user closed the sheet */ }
    } else {
      try {
        await navigator.clipboard.writeText(text);
        const prev = btn.textContent;
        btn.textContent = "Copied ✓";
        setTimeout(() => { btn.textContent = prev; }, 2200);
      } catch (e) {}
    }
  });
}

/* ---------- Explore: theme -> places -> voices ---------- */

let exploreTheme = null;

function renderExplore() {
  const body = document.getElementById("explore-body");
  if (exploreTheme) {
    const t = GaiaMind.voiceThemes.find(v => v.key === exploreTheme);
    const sum = GaiaMind.exploreThemeSummary(exploreTheme);
    const places = GaiaMind.exploreRegions(exploreTheme);

    let html = `<button id="explore-back" style="background:none;border:none;color:#3FBFA8;font-family:inherit;font-size:13px;cursor:pointer;padding:0;margin-bottom:14px">&larr; All themes</button>`;
    html += `<p style="font-family:Marcellus,serif;font-size:22px;color:#E8EDF2">${t.label}</p>`;
    html += `<div style="display:flex;gap:18px;margin:12px 0 18px;font-size:12.5px;color:#8B98A8">
      <span><span style="color:#D9A441">${sum.worse}</span> worse</span>
      <span><span style="color:#3FBFA8">${sum.better}</span> better</span>
      <span><span style="color:#C9B8F0">${sum.resonance}</span> resonate</span>
    </div>`;

    if (sum.total >= 10 && (sum.concernsWorse.length || sum.concernsBetter.length)) {
      if (sum.concernsWorse.length)
        html += `<div style="font-size:12.5px;color:#8B98A8;margin-bottom:6px">Recurring where worse: <span style="color:#E8EDF2">${sum.concernsWorse.join(", ")}</span></div>`;
      if (sum.concernsBetter.length)
        html += `<div style="font-size:12.5px;color:#8B98A8;margin-bottom:14px">Recurring where better: <span style="color:#E8EDF2">${sum.concernsBetter.join(", ")}</span></div>`;
    }

    if (places.length) {
      html += `<p class="about-sub">By place</p>`;
      html += places.map(p => `
        <div style="display:flex;justify-content:space-between;align-items:baseline;padding:9px 0;border-bottom:1px solid rgba(120,160,170,0.1)">
          <span style="font-size:14px;color:#E8EDF2">${p.place}</span>
          <span style="font-size:11.5px;color:#56616F">${p.voices} voice${p.voices === 1 ? "" : "s"} · <span style="color:#D9A441">${p.worse}↓</span> <span style="color:#3FBFA8">${p.better}↑</span></span>
        </div>`).join("");
    } else {
      html += `<p style="font-size:13px;color:#8B98A8">No located voices in this theme yet. When people share what they're experiencing here, places will appear.</p>`;
    }
    body.innerHTML = html;

    const back = document.getElementById("explore-back");
    if (back) back.addEventListener("click", () => { exploreTheme = null; renderExplore(); });
  } else {
    /* theme list with counts */
    body.innerHTML = GaiaMind.voiceThemes.map(t => {
      const s = GaiaMind.exploreThemeSummary(t.key);
      return `<button class="explore-theme" data-key="${t.key}" style="display:flex;justify-content:space-between;align-items:center;width:100%;text-align:left;background:rgba(255,255,255,0.03);border:1px solid var(--line);border-radius:12px;padding:14px 16px;margin-bottom:10px;color:var(--text-soft);font-family:inherit;cursor:pointer">
        <span style="font-size:14px;color:#E8EDF2">${t.label}</span>
        <span style="font-size:12px;color:#56616F">${s.total} voice${s.total === 1 ? "" : "s"} &rarr;</span>
      </button>`;
    }).join("");
    body.querySelectorAll(".explore-theme").forEach(btn => {
      btn.addEventListener("click", () => { exploreTheme = btn.dataset.key; renderExplore(); });
    });
  }
}

function setupExplore() {
  const modal = document.getElementById("explore");
  const open = document.getElementById("explore-open");
  if (!modal || !open) return;
  open.addEventListener("click", () => { exploreTheme = null; renderExplore(); modal.classList.add("open"); });
  document.getElementById("explore-close").addEventListener("click", () => modal.classList.remove("open"));
  modal.addEventListener("click", e => { if (e.target === e.currentTarget) modal.classList.remove("open"); });
}

/* ---------- Your Contributions (local, no login) ---------- */

function loadContributions() {
  try { return JSON.parse(localStorage.getItem("gaia_contributions") || "[]"); }
  catch (e) { return []; }
}
function rememberContribution(c) {
  const list = loadContributions();
  list.unshift(c);
  try { localStorage.setItem("gaia_contributions", JSON.stringify(list.slice(0, 50))); } catch (e) {}
  refreshContributionsBadge();
}
function refreshContributionsBadge() {
  const btn = document.getElementById("contrib-open");
  if (!btn) return;
  const n = loadContributions().length;
  btn.style.display = n ? "block" : "none";
  btn.textContent = n === 1 ? "Your voice" : `Your voices (${n})`;
}
function renderContributions() {
  const body = document.getElementById("contrib-body");
  const list = loadContributions();
  if (!list.length) {
    body.innerHTML = `<p style="font-size:13px;color:#8B98A8">You haven't spoken to Gaia yet. When you do, your voices will be remembered here — on this device only, never tied to your name.</p>`;
    return;
  }
  body.innerHTML = list.map(c => {
    const col = c.direction === "better" ? "#3FBFA8" : "#D9A441";
    const d = new Date(c.date);
    const when = d.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
    return `<div style="padding:12px 0;border-bottom:1px solid rgba(120,160,170,0.1)">
      <div style="display:flex;justify-content:space-between;align-items:baseline">
        <span style="font-size:14px;color:#E8EDF2">${c.theme}</span>
        <span style="font-size:11.5px;color:#56616F">${when}</span>
      </div>
      <div style="font-size:12px;color:#8B98A8;margin-top:3px">${c.place} · contributes to <span style="color:${col}">${c.layer2}</span></div>
    </div>`;
  }).join("") +
  `<p style="font-size:11.5px;color:#56616F;margin-top:14px;font-style:italic">Stored only on this device. Gaia keeps no account of who you are.</p>`;
}

function setupContributions() {
  const modal = document.getElementById("contrib");
  const open = document.getElementById("contrib-open");
  if (!modal || !open) return;
  open.addEventListener("click", () => { renderContributions(); modal.classList.add("open"); });
  document.getElementById("contrib-close").addEventListener("click", () => modal.classList.remove("open"));
  modal.addEventListener("click", e => { if (e.target === e.currentTarget) modal.classList.remove("open"); });
  refreshContributionsBadge();
}

/* ---------- Mobile sheet: relocate pulse + legend on phones ---------- */

function setupMobileSheet() {
  const dock = document.getElementById("mobile-dock");
  const sheet = document.getElementById("mobile-sheet");
  const body = document.getElementById("mobile-sheet-body");
  if (!dock || !sheet || !body) return;

  const isMobile = () => window.matchMedia("(max-width: 720px)").matches;

  function placeInSheet() {
    const pulse = document.querySelector(".panel .pulse");
    const legend = document.querySelector(".panel .legend");
    if (pulse && pulse.parentElement !== body) body.appendChild(pulse);
    if (legend && legend.parentElement !== body) body.appendChild(legend);
  }
  function placeInPanel() {
    const panel = document.querySelector(".panel");
    const footer = document.querySelector(".panel-footer");
    const pulse = document.getElementById("pulse-planet") ? document.querySelector("#mobile-sheet-body .pulse") : null;
    const legend = document.querySelector("#mobile-sheet-body .legend");
    if (pulse) panel.insertBefore(pulse, footer);
    if (legend) panel.insertBefore(legend, footer);
  }

  if (isMobile()) placeInSheet();

  dock.addEventListener("click", () => { placeInSheet(); sheet.classList.add("open"); });
  document.getElementById("mobile-sheet-close").addEventListener("click", () =>
    sheet.classList.remove("open"));
  sheet.addEventListener("click", e => {
    if (e.target === sheet) sheet.classList.remove("open");
  });

  window.addEventListener("resize", () => {
    if (isMobile()) placeInSheet();
    else { placeInPanel(); sheet.classList.remove("open"); }
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
  wire("leg-planet", v => { showVoices = v; refreshPoints(); });
  wire("leg-well",   v => { showWell = v; globe.hexPolygonColor(hexColor); });
}

setupSpeak();
setupHumanityPulse();
setupMobileSheet();
setupContributions();
setupExplore();
setupShare();
setupLegend();
init();
