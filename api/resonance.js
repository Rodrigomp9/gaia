/* ============================================================
   GAIA — RESONANCE (server side)
   ------------------------------------------------------------
   "I feel the same" — not a like, not an upvote.
   No popularity, no individuals: each resonance is an
   anonymous confirmation that strengthens a pattern.

   POST: { theme, lat?, lng? }  -> stores one resonance
   GET:  -> { total, byTheme }  -> aggregated counts only

   Uses the same env vars as the voices channel:
   SUPABASE_URL, SUPABASE_SERVICE_KEY
   ============================================================ */

const THEMES = ["cost", "safety", "health", "work", "education", "environment"];

module.exports = async (req, res) => {
  const SB_URL = (process.env.SUPABASE_URL || "").trim().replace(/\/+$/, "");
  const SB_KEY = (process.env.SUPABASE_SERVICE_KEY || "").trim();

  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (!SB_URL || !SB_KEY) {
    res.status(503).json({ error: "not configured", has_url: !!SB_URL, has_key: !!SB_KEY });
    return;
  }

  const sbHeaders = { apikey: SB_KEY, "Content-Type": "application/json" };
  if (SB_KEY.startsWith("eyJ")) sbHeaders.Authorization = "Bearer " + SB_KEY;

  const sb = (path, opts = {}) =>
    fetch(SB_URL + "/rest/v1/" + path, {
      ...opts,
      headers: { ...sbHeaders, ...(opts.headers || {}) }
    });

  try {

    if (req.method === "POST") {
      let b = req.body;
      if (typeof b === "string") { try { b = JSON.parse(b); } catch (e) { b = {}; } }
      b = b || {};

      const theme = String(b.theme || "");
      if (!THEMES.includes(theme)) {
        res.status(400).json({ error: "unknown theme" });
        return;
      }

      let lat = b.lat == null ? NaN : Number(b.lat);
      let lng = b.lng == null ? NaN : Number(b.lng);

      const row = {
        theme,
        lat: isFinite(lat) ? Math.round(lat * 10) / 10 : null,
        lng: isFinite(lng) ? Math.round(lng * 10) / 10 : null
      };

      const r = await sb("resonance", {
        method: "POST",
        body: JSON.stringify(row),
        headers: { Prefer: "return=minimal" }
      });

      if (r.ok || r.status === 201) res.status(201).json({ resonated: true });
      else res.status(502).json({ error: "could not store resonance" });
      return;
    }

    if (req.method === "GET") {
      const r = await sb("resonance?select=theme&limit=10000");
      if (!r.ok) { res.status(502).json({ error: "could not read" }); return; }
      const rows = await r.json();
      const byTheme = {};
      rows.forEach(v => { byTheme[v.theme] = (byTheme[v.theme] || 0) + 1; });
      res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=120");
      res.status(200).json({ total: rows.length, byTheme });
      return;
    }

    res.status(405).json({ error: "method not allowed" });

  } catch (e) {
    res.status(500).json({ error: "internal", detail: String(e && e.message || e).slice(0, 300) });
  }
};
