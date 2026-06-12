/* ============================================================
   GAIA — MIND LAYER (Phase 3)
   ------------------------------------------------------------
   This is where Gaia listens to the world.

   Sense 1 — The planet's pulse: live seismic signals (USGS).
   Sense 2 — Humanity's state: real country indicators from
             the World Bank open data API — education, health,
             safety, environment. Patient, solid data.

   The mind never touches the interface directly. It only
   fills GaiaData. The interface reads from there.
   ============================================================ */

const GaiaMind = {

  /* ---------- Shared fetch with patience and backup routes ---------- */

  async fetchJson(url, preferred = []) {
    const routes = [
      ...preferred,
      url,
      "https://api.allorigins.win/raw?url=" + encodeURIComponent(url)
    ];
    for (const r of routes) {
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 12000);
        const res = await fetch(r, { signal: ctrl.signal });
        clearTimeout(timer);
        if (!res.ok) continue;
        return await res.json();
      } catch (e) { /* try next route */ }
    }
    throw new Error("all routes failed");
  },

  /* ---------- Sense 1: the planet ---------- */

  planetSource:
    "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_week.geojson",

  async listenPlanet() {
    try {
      const res = await fetch(this.planetSource);
      const raw = await res.json();

      const signals = raw.features.map(f => ({
        type: "planet",
        lat: f.geometry.coordinates[1],
        lng: f.geometry.coordinates[0],
        mag: f.properties.mag || 0,
        place: f.properties.place || "Unknown",
        time: f.properties.time
      }));

      GaiaData.planetSignals = signals;
      GaiaData.globalPulse.planetSignals = signals.length;
      return signals;
    } catch (err) {
      GaiaData.globalPulse.planetSignals = "offline";
      return [];
    }
  },

  /* ---------- Sense 2: humanity (World Bank) ---------- */

  humanIndicators: [
    { key: "children",    label: "A future for the children",
      sub: "Primary school enrollment", code: "SE.PRM.ENRR",
      unit: "%",      invert: false },
    { key: "health",      label: "Health and care",
      sub: "Life expectancy",           code: "SP.DYN.LE00.IN",
      unit: " yrs",   invert: false },
    { key: "safety",      label: "Safety and peace",
      sub: "Homicide rate",             code: "VC.IHR.PSRC.P5",
      unit: " /100k", invert: true },
    { key: "environment", label: "The planet we share",
      sub: "Forest cover",              code: "AG.LND.FRST.ZS",
      unit: "%",      invert: false }
  ],

  async listenHumanity() {
    const byIso = {};

    for (const ind of this.humanIndicators) {
      try {
        const url =
          "https://api.worldbank.org/v2/country/all/indicator/" +
          ind.code + "?format=json&mrnev=1&per_page=400";
        const data = await this.fetchJson(url);
        const rows = (data && data[1]) || [];
        rows.forEach(r => {
          if (r.value == null) return;
          const iso = r.countryiso3code;
          if (!iso || iso.length !== 3) return;
          if (!byIso[iso]) byIso[iso] = { name: r.country && r.country.value };
          byIso[iso][ind.key] = r.value;
        });
      } catch (e) { /* one quiet indicator never silences the others */ }
    }

    /* Normalize each indicator across countries (0..1),
       then average into a single "shared wellbeing" score. */
    const isos = Object.keys(byIso);
    this.humanIndicators.forEach(ind => {
      const vals = isos.map(i => byIso[i][ind.key]).filter(v => v != null);
      if (!vals.length) return;
      const mn = Math.min(...vals), mx = Math.max(...vals);
      isos.forEach(i => {
        const v = byIso[i][ind.key];
        if (v == null) return;
        let n = mx > mn ? (v - mn) / (mx - mn) : 0.5;
        if (ind.invert) n = 1 - n;
        byIso[i][ind.key + "_n"] = n;
      });
    });
    isos.forEach(i => {
      const ns = this.humanIndicators
        .map(ind => byIso[i][ind.key + "_n"])
        .filter(n => n != null);
      byIso[i].score = ns.length
        ? ns.reduce((a, b) => a + b, 0) / ns.length
        : null;
    });

    /* World averages — the mirror every nation is compared against */
    const worldMeans = {};
    this.humanIndicators.forEach(ind => {
      const vs = isos.map(i => byIso[i][ind.key]).filter(v => v != null);
      if (vs.length) worldMeans[ind.key] = vs.reduce((a, b) => a + b, 0) / vs.length;
    });
    GaiaData.worldMeans = worldMeans;

    GaiaData.humanIndex = byIso;
    GaiaData.globalPulse.humanSignals = isos.length || "offline";
    GaiaData.globalPulse.status = isos.length
      ? "Listening to the world"
      : "Listening";
    return byIso;
  },

  /* ---------- The first synthesis ----------
     Gaia's first act of interpretation: reading her own data
     and revealing what unites — computed, never invented. */

  synthesize() {
    const idx = GaiaData.humanIndex;
    if (!idx) return [];

    const entries = Object.values(idx);
    const lines = [];

    const vals = key => entries.map(e => e[key]).filter(v => v != null);
    const mean = a => a.reduce((s, v) => s + v, 0) / a.length;
    const pct = (a, f) => Math.round(100 * a.filter(f).length / a.length);

    const life = vals("health");
    if (life.length) {
      lines.push(
        `Across ${life.length} nations, a child born today can expect ` +
        `${Math.round(mean(life))} years of life — and in ${pct(life, v => v >= 70)}% ` +
        `of them, more than seventy.`
      );
    }

    const enroll = vals("children");
    if (enroll.length) {
      lines.push(
        `In ${pct(enroll, v => v >= 90)}% of countries, nearly every child ` +
        `begins school. The future is being taught, everywhere.`
      );
    }

    const safety = vals("safety");
    if (safety.length) {
      lines.push(
        `${pct(safety, v => v < 5)}% of the world's nations live with low ` +
        `violence. Peace is not the exception — it is the quiet majority.`
      );
    }

    const forest = vals("environment");
    if (forest.length) {
      lines.push(
        `Forests still cover about ${Math.round(mean(forest))}% of the ` +
        `average nation. The planet we share is still holding on.`
      );
    }

    if (GaiaData.planetSignals && GaiaData.planetSignals.length) {
      lines.push(
        `The Earth itself pulsed ${GaiaData.planetSignals.length} times this ` +
        `week — beneath all of us, equally.`
      );
    }

    GaiaData.synthesis = lines;
    return lines;
  },

  /* ---------- Daily Insight ----------
     One discovery per day. Deterministic by date — everyone
     on Earth sees the same insight today. All computed. */

  dailyInsight() {
    const idx = GaiaData.humanIndex;
    if (!idx) return null;
    const entries = Object.entries(idx)
      .map(([iso, e]) => ({ iso, ...e }))
      .filter(e => e.name);

    const best = (key, dir) => entries
      .filter(e => e[key] != null)
      .sort((a, b) => dir * (b[key] - a[key]))[0];

    const candidates = [];
    const r1 = v => Math.round(v * 10) / 10;

    const longLife = best("health", 1);
    if (longLife) candidates.push(
      `Nowhere on Earth do children live longer than in ${longLife.name} — around ${Math.round(longLife.health)} years.`);

    const safest = best("safety", -1);
    if (safest) candidates.push(
      `${safest.name} holds the quietest streets on Earth — about ${r1(safest.safety)} homicides per 100,000 people.`);

    const greenest = best("environment", 1);
    if (greenest) candidates.push(
      `${greenest.name} remains one of the greenest places alive — forests cover ${Math.round(greenest.environment)}% of its land.`);

    const lifes = entries.map(e => e.health).filter(v => v != null);
    if (lifes.length) {
      const above70 = Math.round(100 * lifes.filter(v => v >= 70).length / lifes.length);
      candidates.push(
        `In ${above70}% of the world's nations, a child born today can expect more than seventy years of life.`);
    }

    const homs = entries.map(e => e.safety).filter(v => v != null);
    if (homs.length) {
      const calm = Math.round(100 * homs.filter(v => v < 5).length / homs.length);
      candidates.push(
        `${calm}% of nations live with low violence. Peace is the quiet majority of the Earth.`);
    }

    if (GaiaData.planetSignals && GaiaData.planetSignals.length) {
      candidates.push(
        `The Earth pulsed ${GaiaData.planetSignals.length} times this week — felt beneath every border equally.`);
    }

    if (!candidates.length) return null;
    const day = Math.floor(Date.now() / 86400000);
    return candidates[day % candidates.length];
  },

  /* ---------- Narrative — Gaia speaks about a place ----------
     Same data, told as understanding. Every sentence is
     computed from real numbers; nothing is invented. */

  narrate(entry) {
    const w = GaiaData.worldMeans || {};
    const out = [];
    const r1 = v => Math.round(v * 10) / 10;

    const life = entry.health;
    if (life != null) {
      const d = w.health != null ? life - w.health : null;
      let cmp = "";
      if (d != null) {
        cmp = Math.abs(d) < 1.5 ? " — close to the world average"
          : d > 0 ? ` — about ${Math.round(d)} years above the world average`
          : ` — about ${Math.round(-d)} years below the world average`;
      }
      out.push(`A child born here today can expect to live around <b>${Math.round(life)} years</b>${cmp}.`);
    }

    const enroll = entry.children;
    if (enroll != null) {
      out.push(enroll >= 95
        ? `Nearly every child here begins school.`
        : enroll >= 80
        ? `Most children here begin school, though some are still left outside.`
        : `Many children here are still outside primary education — one of this place's heaviest signals.`);
    }

    const hom = entry.safety;
    if (hom != null) {
      const wm = w.safety;
      out.push(hom < 2
        ? `Violence here is rare — around <b>${r1(hom)}</b> homicides per 100,000 people, among the quietest grounds on Earth.`
        : hom < (wm || 6)
        ? `Around <b>${r1(hom)}</b> homicides per 100,000 people are recorded here — below the world's average noise.`
        : `Safety weighs here: around <b>${r1(hom)}</b> homicides per 100,000 people, above the world average.`);
    }

    const forest = entry.environment;
    if (forest != null) {
      out.push(forest >= 50
        ? `Forests still hold <b>${Math.round(forest)}%</b> of this land — a rare green endurance.`
        : forest >= 20
        ? `Forests cover about <b>${Math.round(forest)}%</b> of this land.`
        : `Little forest remains here — about <b>${Math.round(forest)}%</b> of the land.`);
    }

    return out;
  },

  /* Find a country's data from a globe feature.
     ISO first; name match as fallback (some geojson entries
     carry broken ISO codes, e.g. France in Natural Earth). */
  indexFor(feature) {
    if (!GaiaData.humanIndex) return null;
    if (feature.__gaiaEntry !== undefined) return feature.__gaiaEntry;

    const iso = feature.properties.ISO_A3;
    let entry = GaiaData.humanIndex[iso] || null;

    if (!entry) {
      const admin = (feature.properties.ADMIN || "").toLowerCase();
      for (const k of Object.keys(GaiaData.humanIndex)) {
        const n = (GaiaData.humanIndex[k].name || "").toLowerCase();
        if (n && (n === admin || admin.includes(n) || n.includes(admin))) {
          entry = GaiaData.humanIndex[k];
          break;
        }
      }
    }
    feature.__gaiaEntry = entry;
    return entry;
  },

  /* ---------- Sense 3: voices spoken to Gaia ---------- */

  async listenVoices() {
    try {
      const res = await fetch("/api/voice");
      if (!res.ok) throw new Error("offline");
      const data = await res.json();
      GaiaData.voicePoints = (data.points || [])
        .filter(p => !(p.lat === 0 && p.lng === 0))
        .map(p => ({ type: "voice", ...p }));
      GaiaData.voiceByTheme = data.byTheme || {};
      GaiaData.globalPulse.voices = data.total || 0;
      return GaiaData.voicePoints;
    } catch (e) {
      /* Local preview or channel not configured — stay calm */
      GaiaData.voicePoints = [];
      GaiaData.globalPulse.voices = "—";
      return [];
    }
  },

  voicesNear(lat, lng) {
    const pts = this.near(GaiaData.voicePoints, lat, lng, 8);
    const total = pts.reduce((s, p) => s + p.count, 0);
    const byTheme = {};
    pts.forEach(p => { byTheme[p.theme] = (byTheme[p.theme] || 0) + p.count; });
    let top = null;
    Object.entries(byTheme).forEach(([t, c]) => {
      if (!top || c > top.count) top = { theme: t, count: c };
    });
    return { total, top };
  },

  /* ---------- Proximity (planet signals) ---------- */

  near(arr, lat, lng, degrees = 12) {
    if (!arr) return [];
    return arr.filter(s =>
      Math.abs(s.lat - lat) < degrees &&
      Math.abs(((s.lng - lng + 540) % 360) - 180) < degrees
    );
  },

  planetNear(lat, lng) {
    return this.near(GaiaData.planetSignals, lat, lng).length;
  }
};
