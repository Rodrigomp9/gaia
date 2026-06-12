/* ============================================================
   GAIA — DATA LAYER
   ------------------------------------------------------------
   This file is the only place the interface reads data from.
   In Phase 3, Gaia's intelligence will feed this layer with
   real synthesized patterns. The interface will not change.

   Everything below is DEMO DATA — placeholders that show how
   the platform will look once real signals flow in.
   ============================================================ */

const GaiaData = {

  /* Global pulse — the headline numbers shown on the left panel */
  globalPulse: {
    planetSignals: "—",
    humanSignals: "—",
    voices: "—",
    status: "Listening"
  },

  /* Live layers — filled by the mind (js/mind.js) */
  planetSignals: null,
  humanSignals: null,
  voicePoints: null,
  voiceByTheme: null,
  resonanceByTheme: null,
  resonanceTotal: 0,

  /* Shared human themes — what Gaia will eventually reveal.
     Order = global relevance. Values are demo percentages. */
  sharedThemes: [
    { theme: "Safety for our families", strength: 0 },
    { theme: "A future for our children", strength: 0 },
    { theme: "Dignity in daily life", strength: 0 },
    { theme: "Health and care", strength: 0 },
    { theme: "Being heard", strength: 0 }
  ],

  /* Per-country demo signals.
     Key = ISO A3 code from the geojson (e.g. "BRA", "USA").
     In Phase 3 this object is replaced by live API data. */
  countrySignals: {
    /* Example shape — kept empty on purpose.
       Gaia waits before concluding. */
  },

  /* Message shown when a region has no synthesized data yet */
  emptyRegionMessage: "Gaia is listening here. Patterns will emerge with time — collective questions are never rushed."
};
