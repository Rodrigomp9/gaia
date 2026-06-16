/* ============================================================
   GAIA — THE LISTENING CHANNEL (server side)
   ------------------------------------------------------------
   POST: a human speaks to Gaia. Stored anonymously.
         Coordinates are rounded to ~11km on arrival —
         privacy by design. Raw text is stored for future
         synthesis but NEVER displayed individually.
   GET:  aggregated patterns only — counts by theme and by
         rounded location. Gaia reveals patterns, not posts.

   Requires env vars on Vercel:
     SUPABASE_URL, SUPABASE_SERVICE_KEY
   ============================================================ */

const THEMES = ["cost", "safety", "health", "work", "education", "environment"];
/* Legacy themes from before Phase 7 are remapped, never rejected */
const LEGACY = { children: "education", "health care": "health", "public safety": "safety" };

module.exports = async (req, res) => {
  /* Normalize: trim spaces, strip trailing slashes */
  const SB_URL = (process.env.SUPABASE_URL || "").trim().replace(/\/+$/, "");
  const SB_KEY = (process.env.SUPABASE_SERVICE_KEY || "").trim();

  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (!SB_URL || !SB_KEY) {
    res.status(503).json({
      error: "listening channel not configured yet",
      has_url: !!SB_URL,
      has_key: !!SB_KEY
    });
    return;
  }

  /* Self-diagnosis: the URL must look like a Supabase project URL */
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(SB_URL)) {
    res.status(503).json({
      error: "SUPABASE_URL looks wrong",
      url_seen: SB_URL,
      expected_shape: "https://xxxxxxxx.supabase.co"
    });
    return;
  }

  try {

  /* Supports both Supabase key formats:
     legacy JWT keys (eyJ...) and new secret keys (sb_secret_...) */
  const sbHeaders = {
    apikey: SB_KEY,
    "Content-Type": "application/json"
  };
  if (SB_KEY.startsWith("eyJ")) {
    sbHeaders.Authorization = "Bearer " + SB_KEY;
  }

  const sb = (path, opts = {}) =>
    fetch(SB_URL + "/rest/v1/" + path, {
      ...opts,
      headers: { ...sbHeaders, ...(opts.headers || {}) }
    });

  /* ---------- A voice arrives ---------- */
  if (req.method === "POST") {
    let b = req.body;
    if (typeof b === "string") { try { b = JSON.parse(b); } catch (e) { b = {}; } }
    b = b || {};

    let theme = String(b.theme || "");
    if (LEGACY[theme]) theme = LEGACY[theme];
    let direction = String(b.direction || "worse");
    if (direction !== "worse" && direction !== "better") direction = "worse";
    const message = String(b.message || "").trim().slice(0, 500);
    /* null/absent stays null — Number(null) would become 0,0:
       a phantom voice floating in the Atlantic */
    let lat = b.lat == null ? NaN : Number(b.lat);
    let lng = b.lng == null ? NaN : Number(b.lng);

    if (!THEMES.includes(theme)) {
      res.status(400).json({ error: "unknown theme" });
      return;
    }
    if (message.length < 2) {
      res.status(400).json({ error: "message too short" });
      return;
    }

    /* Privacy by design: never store precise coordinates */
    lat = isFinite(lat) ? Math.round(lat * 10) / 10 : null;
    lng = isFinite(lng) ? Math.round(lng * 10) / 10 : null;

    const row = {
      theme,
      direction,
      message,
      lat,
      lng,
      place: String(b.place || "").slice(0, 120) || null
    };

    /* Basic spam guard (no login — keeps "anyone can speak"):
       reject exact duplicate of a very recent voice. */
    try {
      const dupUrl = "voices?select=id&message=eq." +
        encodeURIComponent(message) + "&theme=eq." + encodeURIComponent(theme) +
        "&created_at=gte." + new Date(Date.now() - 10 * 60 * 1000).toISOString() +
        "&limit=1";
      const dup = await sb(dupUrl);
      if (dup.ok) {
        const found = await dup.json();
        if (found.length) { res.status(200).json({ heard: true, deduped: true }); return; }
      }
    } catch (e) { /* if the check fails, continue — never block a real voice */ }

    const r = await sb("voices", {
      method: "POST",
      body: JSON.stringify(row),
      headers: { Prefer: "return=minimal" }
    });

    if (r.ok || r.status === 201) {
      res.status(201).json({ heard: true });
    } else {
      res.status(502).json({ error: "could not store voice" });
    }
    return;
  }

  /* ---------- Patterns, never posts ---------- */
  if (req.method === "GET") {
    const r = await sb("voices?select=theme,direction,lat,lng,message,created_at&limit=8000");
    if (!r.ok) {
      res.status(502).json({ error: "could not read voices" });
      return;
    }
    const rows = await r.json();

    const now = Date.now();
    const WEEK = 7 * 86400000;
    /* Stopwords across the languages people are most likely to use
       (English, Portuguese, Spanish). Keeps only meaningful words. */
    const STOP = new Set((
      /* EN */ "the a an and or but of to in on at for with from is are was were be been being i my we our you your it its this that these those they them their he she his her not no yes do does did have has had will would can could should about more most very just so if than then there here what when where who how why as also out up down over under into been being having only also even still much many lot lots get got make made " +
      /* PT */ "o a os as um uma uns umas de do da dos das em no na nos nas para por com sem que se já não sim muito muita muitos muitas mais menos est está estão estou esta este esta isso isto aqui ali aí ele ela eles elas eu meu minha nosso nossa seu sua tem têm ter foi era são pelo pela como quando onde porque qual quais mas e ou também ainda cada vez ano anos dia dias " +
      /* ES */ "el la los las un una unos unas de del en para por con sin que si ya no sí muy mucho mucha muchos muchas más menos está están estoy este esta esto aquí ahí él ella ellos ellas yo mi nuestro su tiene tienen tener fue era son como cuando donde porque cual cuales pero y o también aún cada vez año años día días"
    ).split(/\s+/).filter(Boolean));

    /* Two axes: deterioration (worse) and improvement (better) */
    const mk = () => ({ byTheme: {}, words: {} });
    const axis = { worse: mk(), better: mk() };
    const byTheme = {};      /* combined, for legacy callers */
    const cluster = {};
    const trendNow = {};
    const trendPrev = {};

    rows.forEach(v => {
      const dir = v.direction === "better" ? "better" : "worse";
      byTheme[v.theme] = (byTheme[v.theme] || 0) + 1;
      axis[dir].byTheme[v.theme] = (axis[dir].byTheme[v.theme] || 0) + 1;

      if (v.lat != null && v.lng != null) {
        const k = dir + "|" + v.lat + "|" + v.lng + "|" + v.theme;
        if (!cluster[k]) cluster[k] = { lat: v.lat, lng: v.lng, theme: v.theme, direction: dir, count: 0 };
        cluster[k].count++;
      }

      const age = v.created_at ? now - Date.parse(v.created_at) : Infinity;
      if (age <= WEEK) trendNow[v.theme] = (trendNow[v.theme] || 0) + 1;
      else if (age <= 2 * WEEK) trendPrev[v.theme] = (trendPrev[v.theme] || 0) + 1;

      if (v.message) {
        const wmap = axis[dir].words;
        wmap[v.theme] = wmap[v.theme] || {};
        String(v.message).toLowerCase()
          .replace(/[^a-z\u00C0-\u017F\s]/g, " ")
          .split(/\s+/)
          .forEach(w => {
            if (w.length < 4 || STOP.has(w)) return;
            wmap[v.theme][w] = (wmap[v.theme][w] || 0) + 1;
          });
      }
    });

    const topWords = wmap => {
      const out = {};
      Object.keys(wmap).forEach(t => {
        out[t] = Object.entries(wmap[t])
          .sort((a, b) => b[1] - a[1]).slice(0, 3)
          .filter(([w, c]) => c >= 2).map(([w]) => w);
      });
      return out;
    };

    res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=120");
    res.status(200).json({
      total: rows.length,
      byTheme,
      points: Object.values(cluster),
      trendNow,
      trendPrev,
      worse: { byTheme: axis.worse.byTheme, concerns: topWords(axis.worse.words) },
      better: { byTheme: axis.better.byTheme, concerns: topWords(axis.better.words) }
    });
    return;
  }

  res.status(405).json({ error: "method not allowed" });

  } catch (e) {
    /* Never crash silently — always explain */
    res.status(500).json({
      error: "internal",
      detail: String(e && e.message || e).slice(0, 300)
    });
  }
};
