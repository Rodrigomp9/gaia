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

const THEMES = ["children", "health", "safety", "environment"];

module.exports = async (req, res) => {
  const SB_URL = process.env.SUPABASE_URL;
  const SB_KEY = process.env.SUPABASE_SERVICE_KEY;

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

    const theme = String(b.theme || "");
    const message = String(b.message || "").trim().slice(0, 280);
    let lat = Number(b.lat), lng = Number(b.lng);

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
      message,
      lat,
      lng,
      place: String(b.place || "").slice(0, 120) || null
    };

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
    const r = await sb("voices?select=theme,lat,lng&limit=5000");
    if (!r.ok) {
      res.status(502).json({ error: "could not read voices" });
      return;
    }
    const rows = await r.json();

    const byTheme = {};
    const cluster = {};
    rows.forEach(v => {
      byTheme[v.theme] = (byTheme[v.theme] || 0) + 1;
      if (v.lat == null || v.lng == null) return;
      const k = v.lat + "|" + v.lng + "|" + v.theme;
      if (!cluster[k]) cluster[k] = { lat: v.lat, lng: v.lng, theme: v.theme, count: 0 };
      cluster[k].count++;
    });

    res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=120");
    res.status(200).json({
      total: rows.length,
      byTheme,
      points: Object.values(cluster)
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
