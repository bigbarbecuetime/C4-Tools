/* Shared spoilage-lifetime vocabulary for the C4 web tools.
 *
 * Every lifetime in the plugin is a whole number of minutes on one roughly
 * real-time scale, and config.yml's `vanilla_foods` block is the reference set
 * that scale is calibrated against (raw fish = one real week). Both the config
 * editor and the consumable designer used to carry their own copy of the unit
 * table and their own hand-written "useful values" list, which drifted from the
 * shipped config the moment anyone retuned it.
 *
 * This module is the single source: the units come from here, and the example
 * lifetimes are SAMPLED FROM THE CONFIG ITSELF (tools/config-editor/default-config.js,
 * which `./gradlew syncConfigEditorDefaults` keeps byte-identical to
 * src/main/resources/config.yml), so retuning a food in config.yml moves the
 * examples the tools show.
 *
 * Usage:
 *   Lifetimes.format(10080)   -> "1 week"
 *   Lifetimes.defaultMinutes() -> 10080
 *   Lifetimes.samples()        -> [{ material, minutes, label }, ...] ascending
 *   Lifetimes.tableHtml()      -> a .ref-table of those samples
 */
"use strict";

const Lifetimes = (() => {
  /** Minutes per named unit, longest first, as config.yml documents them. */
  const UNITS = [
    [43200, "month"],
    [10080, "week"],
    [1440, "day"],
    [60, "hour"],
    [1, "minute"],
  ];

  /** Fallback when the bundled config asset is not loaded on this page. */
  const FALLBACK_DEFAULT = 10080;

  let cached; // parsed vanilla_foods section, or null; computed once

  /**
   * The shipped config's `vanilla_foods` section, or null when the page did not
   * load default-config.js (or the parse failed - a tool must still work).
   */
  function vanillaFoods() {
    if (cached !== undefined) return cached;
    cached = null;
    try {
      if (typeof C4_DEFAULT_CONFIG_YAML === "string" && typeof YAMLLite === "object") {
        const parsed = YAMLLite.parse(C4_DEFAULT_CONFIG_YAML);
        const section = parsed && parsed.vanilla_foods;
        if (section && typeof section === "object") cached = section;
      }
    } catch (e) {
      cached = null;
    }
    return cached;
  }

  /** `vanilla_foods.default_lifetime_minutes`, or the built-in fallback. */
  function defaultMinutes() {
    const vf = vanillaFoods();
    const n = vf && Number(vf.default_lifetime_minutes);
    return Number.isFinite(n) && n > 0 ? n : FALLBACK_DEFAULT;
  }

  /**
   * A lifetime in words: "1 week", "10 days", "3 weeks 3 days", or
   * "never spoils" for 0, matching how config.yml describes the scale.
   */
  function format(value) {
    const raw = Math.max(0, Number(value) || 0);
    // Crop growth times are allowed to be fractional minutes, where rounding to
    // whole minutes would report 0.5 as "1 minute". Food lifetimes are always
    // whole minutes, so this branch never fires for them.
    if (raw > 0 && raw < 1) {
      const seconds = Math.max(1, Math.round(raw * 60));
      return seconds + " second" + (seconds === 1 ? "" : "s");
    }
    let remaining = Math.round(raw);
    if (remaining === 0) return "never spoils";
    const parts = [];
    for (const [size, label] of UNITS) {
      const count = Math.floor(remaining / size);
      if (!count) continue;
      parts.push(count + " " + label + (count === 1 ? "" : "s"));
      remaining %= size;
    }
    return parts.join(" ");
  }

  /** Title case for a MATERIAL_NAME, for display only. */
  function prettyMaterial(name) {
    return String(name).toLowerCase().split("_").filter(Boolean)
      .map(w => w[0].toUpperCase() + w.slice(1)).join(" ");
  }

  /**
   * Example lifetimes taken from the shipped config: one representative food
   * per distinct duration, ascending, so the spread shows the whole scale from
   * the most perishable item to the ones that never spoil. Returns [] when the
   * config asset is not loaded.
   */
  function samples() {
    const vf = vanillaFoods();
    const items = vf && vf.items;
    if (!items || typeof items !== "object") return [];
    const byDuration = new Map();
    for (const [material, raw] of Object.entries(items)) {
      const minutes = Number(raw);
      if (!Number.isFinite(minutes)) continue;
      // First food listed for a duration wins, so the order follows config.yml's
      // own grouping (raw meat, cooked, produce, pantry, preserved).
      if (!byDuration.has(minutes)) byDuration.set(minutes, material);
    }
    // 0 means "never spoils", which belongs at the long end of the scale
    // rather than sorting below three days.
    const rank = (m) => (m === 0 ? Infinity : m);
    return [...byDuration.entries()]
      .sort((a, b) => rank(a[0]) - rank(b[0]))
      .map(([minutes, material]) => ({
        material,
        minutes,
        name: prettyMaterial(material),
        label: format(minutes),
      }));
  }

  function esc(s) {
    return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;");
  }

  /**
   * The samples as a `.ref-table`, or a plain note when the config asset is
   * missing so the section never renders an empty table.
   */
  function tableHtml(caption) {
    const rows = samples();
    if (!rows.length) {
      return '<p class="hint">1 day = 1440 &middot; 1 week = 10080 &middot; 1 month = 43200</p>';
    }
    const body = rows.map(r =>
      `<tr><th scope="row">${esc(r.name)}</th><td>${r.minutes}</td><td>${esc(r.label)}</td></tr>`
    ).join("");
    return `<table class="ref-table">
      <caption>${esc(caption || "Example lifetimes")}</caption>
      <thead><tr><th scope="col">Food</th><th scope="col">Minutes</th><th scope="col">Keeps for</th></tr></thead>
      <tbody>${body}</tbody>
    </table>`;
  }

  return { UNITS, defaultMinutes, format, samples, tableHtml, vanillaFoods };
})();

if (typeof window !== "undefined") window.Lifetimes = Lifetimes;
