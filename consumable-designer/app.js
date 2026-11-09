/* Consumable Designer - builds full consumables/ entries for the plugin:
 * identity, food block, toxicity, preparation process, ingredients with
 * shaped recipes, addiction/overdose and the misc tuning knobs.
 * YAML output matches ConsumableConfig's parser exactly.
 */
"use strict";

const STORE_KEY = "consumable-designer-v1";
const $ = (id) => document.getElementById(id);

// TODO: re-add "distill" and "ferment" once the still/crock stations have a
// survival recipe and finished presentation (see config.yml's stations
// section and docs/Work TODO and Note.md). The process types and minigames
// (DistillationGame, ferment/FermentManager) already work - only the
// station itself is unobtainable outside /c4 device right now.
const PROCESS_TYPES = ["cut", "fry", "stir", "sequence", "temperature",
                       "pound", "sieve", "lightning", "smelt"];
/** Process types that have no minigame GUI with difficulty/rounds unused. */
const NON_MINIGAME_TYPES = new Set(["ferment", "lightning", "smelt"]);
/**
 * Types that read `duration_seconds`, and what the number means to each - the
 * field is only shown for these, so an author is never asked for a cook time on
 * a process that has none. Ferment and distill are listed for when their
 * stations become obtainable; they are not selectable yet.
 */
const DURATION_MEANING = {
  temperature: "Game length",
  distill: "Game length",
  ferment: "Peak time",
  smelt: "Cook time",
};

/** The one-line explanation shown under the process selector. */
function processHint(type) {
  if (!type) return "No process: the ingredients craft instantly, always at full quality.";
  if (type === "smelt") {
    return "Smelting has no minigame and keeps the source item's quality. "
      + "It can only take one ingredient.";
  }
  if (type === "lightning") return "Struck by lightning rather than crafted. No minigame.";
  if (type === "ferment") return "Ferments in place. No minigame; the peak time sets the window.";
  return "A preparation minigame. Difficulty sets how hard it is, and rounds how many "
    + "rounds of the minigame run.";
}
/** Bukkit's PotionEffect duration is in ticks; the form asks for seconds. */
const TICKS_PER_SECOND = 20;
const EFFECT_TYPES = ["speed", "slowness", "haste", "strength", "weakness", "poison",
  "regeneration", "resistance", "fire_resistance", "water_breathing", "invisibility",
  "blindness", "night_vision", "hunger", "nausea", "wither", "absorption", "saturation",
  "levitation", "slow_falling", "glowing", "darkness", "jump_boost", "instant_health"];

function defaultEffect() {
  return { type: "speed", base_duration: 200, duration_per_unit: 100,
           base_amplifier: 0, amplifier_per_unit: 0, amplifier_cap: 2 };
}

function blankItem(id) {
  return {
    id: id || "new_item",
    name: "New Item",
    description: "",
    model: "minecraft:sugar_cane",
    headTexture: "",
    outputAmount: "1",
    outputItem: "",    // optional: craft yields this vanilla material instead of a custom item
    outputMode: "custom", // "custom" = a plugin item, "vanilla" = the plain outputItem
    insanity: 0,
    diet: "",          // mcMMO diet: "" none | "farmers" | "fishermans"
    food: { enabled: false, nutrition: 2, saturation: 1.0, seconds: 1.6,
            animation: "eat", alwaysEat: true,
            // Both follow the animation until edited; changing the animation
            // resets them to that animation's default.
            consumeParticles: defaultConsumeParticles("eat"),
            consumeSound: defaultConsumeSound("eat") },
    // Food that never spoils is the exception here, so a new draft starts
    // perishable. An uploaded config still reflects whatever it declares.
    perishable: { enabled: true, lifetimeMinutes: Lifetimes.defaultMinutes() },
    toxic: { enabled: false, grace: 10,
             effects: [{ type: "poison", duration: 100, amplifier: 0 }] },
    process: { enabled: false, type: "cut", difficulty: 1, rounds: 1, durationSeconds: "",
               furnaceTypes: { furnace: true, smoker: false, blast_furnace: false,
                               campfire: true, soul_campfire: true } },
    ingredients: [],
    shaped: false,          // shaped = the 3x3 pattern below; shapeless = any layout
    shape: ["", "", ""],
    addiction: { enabled: false, maxLevel: 1.0, decayPerTick: 0.001, effectSeverity: 1.0,
                 windowTicks: 36000, damageThresholdTicks: 72000, damagePerInterval: 0.5,
                 withdrawalCheckIntervalTicks: 100, overdoseThreshold: 0,
                 overdoseDurationTicks: 600, antidote: "" },
    events: makeEvents(),
  };
}

// Item event triggers (matches ItemEvents): on_consume when eaten, on_use on
// right-click, on_equip when drawn into either hand, while_holding/while_using
// looping for as long as the item is held / being used, on_punch on left-click.
// All cosmetic (never cancel the action).
const CONSUMABLE_TRIGGERS = ["on_consume", "on_use", "on_equip",
                             "while_holding", "while_using", "on_punch"];
// The two triggers that repeat. Each carries its own interval, written as the
// `{interval_ticks, effects}` map form; the plugin also accepts a plain list.
const LOOP_TRIGGERS = ["while_holding", "while_using"];
const DEFAULT_INTERVAL_TICKS = 10;
const MIN_INTERVAL_TICKS = 2;
// Crafting effects: either one general `on_craft`, or per-quality-tier overrides.
const CRAFT_TIERS = ["ruined", "poor", "decent", "good", "perfect"];
// Every vanilla ItemUseAnimation, matching model/UseAnimation.java. Most packs
// want eat/drink/none, but the rest are exposed rather than second-guessed.
const USE_ANIMATIONS = ["eat", "drink", "none", "block", "bow", "trident",
                        "crossbow", "spyglass", "toot_horn", "brush", "bundle", "spear"];

/**
 * Vanilla food values to size a custom one against, ordered by nutrition.
 * [name, nutrition, saturation] - saturation is the vanilla saturation
 * *modifier* times nutrition times two, i.e. the number the wiki lists.
 */
const VANILLA_FOOD_REFERENCE = [
  ["Cookie", 2, 0.4],
  ["Melon slice", 2, 1.2],
  ["Apple", 4, 2.4],
  ["Bread", 5, 6.0],
  ["Cooked cod", 5, 6.0],
  ["Cooked chicken", 6, 7.2],
  ["Cooked salmon", 6, 9.6],
  ["Golden carrot", 6, 14.4],
  ["Steak", 8, 12.8],
  ["Rabbit stew", 10, 12.0],
];

/** The reference table shown under the food fields. */
function vanillaFoodTable() {
  const rows = VANILLA_FOOD_REFERENCE
    .map(([name, nutrition, saturation]) =>
      `<tr><th scope="row">${name}</th><td>${nutrition}</td><td>${saturation.toFixed(1)}</td></tr>`)
    .join("");
  return `<table class="ref-table">
      <caption>Vanilla reference</caption>
      <thead><tr><th scope="col">Food</th><th scope="col">Nutrition</th><th scope="col">Saturation</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

/** Vanilla only scatters crumbs while eating. Mirrors UseAnimation.java. */
function defaultConsumeParticles(animation) {
  return animation === "eat";
}
/**
 * The sound vanilla plays while consuming: the eating sound for `eat`, the gulp
 * for `drink`, nothing for the rest. "" means "leave vanilla's own default",
 * which for `eat` is already the eating sound, so it is written out as nothing.
 */
function defaultConsumeSound(animation) {
  return animation === "eat" ? "" : animation === "drink" ? "ENTITY_GENERIC_DRINK" : "none";
}

/** A fresh events object for a consumable, including the crafting section. */
function makeEvents() {
  const e = EventsEditor.defaults(CONSUMABLE_TRIGGERS);
  e.on_craft = [];
  e.craftMode = "general";        // "general" = one on_craft; "tiers" = per-tier
  e.craftTiers = EventsEditor.defaults(CRAFT_TIERS);
  e.intervals = {};
  for (const t of LOOP_TRIGGERS) e.intervals[t] = DEFAULT_INTERVAL_TICKS;
  return e;
}

/** Clamp a loop interval the way the plugin does. */
function clampInterval(v) {
  const n = Math.round(num(v, DEFAULT_INTERVAL_TICKS));
  return isNaN(n) || n < MIN_INTERVAL_TICKS ? MIN_INTERVAL_TICKS : n;
}

/** Backfill craft fields on an events object loaded from an older draft/import. */
function normalizeEvents(e) {
  if (!e) return makeEvents();
  for (const t of CONSUMABLE_TRIGGERS) if (!Array.isArray(e[t])) e[t] = [];
  if (!e.intervals || typeof e.intervals !== "object") e.intervals = {};
  for (const t of LOOP_TRIGGERS) e.intervals[t] = clampInterval(e.intervals[t]);
  if (!Array.isArray(e.on_craft)) e.on_craft = [];
  if (e.craftMode !== "tiers") e.craftMode = "general";
  if (!e.craftTiers) e.craftTiers = EventsEditor.defaults(CRAFT_TIERS);
  for (const t of CRAFT_TIERS) if (!Array.isArray(e.craftTiers[t])) e.craftTiers[t] = [];
  return e;
}

/** Parse a YAML `events:` block (consume/use/punch + craft) into the editor model. */
function eventsFromYaml(o) {
  const e = EventsEditor.fromYaml(o, CONSUMABLE_TRIGGERS);
  o = o || {};
  // A looping trigger may arrive as a plain list (already handled above) or as
  // {interval_ticks, effects}. Unwrap the map form so the editor sees a list.
  e.intervals = {};
  for (const t of LOOP_TRIGGERS) {
    const raw = o[t];
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      e.intervals[t] = clampInterval(raw.interval_ticks);
      e[t] = EventsEditor.fromYaml({ effects: raw.effects }, ["effects"]).effects;
    } else {
      e.intervals[t] = DEFAULT_INTERVAL_TICKS;
    }
  }
  e.on_craft = EventsEditor.fromYaml(o, ["on_craft"]).on_craft;
  const tiers = o.on_craft_tiers;
  e.craftMode = (tiers && typeof tiers === "object") ? "tiers" : "general";
  e.craftTiers = EventsEditor.fromYaml(tiers || {}, CRAFT_TIERS);
  return e;
}

/**
 * Emit the combined `events:` block (flat triggers + crafting) for one item.
 * `craftOnly` drops every item-carried trigger, for a vanilla output: those fire
 * off the plugin id stamped on the item, which a vanilla output never gets.
 */
function eventsYaml(ev, pad, craftOnly) {
  // Looping triggers are emitted separately, in their interval-map form.
  const flat = craftOnly ? [] : CONSUMABLE_TRIGGERS.filter(t => !LOOP_TRIGGERS.includes(t));
  if (ev.craftMode !== "tiers") flat.push("on_craft");
  const flatHas = EventsEditor.hasAny(ev, flat);
  const loops = craftOnly ? [] : LOOP_TRIGGERS.filter(t => (ev[t] || []).some(EventsEditor.isReal));
  const tiersActive = ev.craftMode === "tiers"
    && CRAFT_TIERS.some(t => (ev.craftTiers[t] || []).some(EventsEditor.isReal));
  if (!flatHas && !loops.length && !tiersActive) return [];
  const L = [pad + "events:"];
  if (flatHas) L.push(...EventsEditor.triggerLines(ev, flat, pad + "  "));
  for (const t of loops) {
    L.push(`${pad}  ${t}:`);
    L.push(`${pad}    interval_ticks: ${clampInterval((ev.intervals || {})[t])}`);
    // triggerLines emits `<key>:` then the entries, so hand it a one-key view
    // named `effects` to get the nested effects list.
    L.push(...EventsEditor.triggerLines({ effects: ev[t] }, ["effects"], pad + "    "));
  }
  if (tiersActive) {
    L.push(pad + "  on_craft_tiers:");
    L.push(...EventsEditor.triggerLines(ev.craftTiers, CRAFT_TIERS, pad + "    "));
  }
  return L;
}

// Uploaded/created files live in shared/file-store.js (FileStore), not here
// - that keeps the file dock the same across every tool page.
function emptyState() { return { items: [], current: 0 }; }

let state = load();

function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const loaded = JSON.parse(raw);
      // forward-compat: fill fields added since the draft was saved
      for (const it of loaded.items || []) {
        if (!it.perishable) it.perishable = { enabled: false, lifetimeMinutes: Lifetimes.defaultMinutes() };
        if (it.headTexture == null) it.headTexture = "";
        if (!it.outputMode) it.outputMode = (it.outputItem || "").trim() ? "vanilla" : "custom";
        if (it.shaped == null) it.shaped = (it.shape || []).some(r => (r || "").trim());
        if (!it.process.furnaceTypes) it.process.furnaceTypes =
          { furnace: true, smoker: false, blast_furnace: false, campfire: true, soul_campfire: true };
        else if (it.process.furnaceTypes.campfire == null) {
          // Campfires arrived after this draft was saved: an unrestricted recipe
          // stays unrestricted, a restricted one keeps its exact selection.
          const ft = it.process.furnaceTypes;
          const unrestricted = ft.furnace !== false && ft.smoker !== false && ft.blast_furnace !== false;
          ft.campfire = unrestricted;
          ft.soul_campfire = unrestricted;
        }
        it.events = normalizeEvents(it.events);
      }
      // migrate: files used to live in this tool's own draft; move any into
      // the shared cross-page store, then drop the field for good.
      if (Array.isArray(loaded.files)) {
        for (const f of loaded.files) FileStore.remember(f.name, f.text);
        delete loaded.files;
      }
      return loaded;
    }
  } catch (e) { /* empty */ }
  return emptyState();
}
function save() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) { /* ignore */ }
}

// ── import (parse a consumables .yml back into the editor) ──────────────────

function itemFromYaml(id, o) {
  const it = blankItem(id);
  o = o || {};
  it.name = o.display_name || prettify(id);
  it.description = o.description || "";
  it.events = eventsFromYaml(o.events);
  if (o.item_model != null) it.model = String(o.item_model);
  if (o.head_texture != null) it.headTexture = String(o.head_texture);
  if (o.output_amount != null) it.outputAmount = String(o.output_amount);
  if (o.output_item != null) it.outputItem = String(o.output_item);
  // output_item is exactly what vanilla mode means, so the mode follows the key.
  it.outputMode = (it.outputItem || "").trim() ? "vanilla" : "custom";
  if (o.insanity_multiplier != null) it.insanity = num(o.insanity_multiplier, 0);
  it.diet = (o.mcmmo && o.mcmmo.diet != null) ? String(o.mcmmo.diet).toLowerCase() : "";

  if (o.food) {
    it.food = { enabled: true,
      nutrition: num(o.food.nutrition, 2), saturation: num(o.food.saturation, 1),
      seconds: num(o.food.seconds, 1.6), animation: o.food.animation || "eat",
      alwaysEat: o.food.can_always_eat !== false,
      consumeParticles: o.food.consume_particles == null
        ? defaultConsumeParticles(o.food.animation || "eat")
        : !!o.food.consume_particles,
      consumeSound: o.food.consume_sound == null
        ? defaultConsumeSound(o.food.animation || "eat")
        : String(o.food.consume_sound) };
  }
  if (o.perishable) {
    it.perishable = { enabled: true,
      lifetimeMinutes: num(o.perishable.lifetime_minutes, Lifetimes.defaultMinutes()) };
  }
  if (o.toxic) {
    it.toxic = { enabled: true, grace: num(o.toxic.grace_seconds, 10),
      effects: (o.toxic.effects || []).map(e => ({
        type: e.type || "poison", duration: num(e.duration, 100), amplifier: num(e.amplifier, 0) })) };
    if (!it.toxic.effects.length) it.toxic.effects = [{ type: "poison", duration: 100, amplifier: 0 }];
  }
  if (o.process) {
    const ftList = (o.process.furnace_types || []).map(s => String(s).toLowerCase());
    it.process = { enabled: true, type: o.process.type || "cut",
      difficulty: clamp(num(o.process.difficulty, 1), 1, 3),
      rounds: Math.max(1, num(o.process.rounds, 1)),
      durationSeconds: o.process.duration_seconds != null ? String(o.process.duration_seconds) : "",
      furnaceTypes: {
        furnace:       ftList.length === 0 || ftList.includes("furnace"),
        smoker:        ftList.length === 0 || ftList.includes("smoker"),
        blast_furnace: ftList.length === 0 || ftList.includes("blast_furnace"),
        campfire:      ftList.length === 0 || ftList.includes("campfire"),
        soul_campfire: ftList.length === 0 || ftList.includes("soul_campfire"),
      } };
  }
  it.ingredients = (o.ingredients || []).map(r => ({
    kind: r.tag != null ? "tag" : r.seed != null ? "seed" : r.item != null ? "item" : "material",
    value: String(r.tag != null ? r.tag : r.seed != null ? r.seed
      : r.item != null ? r.item : (r.material != null ? r.material : "")),
    maxUnits: Math.max(1, num(r.max_units, 1)),
    symbol: r.symbol != null ? String(r.symbol) : "",
    addictiveness: num(r.addictiveness, 0),
    effects: (r.effects || []).map(e => ({
      type: e.type || "speed", base_duration: num(e.base_duration, 0),
      duration_per_unit: num(e.duration_per_unit, 0), base_amplifier: num(e.base_amplifier, 0),
      amplifier_per_unit: num(e.amplifier_per_unit, 0), amplifier_cap: num(e.amplifier_cap, 0) })),
  }));
  if (Array.isArray(o.shape)) {
    it.shape = [0, 1, 2].map(i => o.shape[i] != null ? String(o.shape[i]) : "");
    it.shaped = it.shape.some(r => r.trim());
  }
  if (o.addiction) {
    const a = o.addiction;
    it.addiction = { enabled: true,
      maxLevel: num(a.max_level, 1), decayPerTick: num(a.decay_per_tick, 0.001),
      effectSeverity: num(a.effect_severity, 1), windowTicks: num(a.window_ticks, 36000),
      damageThresholdTicks: num(a.damage_threshold_ticks, 72000),
      damagePerInterval: num(a.damage_per_interval, 0.5),
      withdrawalCheckIntervalTicks: num(a.withdrawal_check_interval_ticks, 100),
      overdoseThreshold: num(a.overdose_threshold, 0),
      overdoseDurationTicks: num(a.overdose_duration_ticks, 600),
      antidote: a.antidote != null ? String(a.antidote) : "" };
  }
  return it;
}

function importYaml(text, fileName) {
  const doc = YAMLLite.parse(text);
  const cons = doc && doc.consumables;
  if (!cons || typeof cons !== "object") {
    throw new Error("No 'consumables:' section found.");
  }
  const items = Object.entries(cons).map(([id, o]) => itemFromYaml(id, o));
  if (!items.length) throw new Error("No consumables in that file.");
  state = emptyState();
  state.items = items;
  state.current = 0;
  // keep the raw upload in the file dock; re-uploads replace by name
  FileStore.remember(fileName || "upload.yml", text);
  changed(true);
}

function cur() { return state.items[state.current]; }

const CONSUMABLE_SECTION_TITLES = [
  "Identity", "Food", "Perishable", "Toxic to carry",
  "Crafting", "Addiction", "Effects", "Crafting effects",
];

function renderDisabledFormNav() {
  const nav = $("form-nav");
  nav.innerHTML = "";
  CONSUMABLE_SECTION_TITLES.forEach((title, i) => {
    const button = document.createElement("button");
    button.className = "row-nav";
    button.dataset.paneTarget = `s${i}`;
    button.textContent = title;
    button.disabled = true;
    nav.appendChild(button);
  });
}
function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }
function num(v, f) { const n = parseFloat(v); return isNaN(n) ? f : n; }
function esc(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}
function prettify(id) {
  return id.split(/[_\-]/).filter(Boolean).map(w => w[0].toUpperCase() + w.slice(1)).join(" ");
}

function changed(structural) {
  if (structural) buildPanels();
  renderYAML();
  renderPreview();
  save();
}

// ── form construction ──────────────────────────────────────────────────────

function buildPanels() {
  const tabs = $("item-tabs");
  tabs.innerHTML = "";
  state.items.forEach((it, i) => {
    const row = document.createElement("div");
    row.className = "entity-nav-row";
    const b = document.createElement("button");
    b.textContent = it.id || `item ${i + 1}`;
    b.className = i === state.current ? "active" : "";
    b.onclick = () => { state.current = i; changed(true); };
    row.appendChild(b);
    const del = document.createElement("button");
    del.textContent = "\u2715";
    del.className = "danger";
    del.title = `Delete ${it.id || `item ${i + 1}`}`;
    del.setAttribute("aria-label", del.title);
    del.onclick = () => {
      state.items.splice(i, 1);
      if (i < state.current) state.current--;
      else if (i === state.current) state.current = clamp(i, 0, state.items.length - 1);
      changed(true);
    };
    row.appendChild(del);
    tabs.appendChild(row);
  });
  buildForm();
}

function buildForm() {
  const it = cur();
  const root = $("form-root");
  root.innerHTML = "";

  if (!it) {
    renderDisabledFormNav();
    $("pane-title").textContent = "Consumables";
    root.innerHTML = `<div class="empty-state"><strong>Start with a consumable</strong>
      Add one from the outline, or upload an existing consumables YAML.</div>`;
    return;
  }

  // With a vanilla output the plugin hands the player a plain ItemStack -
  // ConsumableFactory returns before it writes any meta - so the item carries no
  // name, lore, model or plugin id, and everything keyed off that id (food,
  // perishable, toxic, addiction, held/consume effects) never runs. Those
  // sections are left out of the form entirely in vanilla mode. The recipe,
  // quality tier and craft effects are read off the definition at craft time,
  // so they still apply.
  const vanilla = it.outputMode === "vanilla";
  const identity = section("Identity", `
    <div class="seg" data-sub="outmode">
      <button type="button" data-outmode="custom" class="${vanilla ? "" : "on"}">Custom consumable</button>
      <button type="button" data-outmode="vanilla" class="${vanilla ? "on" : ""}">Vanilla output item</button>
    </div>
    <label>Id <input type="text" data-f="id" value="${esc(it.id)}" spellcheck="false"></label>
    <label>Display name <input type="text" data-f="name" value="${esc(it.name)}" data-fmt></label>
    ${vanilla ? `
      <p class="foot-note plain">only used in the craft message - the item itself keeps its vanilla name</p>
      <label>Vanilla output item
        <input type="text" data-f="outputItem" value="${esc(it.outputItem || "")}" spellcheck="false" placeholder="BREAD" data-keys="items"></label>
      <p class="hint">The craft yields this plain vanilla item, so none of the plugin's item data
        comes with it: no description, item model, head texture, food, perishable, toxic, addiction
        or held/consume effects. The recipe, quality tiers and crafting effects still apply.</p>
    ` : `
      <label>Description <input type="text" data-f="description" value="${esc(it.description)}" data-fmt="&amp;7&amp;o"></label>
      <p class="hint">Use &amp; codes for color and formatting. For example, &amp;6 makes text gold and &amp;l makes it bold. See
        <a href="https://minecraft.wiki/w/Formatting_codes" target="_blank" rel="noopener">Formatting codes</a>.
        Only the Java Edition set (0-9a-f, k/l/m/n/o/r) is supported.</p>
      <div class="with-chip">
        <label>Item model <input type="text" data-f="model" value="${esc(it.model)}" spellcheck="false" data-keys="item-models"></label>
        <canvas class="tex-chip" id="model-chip" width="16" height="16"></canvas>
      </div>
      <label>Head texture (skin URL or base64; overrides item model)
        <input type="text" data-f="headTexture" value="${esc(it.headTexture || "")}" spellcheck="false"></label>
    `}
  `, (f, t) => {
    it[f] = t.value;
    if (f === "id") renderYAML(); // tab label refreshes on rebuild
    paintModelChip();
  });
  // Switching mode changes which sections exist, so the whole form rebuilds.
  // The other mode's values stay on the draft, so switching back restores them.
  identity.querySelectorAll("[data-sub=outmode] button").forEach(button => {
    button.onclick = () => {
      if (button.dataset.outmode === it.outputMode) return;
      it.outputMode = button.dataset.outmode;
      changed(true);
    };
  });
  root.appendChild(identity);

  if (!vanilla) root.appendChild(toggleSection("Food", it.food, "enabled", `
    <div class="row">
      <label>Nutrition <input type="number" data-f="nutrition" min="0" value="${it.food.nutrition}"></label>
      <label>Saturation <input type="number" data-f="saturation" min="0" step="0.1" value="${it.food.saturation}"></label>
      <label>Use time (seconds) <input type="number" data-f="seconds" min="0.1" step="0.1" value="${it.food.seconds}"></label>
    </div>
    <div class="row">
      <label>Animation <select data-f="animation">
        ${USE_ANIMATIONS.map(a =>
          `<option value="${a}" ${it.food.animation === a ? "selected" : ""}>${a}</option>`).join("")}
      </select></label>
      <label>Consume sound <input type="text" data-keys="sounds" data-f="consumeSound"
        placeholder="${it.food.animation === "eat" ? "vanilla eating sound" : "none"}"
        spellcheck="false" value="${esc(it.food.consumeSound || "")}"></label>
    </div>
    <div class="switch-grid">
      <label class="check" title="Consumable even on a full hunger bar, the way golden apples, honey bottles and milk are (can_always_eat). Off behaves like bread or steak: a full bar blocks it."><input type="checkbox" data-f="alwaysEat" ${it.food.alwaysEat ? "checked" : ""}> can eat if full</label>
      ${it.food.animation === "none" ? "" : `<label class="check"><input type="checkbox" data-f="consumeParticles" ${it.food.consumeParticles ? "checked" : ""}> consume particles</label>`}
    </div>
    ${vanillaFoodTable()}
    <div class="subsection">
      <div class="sub-head"><strong>mcMMO diet</strong><span class="grow"></span></div>
      <select data-f="diet" aria-label="mcMMO diet">
        <option value="" ${!it.diet ? "selected" : ""}>none</option>
        <option value="farmers" ${it.diet === "farmers" ? "selected" : ""}>Farmer's Diet (Herbalism)</option>
        <option value="fishermans" ${it.diet === "fishermans" ? "selected" : ""}>Fisherman's Diet (Fishing)</option>
      </select>
    </div>
  `, (f, t) => {
    if (f === "diet") { it.diet = t.value; return; }
    if (f === "alwaysEat") it.food.alwaysEat = t.checked;
    else if (f === "animation") {
      // A new animation brings its own feedback defaults, and shows or hides
      // the particles switch, so the section is rebuilt.
      it.food.animation = t.value;
      it.food.consumeParticles = defaultConsumeParticles(t.value);
      it.food.consumeSound = defaultConsumeSound(t.value);
      buildForm();
    } else if (f === "consumeParticles") it.food.consumeParticles = t.checked;
    else if (f === "consumeSound") it.food.consumeSound = t.value;
    else it.food[f] = num(t.value, 1);
  }));

  if (!vanilla) root.appendChild(toggleSection("Perishable", it.perishable, "enabled", `
    <label>Lifetime
      <span class="input-with-unit"><input type="number" data-f="lifetimeMinutes" min="0.1" step="1"
        value="${it.perishable.lifetimeMinutes}" aria-label="Lifetime in minutes"><span class="input-unit">min</span></span></label>
    <p class="hint">Keeps for ${Lifetimes.format(it.perishable.lifetimeMinutes)}. Spoiled food has weaker
    effects and may cause nausea or poison.</p>
    ${Lifetimes.tableHtml()}
  `, (f, t) => {
    if (f === "lifetimeMinutes") {
      it.perishable.lifetimeMinutes = Math.max(0.1, num(t.value, Lifetimes.defaultMinutes()));
      // The "keeps for" line above restates the value in words.
      buildForm();
    }
  }));

  // toxic
  const toxic = toggleSection("Toxic to carry", it.toxic, "enabled", `
    <label>Grace period (seconds) <input type="number" data-f="grace" min="0" value="${it.toxic.grace}"></label>
    <div data-sub="toxic-effects"></div>
    <button class="add" data-add-toxic-effect>+ toxic effect</button>
  `, (f, t) => { if (f === "grace") it.toxic.grace = Math.max(0, num(t.value, 10)); });
  if (!vanilla) root.appendChild(toxic);
  const toxRoot = toxic.querySelector("[data-sub=toxic-effects]");
  if (toxRoot) {
    it.toxic.effects.forEach((eff, i) => {
      const row = document.createElement("div");
      row.className = "row";
      row.innerHTML = `
        <label>type <select data-f="type">${EFFECT_TYPES.map(e =>
          `<option ${eff.type === e ? "selected" : ""}>${e}</option>`).join("")}</select></label>
        <label>duration
          <span class="input-with-unit"><input type="number" data-f="duration" min="0.05" step="0.5"
            value="${eff.duration / TICKS_PER_SECOND}" aria-label="duration in seconds"><span class="input-unit">s</span></span></label>
        <label>level <input type="number" data-f="amplifier" min="1" value="${eff.amplifier + 1}"></label>
        <button class="danger row-delete" data-del>✕</button>`;
      // The config stores vanilla's own units - ticks, and an amplifier where 0
      // is level I - so both are converted at the edge rather than in the model.
      row.addEventListener("input", (e) => {
        const f = e.target.dataset.f;
        if (f === "type") eff.type = e.target.value;
        else if (f === "duration") {
          eff.duration = Math.max(1, Math.round(num(e.target.value, 5) * TICKS_PER_SECOND));
        } else if (f === "amplifier") {
          eff.amplifier = Math.max(0, Math.round(num(e.target.value, 1)) - 1);
        }
        renderYAML(); renderPreview(); save();
      });
      row.querySelector("[data-del]").onclick = () => { it.toxic.effects.splice(i, 1); changed(true); };
      toxRoot.appendChild(row);
    });
    const addBtn = toxic.querySelector("[data-add-toxic-effect]");
    if (addBtn) addBtn.onclick = () => {
      it.toxic.effects.push({ type: "poison", duration: 100, amplifier: 0 });
      changed(true);
    };
  }

  root.appendChild(craftingSection(it));

  // addiction
  const add = it.addiction;
  const addSection = toggleSection("Addiction", add, "enabled", `
    <div class="row">
      <label>Maximum level <input type="number" data-f="maxLevel" min="0" step="0.1" value="${add.maxLevel}"></label>
      <label>Decay per tick <input type="number" data-f="decayPerTick" min="0" step="0.0001" value="${add.decayPerTick}"></label>
      <label>Effect severity <input type="number" data-f="effectSeverity" min="0" step="0.1" value="${add.effectSeverity}"></label>
    </div>
    <div class="row">
      <label>Window (ticks) <input type="number" data-f="windowTicks" min="0" value="${add.windowTicks}"></label>
      <label>Damage threshold (ticks) <input type="number" data-f="damageThresholdTicks" min="0" value="${add.damageThresholdTicks}"></label>
    </div>
    <div class="row">
      <label>Damage per interval <input type="number" data-f="damagePerInterval" min="0" step="0.1" value="${add.damagePerInterval}"></label>
      <label>Withdrawal check interval <input type="number" data-f="withdrawalCheckIntervalTicks" min="1" value="${add.withdrawalCheckIntervalTicks}"></label>
    </div>
    <div class="row">
      <label>Overdose threshold <input type="number" data-f="overdoseThreshold" min="0" step="0.1" value="${add.overdoseThreshold}"></label>
      <label>Overdose duration (ticks) <input type="number" data-f="overdoseDurationTicks" min="0" value="${add.overdoseDurationTicks}"></label>
    </div>
    <p class="foot-note plain">0 threshold disables overdosing</p>
    <label>Antidote (material or consumable id) <input type="text" data-f="antidote" value="${esc(add.antidote)}" spellcheck="false"></label>
    <label>Insanity multiplier <input type="number" data-f="insanity" min="0" step="0.1" value="${it.insanity}"></label>
    <p class="foot-note plain">scales the bad-trip spike a dirty dose gives, and the insanity
      withdrawal feeds. Only an addictive item can trip, so 0 disables it.</p>
  `, (f, t) => {
    if (f === "insanity") it.insanity = Math.max(0, num(t.value, 0));
    else if (f === "antidote") add.antidote = t.value.trim();
    else add[f] = Math.max(0, num(t.value, 0));
  });
  if (!vanilla) root.appendChild(addSection);

  // Sounds/particles fired on consume / right-click (use) / left-click (punch).
  const evWrap = document.createElement("div");
  evWrap.className = "pane-section";
  evWrap.innerHTML = `<div class="sub-head"><strong>Effects</strong><span class="grow"></span></div>
    <p class="hint">Cosmetic sounds/particles. <code>on_consume</code> fires when eaten,
    <code>on_use</code> on right-click, <code>on_punch</code> on left-click.</p>
    <div class="ev-root"></div>`;
  if (!vanilla) root.appendChild(evWrap);
  it.events = normalizeEvents(it.events);
  EventsEditor.render(evWrap.querySelector(".ev-root"), it.events, CONSUMABLE_TRIGGERS,
    () => { renderYAML(); save(); });

  // Crafting effects: one general effect, or a set per quality tier. A poor or
  // ruined batch still smokes by default unless overridden here.
  const craftWrap = document.createElement("div");
  craftWrap.className = "pane-section";
  craftWrap.innerHTML = `
    <div class="sub-head"><strong>Crafting effects</strong><span class="grow"></span></div>
    <p class="hint">Played when the item is crafted. Poor/ruined batches smoke by default.</p>
    <div class="row compact-bottom">
      <label class="check"><input type="radio" name="craftmode-${it.id}" value="general" ${it.events.craftMode !== "tiers" ? "checked" : ""}> one effect</label>
      <label class="check"><input type="radio" name="craftmode-${it.id}" value="tiers" ${it.events.craftMode === "tiers" ? "checked" : ""}> per quality tier</label>
    </div>
    <div class="craft-root"></div>`;
  root.appendChild(craftWrap);
  const craftRoot = craftWrap.querySelector(".craft-root");
  renderCraft(craftRoot, it.events);
  craftWrap.querySelectorAll(`[name="craftmode-${it.id}"]`).forEach(r =>
    r.addEventListener("change", (e) => {
      it.events.craftMode = e.target.value;
      renderCraft(craftRoot, it.events);
      renderYAML(); save();
    }));

  paintModelChip();
  paneify();
}

/** Selected outline pane, kept across rebuilds of the form. */
let openPane = "s0";
document.addEventListener("ui:pane", (e) => { openPane = e.detail.pane; });

/**
 * Turns the sections this form just built into outline panes: one section is
 * shown at a time and the outline lists them by their own heading, so a
 * consumable with nine sections is nine short pages instead of one long one.
 */
function paneify() {
  const root = $("form-root");
  const nav = $("form-nav");
  nav.innerHTML = "";
  [...root.children].forEach((el, i) => {
    const head = el.querySelector(".sub-head strong");
    const title = head ? head.textContent : `Section ${i + 1}`;
    const key = "s" + i;
    el.dataset.pane = key;
    el.hidden = true;
    const b = document.createElement("button");
    b.className = "row-nav";
    b.dataset.paneTarget = key;
    b.dataset.paneTitle = title;
    b.textContent = title;
    nav.appendChild(b);
    // The fixed panel header already names the page, so the in-body heading is
    // always redundant. A toggle section's switch is not - it moves up into
    // the header instead (see syncPaneToggle).
    const subHead = el.querySelector(":scope > .sub-head");
    if (subHead) subHead.hidden = true;
  });
  const want = root.querySelector(`[data-pane="${openPane}"]`) ? openPane : "s0";
  UI.selectPane(want);
  UI.refresh();
}

/**
 * The enable switch currently lifted into the panel header, and the sub-head it
 * came from, so it can be put back when another pane is selected.
 * The element is MOVED rather than copied: its change listener is bound to the
 * input itself, so a clone would look right and do nothing.
 */
let liftedToggle = null;

/**
 * Shows the active pane's enable switch in the panel header, right-aligned,
 * and returns the previous one to its own section. Panes without a toggle
 * leave the header slot empty.
 */
function syncPaneToggle(key) {
  const slot = $("pane-toggle");
  if (!slot) return;
  if (liftedToggle && liftedToggle.label.parentElement === slot) {
    liftedToggle.home.appendChild(liftedToggle.label);
  }
  liftedToggle = null;
  slot.hidden = true;

  const pane = $("form-root").querySelector(`[data-pane="${key}"]`);
  const label = pane ? pane.querySelector(":scope > .sub-head > label.check") : null;
  if (!label || !label.querySelector("[data-toggle]")) return;
  liftedToggle = { label, home: label.parentElement };
  slot.appendChild(label);
  slot.hidden = false;
}

document.addEventListener("ui:pane", (e) => syncPaneToggle(e.detail.pane));

/** Render the crafting-effect editor for the item's current mode. */
function renderCraft(root, ev) {
  const onChange = () => { renderYAML(); save(); };
  if (ev.craftMode === "tiers") {
    EventsEditor.render(root, ev.craftTiers, CRAFT_TIERS, onChange);
  } else {
    EventsEditor.render(root, ev, ["on_craft"], onChange);
  }
}

/** Plain top-level pane with a delegated input handler. */
function section(title, innerHTML, onInput) {
  const div = document.createElement("div");
  div.className = "pane-section";
  div.innerHTML = `<div class="sub-head"><strong>${title}</strong><span class="grow"></span></div>
    <div class="form-grid">${innerHTML}</div>`;
  div.addEventListener("input", (e) => {
    const f = e.target.dataset.f;
    if (!f) return;
    onInput(f, e.target);
    renderYAML(); renderPreview(); save();
  });
  return div;
}

/** Section with an enable checkbox that collapses its body. */
function toggleSection(title, obj, key, innerHTML, onInput) {
  const div = document.createElement("div");
  div.className = "pane-section";
  div.innerHTML = `
    <div class="sub-head">
      <label class="check"><input type="checkbox" data-toggle ${obj[key] ? "checked" : ""}> <strong>${title}</strong></label>
      <span class="grow"></span>
    </div>
    <div class="form-grid" ${obj[key] ? "" : "hidden"}>${innerHTML}</div>`;
  div.querySelector("[data-toggle]").addEventListener("input", (e) => {
    obj[key] = e.target.checked;
    changed(true);
  });
  div.addEventListener("input", (e) => {
    const f = e.target.dataset.f;
    if (!f) return;
    onInput(f, e.target);
    renderYAML(); renderPreview(); save();
  });
  return div;
}

// ── ingredients ────────────────────────────────────────────────────────────

/** A crafting grid holds nine slots, so a recipe names at most nine things. */
const MAX_INGREDIENTS = 9;
const SHAPE_SYMBOLS = "ABCDEFGHI";
const INGREDIENT_KINDS = [
  ["material", "vanilla material", "material"],
  ["item", "consumable id", "consumable id"],
  ["seed", "crop seed", "crop id (uses that crop's seed)"],
  ["tag", "group tag", "group name (consumable_groups)"],
];

function kindOptions(kind) {
  return INGREDIENT_KINDS.map(([value, label]) =>
    `<option value="${value}" ${kind === value ? "selected" : ""}>${label}</option>`).join("");
}
function kindValueLabel(kind) {
  return (INGREDIENT_KINDS.find(k => k[0] === kind) || INGREDIENT_KINDS[0])[2];
}
function ingredientKeyList(kind) {
  return kind === "material" ? "items"
    : kind === "item" ? "consumables"
      : kind === "seed" ? "crops" : "";
}
function newIngredient(symbol) {
  return { kind: "material", value: "SUGAR", maxUnits: 4, symbol: symbol || "",
           addictiveness: 0, effects: [] };
}
/** What an ingredient matches, in the words the form uses for it. */
function ingredientLabel(rule) {
  const v = (rule.value || "").trim();
  if (!v) return "(unset)";
  return rule.kind === "tag" ? `tag: ${v}`
    : rule.kind === "seed" ? `${v} seed`
      : rule.kind === "item" ? `${v} (consumable)` : v;
}

/** First unused pattern letter, or "" once all nine are taken. */
function nextSymbol(it) {
  const used = new Set(it.ingredients.map(r => r.symbol));
  return [...SHAPE_SYMBOLS].find(c => !used.has(c)) || "";
}
function shapeChar(it, r, c) {
  const ch = (it.shape[r] || "")[c];
  return ch && ch !== " " ? ch : "";
}
function setShapeChar(it, r, c, ch) {
  const row = (it.shape[r] || "").padEnd(3, " ").split("");
  row[c] = ch || " ";
  it.shape[r] = row.join("").replace(/\s+$/, "");
}
function ingredientBySymbol(it, ch) {
  return it.ingredients.find(r => r.symbol === ch) || null;
}
/** Empties every cell holding this letter - its ingredient just went away. */
function clearSymbolCells(it, ch) {
  if (!ch) return;
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) if (shapeChar(it, r, c) === ch) setShapeChar(it, r, c, "");
  }
}
function isPlaced(it, ch) {
  return !!ch && it.shape.some(row => (row || "").includes(ch));
}
/**
 * The pattern cropped to the cells actually used: equal-length rows, never an
 * empty one (ConsumableConfig rejects those outright) and no blank border,
 * which the matcher slides past anyway. Empty grid = no shape = shapeless.
 */
function shapeRowsForYaml(it) {
  if (!it.shaped) return [];
  const cells = [0, 1, 2].map(r => [0, 1, 2].map(c => shapeChar(it, r, c)));
  const rows = [0, 1, 2].filter(r => cells[r].some(Boolean));
  const cols = [0, 1, 2].filter(c => cells.some(row => row[c]));
  if (!rows.length) return [];
  const out = [];
  for (let r = rows[0]; r <= rows[rows.length - 1]; r++) {
    let row = "";
    for (let c = cols[0]; c <= cols[cols.length - 1]; c++) row += cells[r][c] || " ";
    out.push(row);
  }
  return out;
}

/** 16x16 chip for an ingredient; vanilla materials get their real texture. */
function paintIngredientChip(canvas, rule) {
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, 16, 16);
  const tex = rule.kind === "material" ? MCAssets.item(rule.value) : null;
  if (tex) ctx.drawImage(tex, 0, 0, 16, 16);
  else { ctx.fillStyle = MCAssets.colorFor(rule.value || rule.kind); ctx.fillRect(3, 3, 10, 10); }
}
/** Repaints every ingredient chip on the page as textures stream in. */
function paintIngredientChips() {
  const it = cur();
  if (!it) return;
  document.querySelectorAll("canvas[data-ing-chip]").forEach(canvas => {
    const rule = it.ingredients[+canvas.dataset.ingChip];
    if (rule) paintIngredientChip(canvas, rule);
  });
}
function ingredientChip(rule, i) {
  const canvas = document.createElement("canvas");
  canvas.width = 16; canvas.height = 16;
  canvas.dataset.ingChip = i;
  paintIngredientChip(canvas, rule);
  return canvas;
}

/**
 * The Crafting section: how the item is made, and what it is made from. The two
 * used to be separate pages, but they constrain each other - a smelt recipe
 * takes exactly one ingredient and has no grid, a grid recipe can be shaped, and
 * a minigame recipe has neither - so they are one page, and only the fields the
 * chosen process actually reads are shown.
 */
function craftingSection(it) {
  const type = it.process.enabled ? it.process.type : "";
  const isSmelt = type === "smelt";
  const isMinigame = !!type && !NON_MINIGAME_TYPES.has(type);
  const durationLabel = DURATION_MEANING[type];
  // Smelting has no crafting grid to lay a pattern out in, and it is one item
  // in for one out, so its single ingredient is always a single unit.
  if (isSmelt && it.shaped) { it.shaped = false; it.shape = ["", "", ""]; }
  if (isSmelt) it.ingredients.forEach(rule => { rule.maxUnits = 1; });
  const shaped = !!it.shaped;

  const craft = section("Crafting", `
    <label>Process <select data-f="type">
      <option value="" ${type ? "" : "selected"}>none (instant craft)</option>
      ${PROCESS_TYPES.map(p =>
        `<option value="${p}" ${type === p ? "selected" : ""}>${p}</option>`).join("")}
    </select></label>
    <p class="hint">${processHint(type)}</p>
    ${isMinigame ? `
      <div class="row">
        <label>Difficulty (1-3)
          <input type="number" data-f="difficulty" min="1" max="3" value="${it.process.difficulty}"></label>
        <label>Rounds
          <input type="number" data-f="rounds" min="1" value="${it.process.rounds}"></label>
      </div>` : ""}
    ${durationLabel ? `
      <label>${durationLabel}
        <span class="input-with-unit"><input type="text" data-f="durationSeconds"
          value="${esc(it.process.durationSeconds)}" spellcheck="false"
          aria-label="${durationLabel} in seconds"><span class="input-unit">s</span></span></label>` : ""}
    ${isSmelt ? `
      <p class="hint">Allowed heat sources
        <span class="inline-note">Cannot use both a blast furnace and a smoker/campfire.</span></p>
      <div class="row">
        <label class="check"><input type="checkbox" data-ft="furnace"       ${it.process.furnaceTypes?.furnace       !== false ? "checked" : ""}> furnace</label>
        <label class="check"><input type="checkbox" data-ft="smoker"        ${it.process.furnaceTypes?.smoker        !== false ? "checked" : ""}> smoker</label>
        <label class="check"><input type="checkbox" data-ft="blast_furnace" ${it.process.furnaceTypes?.blast_furnace !== false ? "checked" : ""}> blast furnace</label>
        <label class="check"><input type="checkbox" data-ft="campfire"      ${it.process.furnaceTypes?.campfire      !== false ? "checked" : ""}> campfire</label>
        <label class="check"><input type="checkbox" data-ft="soul_campfire" ${it.process.furnaceTypes?.soul_campfire !== false ? "checked" : ""}> soul campfire</label>
      </div>` : ""}

    <div class="subsection">
      <div class="sub-head"><strong>Ingredients</strong><span class="grow"></span></div>
      <label>Output amount
        <input type="text" data-f="outputAmount" value="${esc(it.outputAmount)}" spellcheck="false"></label>
      <p class="foot-note plain">how many one craft yields: a number, or <code>per_unit</code> for one
        per ingredient unit consumed</p>
      <div class="seg" data-sub="mode" ${isSmelt ? "hidden" : ""}>
        <button type="button" data-mode="shapeless" class="${shaped ? "" : "on"}">Shapeless</button>
        <button type="button" data-mode="shaped" class="${shaped ? "on" : ""}">Shaped</button>
      </div>
      <p class="hint" data-sub="mode-hint"></p>
      <div class="recipe-grid" data-sub="grid" ${shaped ? "" : "hidden"}></div>
      <div data-sub="ing-list"></div>
      <button class="add" data-add-ing>+ ingredient</button>
    </div>`,
    (f, t) => {
      if (f === "type") {
        // "none" is the absence of a process, and the field set depends on the
        // type, so the whole section is rebuilt around the new choice.
        it.process.enabled = !!t.value;
        if (t.value) it.process.type = t.value;
        changed(true);
      } else if (f === "difficulty") {
        it.process.difficulty = clamp(num(t.value, 2), 1, 3);
      } else if (f === "outputAmount") {
        it.outputAmount = t.value;
      } else if (f === "rounds") {
        it.process.rounds = Math.max(1, Math.round(num(t.value, 1)));
      } else if (f === "durationSeconds") {
        it.process.durationSeconds = t.value;
      }
    });

  craft.querySelector("[data-sub=mode-hint]").textContent = isSmelt
    ? "Smelt recipes accept exactly one ingredient."
    : shaped
      ? "Fill the slots the way the recipe must be laid out in a crafting grid. A slot opens its ingredient."
      : "Any layout crafts this, as long as every ingredient is in the grid. Up to nine.";

  const grid = craft.querySelector("[data-sub=grid]");
  if (shaped) {
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) grid.appendChild(recipeSlot(it, r, c));
    }
  }

  const ingRoot = craft.querySelector("[data-sub=ing-list]");
  it.ingredients.forEach((rule, i) => ingRoot.appendChild(ingredientCard(it, rule, i)));

  // Shaped recipes gain their ingredients through the slots, so the plain add
  // button belongs to the shapeless list only.
  const addBtn = craft.querySelector("[data-add-ing]");
  const full = it.ingredients.length >= (isSmelt ? 1 : MAX_INGREDIENTS);
  addBtn.style.display = shaped || full ? "none" : "";
  addBtn.onclick = () => { it.ingredients.push(newIngredient("")); changed(true); };

  craft.querySelectorAll("[data-sub=mode] button").forEach(button => {
    button.onclick = () => setShapedMode(it, button.dataset.mode === "shaped");
  });

  // Blast furnace (ore group, RAW_IRON base) and the campfire/smoker heat sources
  // (food group, raw-meat base) are mutually exclusive - no single cookable base
  // works in both. Grey out the opposing group once the author commits to one side
  // (furnace is shared and always available). A legacy all-selected draft greys
  // nothing until the first toggle resolves it.
  function furnaceChecked(k) {
    const ft = it.process.furnaceTypes || {};
    return ft[k] !== false;
  }
  function syncFurnaceGrey() {
    const oreOn = furnaceChecked("blast_furnace");
    const flameOn = furnaceChecked("smoker") || furnaceChecked("campfire") || furnaceChecked("soul_campfire");
    const disableFlame = oreOn && !flameOn;
    const disableOre = flameOn && !oreOn;
    craft.querySelectorAll("input[data-ft]").forEach(cb => {
      const k = cb.dataset.ft;
      const dis = k === "blast_furnace" ? disableOre
        : (k === "smoker" || k === "campfire" || k === "soul_campfire") ? disableFlame
        : false;
      cb.disabled = dis;
      cb.checked = furnaceChecked(k);
      const label = cb.closest("label");
      if (label) label.style.opacity = dis ? "0.4" : "";
    });
  }
  craft.addEventListener("input", (e) => {
    const ft = e.target.dataset.ft;
    if (!ft) return;
    it.process.furnaceTypes = it.process.furnaceTypes || {};
    it.process.furnaceTypes[ft] = e.target.checked;
    if (e.target.checked) {
      if (ft === "blast_furnace") {
        it.process.furnaceTypes.smoker = false;
        it.process.furnaceTypes.campfire = false;
        it.process.furnaceTypes.soul_campfire = false;
      } else if (ft === "smoker" || ft === "campfire" || ft === "soul_campfire") {
        it.process.furnaceTypes.blast_furnace = false;
      }
    }
    syncFurnaceGrey();
    renderYAML(); renderPreview(); save();
  });
  if (isSmelt) syncFurnaceGrey();

  return craft;
}

function setShapedMode(it, shaped) {
  if (shaped === !!it.shaped) return;
  it.shaped = shaped;
  // A shaped recipe needs a symbol on every ingredient (the plugin rejects it
  // otherwise), so hand out the missing letters on the way in, and drop the
  // pattern on the way out.
  if (shaped) it.ingredients.forEach(rule => { if (!rule.symbol) rule.symbol = nextSymbol(it); });
  else it.shape = ["", "", ""];
  changed(true);
}

/** One cell of the shaped pattern: its ingredient, or a + that adds one. */
function recipeSlot(it, r, c) {
  const ch = shapeChar(it, r, c);
  const rule = ch ? ingredientBySymbol(it, ch) : null;
  const slot = document.createElement("button");
  slot.type = "button";
  slot.className = "recipe-slot" + (rule ? " filled" : ch ? " orphan" : "");
  slot.title = rule ? `${ingredientLabel(rule)} (${ch})`
    : ch ? `no ingredient uses symbol ${ch}` : "choose an ingredient";
  if (rule) {
    slot.appendChild(ingredientChip(rule, it.ingredients.indexOf(rule)));
    const symbol = document.createElement("span");
    symbol.className = "slot-symbol";
    symbol.textContent = ch;
    slot.appendChild(symbol);
  } else {
    slot.textContent = ch || "+";
  }
  slot.onclick = () => openSlotPicker(it, r, c);
  return slot;
}

/**
 * Slot picker: reuse an ingredient already in the recipe, define a new one,
 * or empty the slot. Repeating one ingredient across slots is normal (three
 * planks in a row), so the existing list comes first.
 */
function openSlotPicker(it, r, c) {
  const current = shapeChar(it, r, c);
  UI.modal({
    title: `Slot row ${r + 1}, column ${c + 1}`,
    build: (body, close) => {
      if (it.ingredients.length) {
        const hint = document.createElement("p");
        hint.className = "hint";
        hint.textContent = "Already in this recipe:";
        const list = document.createElement("div");
        list.className = "picker-list";
        it.ingredients.forEach((rule, i) => {
          const row = document.createElement("button");
          row.type = "button";
          row.className = "picker-row" + (rule.symbol && rule.symbol === current ? " on" : "");
          row.appendChild(ingredientChip(rule, i));
          row.appendChild(document.createTextNode(ingredientLabel(rule)));
          const note = document.createElement("span");
          note.className = "picker-note";
          note.textContent = rule.symbol;
          row.appendChild(note);
          row.onclick = () => {
            if (!rule.symbol) rule.symbol = nextSymbol(it);
            setShapeChar(it, r, c, rule.symbol);
            close();
            changed(true);
          };
          list.appendChild(row);
        });
        body.appendChild(hint);
        body.appendChild(list);
      }

      const draft = newIngredient("");
      const form = document.createElement("div");
      form.className = "form-grid";
      form.innerHTML = `
        <label>New ingredient <select data-n="kind">${kindOptions(draft.kind)}</select></label>
        <label data-sub="value">${kindValueLabel(draft.kind)}
          <input type="text" data-n="value" value="${esc(draft.value)}" spellcheck="false"
            data-keys="${ingredientKeyList(draft.kind)}"></label>`;
      form.addEventListener("input", (e) => {
        const f = e.target.dataset.n;
        if (!f) return;
        draft[f] = e.target.value;
        if (f !== "kind") return;
        const label = form.querySelector("[data-sub=value]");
        const input = label.querySelector("input");
        label.firstChild.nodeValue = kindValueLabel(draft.kind);
        const keyList = ingredientKeyList(draft.kind);
        if (keyList) input.dataset.keys = ingredientKeyList(draft.kind);
        else delete input.dataset.keys;
      });
      const addBtn = document.createElement("button");
      addBtn.className = "add";
      addBtn.textContent = "+ add to slot";
      addBtn.onclick = () => {
        draft.symbol = nextSymbol(it);
        it.ingredients.push(draft);
        setShapeChar(it, r, c, draft.symbol);
        close();
        changed(true);
      };
      if (it.ingredients.length >= MAX_INGREDIENTS) {
        addBtn.disabled = true;
        addBtn.textContent = "nine ingredients is the limit";
      }
      body.appendChild(form);
      body.appendChild(addBtn);

      if (current) {
        const clear = document.createElement("button");
        clear.className = "ghost";
        clear.textContent = "Empty this slot";
        clear.onclick = () => { setShapeChar(it, r, c, ""); close(); changed(true); };
        body.appendChild(clear);
      }
    },
  });
}

function ingredientCard(it, rule, i) {
  const card = document.createElement("div");
  card.className = "card";
  // In a shaped recipe the pattern letter is assigned by the grid, not typed:
  // the card only reports it, and says so when the letter sits in no slot.
  const placement = !it.shaped ? ""
    : `<span class="slot-symbol">${esc(rule.symbol || "?")}</span>`
      + (isPlaced(it, rule.symbol) ? "" : `<span class="inline-note">not in the grid</span>`);
  card.innerHTML = `
    <div class="card-head recipe-ing-head">
      <select data-f="kind">${kindOptions(rule.kind)}</select>
      ${placement}
      <span class="grow"></span>
      <button class="danger" data-del>✕</button>
    </div>
    <div class="row">
      <label>${kindValueLabel(rule.kind)}
        <input type="text" data-f="value" value="${esc(rule.value)}" spellcheck="false"
          ${ingredientKeyList(rule.kind) ? `data-keys="${ingredientKeyList(rule.kind)}"` : ""}></label>
      ${it.process.enabled && it.process.type === "smelt" ? "" :
        `<label>max units <input type="number" data-f="maxUnits" min="1" value="${rule.maxUnits}"></label>`}
    </div>
    ${it.addiction.enabled ? `
    <div class="row">
      <label>addictiveness <input type="number" data-f="addictiveness" min="0" max="1" step="0.01" value="${rule.addictiveness}"></label>
    </div>
    <p class="foot-note plain">how much of the habit this ingredient carries. The units in a craft add
      up to the dose's strength, capped at the maximum level on the Addiction page.</p>` : ""}
    <div data-sub="effects"></div>
    <button class="add" data-add-eff>+ consume effect (scales with units)</button>`;
  card.addEventListener("input", (e) => {
    const f = e.target.dataset.f;
    if (!f) return;
    if (f === "kind") { rule.kind = e.target.value; changed(true); return; }
    if (f === "value") rule.value = e.target.value;
    if (f === "maxUnits") rule.maxUnits = Math.max(1, num(e.target.value, 1));
    if (f === "addictiveness") rule.addictiveness = clamp(num(e.target.value, 0), 0, 1);
    renderYAML(); renderPreview(); save();
  });
  card.querySelector("[data-del]").onclick = () => {
    clearSymbolCells(it, rule.symbol); // no ingredient left to hold its slots
    it.ingredients.splice(i, 1);
    changed(true);
  };
  card.querySelector("[data-add-eff]").onclick = () => { rule.effects.push(defaultEffect()); changed(true); };

  const effRoot = card.querySelector("[data-sub=effects]");
  rule.effects.forEach((eff, ei) => {
    const sub = document.createElement("div");
    sub.className = "element-card";
    sub.innerHTML = `
      <div class="row">
        <label>effect <select data-e="type">${EFFECT_TYPES.map(t =>
          `<option ${eff.type === t ? "selected" : ""}>${t}</option>`).join("")}</select></label>
        <button class="danger row-delete" data-del-eff>✕</button>
      </div>
      <div class="row">
        <label>Base duration <input type="number" data-e="base_duration" min="0" value="${eff.base_duration}"></label>
        <label>Duration per unit <input type="number" data-e="duration_per_unit" min="0" value="${eff.duration_per_unit}"></label>
      </div>
      <div class="row">
        <label>Base amplifier <input type="number" data-e="base_amplifier" min="0" value="${eff.base_amplifier}"></label>
        <label>Amplifier per unit <input type="number" data-e="amplifier_per_unit" min="0" step="0.1" value="${eff.amplifier_per_unit}"></label>
        <label>Amplifier cap <input type="number" data-e="amplifier_cap" min="0" value="${eff.amplifier_cap}"></label>
      </div>`;
    sub.addEventListener("input", (e) => {
      const f = e.target.dataset.e;
      if (!f) return;
      if (f === "type") eff.type = e.target.value;
      else eff[f] = Math.max(0, num(e.target.value, 0));
      renderYAML(); save();
    });
    sub.querySelector("[data-del-eff]").onclick = () => { rule.effects.splice(ei, 1); changed(true); };
    effRoot.appendChild(sub);
  });
  return card;
}

// ── preview ────────────────────────────────────────────────────────────────

function isBlockModel(model) {
  const key = MCAssets.clean(model).toUpperCase();
  return MCKeys.BLOCKS.includes(key);
}

/** True when the model is a block whose item form is real geometry rather
 *  than a flat sprite. Doors, rails, torches, crops and friends are blocks
 *  but render as 2D item sprites in a slot, so they must not get the
 *  isometric treatment. The shape resolves asynchronously; until it lands
 *  a block keeps the 3D guess and the preview repaints on arrival. */
function rendersAsGeometry(model) {
  return isBlockModel(model) && MCAssets.itemShape(model) !== "flat";
}

function fillPoly(ctx, points, fill) {
  ctx.beginPath();
  ctx.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) ctx.lineTo(points[i][0], points[i][1]);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
}

/** Draw one texture into an affine parallelogram p0 -> p1 -> p2 -> p3. */
function drawIsoFace(ctx, tex, points, fallback, shade) {
  fillPoly(ctx, points, fallback);
  if (tex) {
    const [p0, p1, , p3] = points;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(p0[0], p0[1]);
    for (let i = 1; i < points.length; i++) ctx.lineTo(points[i][0], points[i][1]);
    ctx.closePath();
    ctx.clip();
    ctx.setTransform(
      (p1[0] - p0[0]) / tex.width, (p1[1] - p0[1]) / tex.width,
      (p3[0] - p0[0]) / tex.height, (p3[1] - p0[1]) / tex.height,
      p0[0], p0[1]
    );
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(tex, 0, 0);
    ctx.restore();
  }
  if (shade) fillPoly(ctx, points, shade);
}

function drawIsoCube(canvas, faces, fallback) {
  canvas.width = 96; canvas.height = 96;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, 96, 96);
  const top = [[48, 7], [85, 28], [48, 49], [11, 28]];
  const left = [[11, 28], [48, 49], [48, 89], [11, 68]];
  const right = [[48, 49], [85, 28], [85, 68], [48, 89]];
  drawIsoFace(ctx, faces.top, top, fallback, "rgba(255,255,255,.08)");
  drawIsoFace(ctx, faces.left, left, fallback, "rgba(0,0,0,.16)");
  drawIsoFace(ctx, faces.right, right, fallback, "rgba(0,0,0,.30)");
}

function drawIsoPlant(canvas, texture, fallback) {
  canvas.width = 96; canvas.height = 96;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, 96, 96);
  const a = [[20, 4], [76, 32], [76, 88], [20, 60]];
  const b = [[20, 32], [76, 4], [76, 60], [20, 88]];
  drawIsoFace(ctx, texture, a, fallback, "rgba(0,0,0,.07)");
  drawIsoFace(ctx, texture, b, fallback, "rgba(0,0,0,.16)");
}

function paintPreviewModel(canvas, it) {
  const headTexture = (it.headTexture || "").trim();
  const fallback = MCAssets.colorFor(it.model);
  if (headTexture) {
    const cube = MCAssets.headCube(headTexture);
    drawIsoCube(canvas, {
      top: cube?.top,
      left: cube?.front,
      right: cube?.right,
    }, fallback);
    return;
  }
  if (rendersAsGeometry(it.model)) {
    const crop = MCAssets.cropState(it.model);
    if (crop) {
      drawIsoPlant(canvas, MCAssets.blockSprite(it.model), fallback);
      return;
    }
    drawIsoCube(canvas, {
      top: MCAssets.block(it.model, "top"),
      left: MCAssets.block(it.model, "side"),
      right: MCAssets.block(it.model, "side"),
    }, fallback);
    return;
  }
  canvas.width = 16; canvas.height = 16;
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, 16, 16);
  const tex = MCAssets.item(it.model);
  if (tex) ctx.drawImage(tex, 0, 0, 16, 16);
  else { ctx.fillStyle = fallback; ctx.fillRect(3, 3, 10, 10); }
}

function paintModelChip() {
  const chip = $("model-chip");
  if (!chip || !cur()) return;
  const c = chip.getContext("2d");
  c.imageSmoothingEnabled = false;
  c.clearRect(0, 0, 16, 16);
  const tex = (cur().headTexture || "").trim()
    ? MCAssets.headFace(cur().headTexture) : MCAssets.item(cur().model);
  if (tex) c.drawImage(tex, 0, 0, 16, 16);
  else { c.fillStyle = MCAssets.colorFor(cur().model); c.fillRect(2, 2, 12, 12); }
}

/**
 * The lore strings the plugin writes, copied from messages.yml. Kept verbatim so
 * the preview reads exactly like the item does in game; ConsumableDesignerParity
 * covers the copy.
 */
const MSG = {
  lore_quality_pending: "Quality decided by your preparation",
  lore_effects: "Effects:",
  lore_effect_for: "  {effect} for ",
  lore_ingredient: "Crafting ingredient",
  lore_toxic: "\u2620 Toxic to carry ({grace}s grace)",
  lore_perishable: "\u231b Perishable, spoils in {time}",
  lore_addictive: "\u26a0 Addictive",
};

/** ConsumableFactory.toRoman, for the effect level suffix. */
function roman(n) {
  return ["", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"][n] || String(n);
}

function renderPreview() {
  const it = cur();
  const root = $("tooltip-preview");
  root.classList.toggle("is-empty", !it);
  if (!it) {
    root.innerHTML = `<div class="empty-state"><strong>No consumable selected</strong>
      Add or upload a consumable to see its in-game item tooltip.</div>`;
    return;
  }
  // A vanilla output reaches the player as a plain ItemStack, so its tooltip is
  // whatever vanilla shows: no custom name, no lore, no model.
  if (it.outputMode === "vanilla") {
    const mat = (it.outputItem || "").trim();
    root.innerHTML = `<canvas class="big-tex" width="16" height="16"></canvas>
      <div class="t-name">${esc(mat ? prettify(mat.toLowerCase()) : "(no vanilla item chosen)")}</div>
      <div class="t-source">Plain vanilla item · only the craft message uses the display name</div>`;
    paintPreviewModel(root.querySelector(".big-tex"), { model: mat, headTexture: "" });
    return;
  }
  // This mirrors ConsumableFactory.buildStatusBlock line for line: the tooltip
  // is meant to be what the item looks like in game, not a summary of the form.
  // It shows the crafting-output state (isPreview), the one the designer can
  // know from config alone - no quality rolled yet, so effect durations are
  // unscaled and the perishable line shows the full configured lifetime.
  const lines = [];

  if (it.description.trim()) {
    // The quote marks are the plugin's, and stay gray italic whatever the
    // description's own codes do.
    lines.push(`<div class="t-desc">"${LegacyText.toHtml(it.description, esc)}"</div>`);
  }

  if (it.process.enabled) {
    lines.push(`<div class="t-pending">${esc(MSG.lore_quality_pending)}</div>`);
  }

  const withEffects = it.ingredients.filter(r => (r.effects || []).length);
  if (withEffects.length) {
    lines.push(`<div class="t-effects">${esc(MSG.lore_effects)}</div>`);
    for (const rule of withEffects) {
      for (const eff of rule.effects) {
        // units default to 1 in a preview, so only the base values show.
        const seconds = Math.round(num(eff.base_duration, 0)) / 20;
        const amp = clamp(num(eff.base_amplifier, 0), 0, num(eff.amplifier_cap, 0));
        const level = amp > 0 ? " " + roman(amp + 1) : "";
        lines.push(`<div class="t-effect">${esc(MSG.lore_effect_for.replace("{effect}",
          prettify(eff.type) + level))}<span class="t-effect-time">${seconds}s</span></div>`);
      }
    }
  } else if (!it.food.enabled) {
    lines.push(`<div class="t-pending">${esc(MSG.lore_ingredient)}</div>`);
  }

  if (it.toxic.enabled) {
    lines.push(`<div class="t-toxic">${esc(MSG.lore_toxic.replace("{grace}", it.toxic.grace))}</div>`);
  }

  if (it.perishable.enabled) {
    lines.push(`<div class="t-gold">${esc(MSG.lore_perishable.replace("{time}",
      Lifetimes.format(it.perishable.lifetimeMinutes)))}</div>`);
  }

  if (it.addiction.enabled) {
    lines.push(`<div class="t-warn">${esc(MSG.lore_addictive)}</div>`);
  }

  root.innerHTML = `<canvas class="big-tex" width="16" height="16"></canvas>
    <div class="t-name">${LegacyText.toHtml(it.name || prettify(it.id), esc)}</div>${lines.join("")}`;
  paintPreviewModel(root.querySelector(".big-tex"), it);
}

MCAssets.onReady(() => { paintModelChip(); paintIngredientChips(); renderPreview(); });

// ── YAML (matches ConsumableConfig parsing exactly) ────────────────────────

function q(s) { return `"${String(s).replace(/"/g, '\\"')}"`; }

function yamlOut() {
  const L = [];
  L.push(`# Generated by tools/consumable-designer`);
  L.push(`# Drop into plugins/C4/consumables/`);
  L.push(`consumables:`);
  for (const it of state.items) {
    L.push(``);
    // A vanilla output ignores every key the plugin would stamp onto the item,
    // so they are left out rather than written and silently dropped at load.
    const vanilla = it.outputMode === "vanilla" && !!(it.outputItem || "").trim();
    L.push(`  ${it.id || "unnamed"}:`);
    L.push(`    display_name: ${q(it.name)}`);
    if (!vanilla && it.description.trim()) L.push(`    description: ${q(it.description)}`);
    if (!vanilla && (it.headTexture || "").trim()) L.push(`    head_texture: ${q(it.headTexture.trim())}`);
    else if (!vanilla && it.model.trim()) L.push(`    item_model: ${it.model.trim()}`);
    const out = it.outputAmount.trim();
    if (out && out !== "1") L.push(`    output_amount: ${/^\d+$/.test(out) ? out : "per_unit"}`);
    if (vanilla) L.push(`    output_item: ${it.outputItem.trim().toUpperCase()}`);
    // Insanity only ever reaches a player through an addictive dose, so the key
    // does nothing without an addiction block to hang it on.
    if (!vanilla && it.addiction.enabled && +it.insanity !== 0) {
      L.push(`    insanity_multiplier: ${it.insanity}`);
    }

    if (!vanilla && it.food.enabled) {
      L.push(`    food:`);
      L.push(`      nutrition: ${it.food.nutrition}`);
      L.push(`      saturation: ${it.food.saturation}`);
      L.push(`      seconds: ${it.food.seconds}`);
      L.push(`      animation: ${it.food.animation}`);
      // Only written when it differs from what the animation already implies,
      // so a plain eat/drink item stays as terse as it was before.
      if (!!it.food.consumeParticles !== defaultConsumeParticles(it.food.animation)) {
        L.push(`      consume_particles: ${!!it.food.consumeParticles}`);
      }
      const cs = String(it.food.consumeSound || "").trim();
      if (cs && cs !== defaultConsumeSound(it.food.animation)) {
        L.push(`      consume_sound: ${cs.toLowerCase() === "none" ? "none" : cs.toUpperCase()}`);
      }
      L.push(`      can_always_eat: ${it.food.alwaysEat}`);
    }
    if (!vanilla && it.perishable.enabled) {
      L.push(`    perishable:`);
      L.push(`      lifetime_minutes: ${it.perishable.lifetimeMinutes}`);
    }
    if (!vanilla && it.toxic.enabled) {
      L.push(`    toxic:`);
      L.push(`      grace_seconds: ${it.toxic.grace}`);
      if (it.toxic.effects.length) {
        L.push(`      effects:`);
        for (const e of it.toxic.effects) {
          L.push(`        - type: ${e.type}`);
          L.push(`          duration: ${e.duration}`);
          if (e.amplifier > 0) L.push(`          amplifier: ${e.amplifier}`);
        }
      }
    }
    if (it.process.enabled) {
      L.push(`    process:`);
      L.push(`      type: ${it.process.type}`);
      if (!NON_MINIGAME_TYPES.has(it.process.type)) {
        L.push(`      difficulty: ${it.process.difficulty}`);
        L.push(`      rounds: ${Math.max(1, parseInt(it.process.rounds, 10) || 1)}`);
      }
      if (String(it.process.durationSeconds).trim()) L.push(`      duration_seconds: ${parseInt(it.process.durationSeconds, 10) || 10}`);
      if (it.process.type === "smelt") {
        const ft = it.process.furnaceTypes || {};
        const sel = ["furnace", "smoker", "blast_furnace", "campfire", "soul_campfire"]
          .filter(k => ft[k] !== false);
        if (sel.length < 5) L.push(`      furnace_types: [${sel.join(", ")}]`);
      }
    }
    if (it.ingredients.length) {
      L.push(`    ingredients:`);
      for (const r of it.ingredients) {
        const key = r.kind === "tag" ? "tag" : r.kind === "seed" ? "seed"
          : r.kind === "item" ? "item" : "material";
        const val = r.kind === "material" ? r.value.toUpperCase() : r.value;
        L.push(`      - ${key}: ${val}`);
        L.push(`        max_units: ${r.maxUnits}`);
        if (it.shaped && r.symbol) L.push(`        symbol: ${q(r.symbol)}`);
        // Dead config without an addiction profile: the plugin scores effective
        // addictiveness as zero for a non-addictive item whatever the units say.
        if (it.addiction.enabled && r.addictiveness > 0) {
          L.push(`        addictiveness: ${r.addictiveness}`);
        }
        if (r.effects.length) {
          L.push(`        effects:`);
          for (const e of r.effects) {
            L.push(`          - type: ${e.type}`);
            L.push(`            base_duration: ${e.base_duration}`);
            if (e.duration_per_unit > 0) L.push(`            duration_per_unit: ${e.duration_per_unit}`);
            if (e.base_amplifier > 0) L.push(`            base_amplifier: ${e.base_amplifier}`);
            if (e.amplifier_per_unit > 0) L.push(`            amplifier_per_unit: ${e.amplifier_per_unit}`);
            if (e.amplifier_cap > 0) L.push(`            amplifier_cap: ${e.amplifier_cap}`);
          }
        }
      }
    }
    const shapeRows = shapeRowsForYaml(it);
    if (shapeRows.length) {
      L.push(`    shape:`);
      for (const row of shapeRows) L.push(`      - ${q(row)}`);
    }
    const a = it.addiction;
    if (!vanilla && a.enabled) {
      L.push(`    addiction:`);
      L.push(`      max_level: ${a.maxLevel}`);
      L.push(`      decay_per_tick: ${a.decayPerTick}`);
      L.push(`      effect_severity: ${a.effectSeverity}`);
      L.push(`      window_ticks: ${a.windowTicks}`);
      L.push(`      damage_threshold_ticks: ${a.damageThresholdTicks}`);
      L.push(`      damage_per_interval: ${a.damagePerInterval}`);
      L.push(`      withdrawal_check_interval_ticks: ${a.withdrawalCheckIntervalTicks}`);
      if (a.overdoseThreshold > 0) {
        L.push(`      overdose_threshold: ${a.overdoseThreshold}`);
        L.push(`      overdose_duration_ticks: ${a.overdoseDurationTicks}`);
        if (a.antidote) L.push(`      antidote: ${a.antidote}`);
      }
    }
    L.push(...eventsYaml(it.events, "    ", vanilla));
    if (!vanilla && (it.diet || "").trim()) {
      L.push(`    mcmmo:`);
      L.push(`      diet: ${it.diet.trim()}`);
    }
  }
  return L.join("\n") + "\n";
}

function renderYAML() {
  const first = state.items[0];
  const base = prettify(first ? first.id : "consumables").replace(/ /g, "");
  FileDock.render($("file-dock"), [
    { name: `consumables/${base}.yml`, text: yamlOut(), badge: "new", open: true },
    ...FileStore.all(),
  ]);
}

// ── events / boot ──────────────────────────────────────────────────────────

$("btn-add-item").onclick = () => {
  state.items.push(blankItem(`new_item_${state.items.length + 1}`));
  state.current = state.items.length - 1;
  changed(true);
};
$("btn-clear").onclick = () => {
  if ((state.items.length || FileStore.all().length) && !confirm("Clear all consumables and uploaded files?")) return;
  state = emptyState();
  FileStore.clear();
  changed(true);
};
$("btn-upload").onclick = () => $("file-input").click();
$("file-input").onchange = (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try { importYaml(reader.result, file.name); }
    catch (err) { alert("Could not read that config:\n" + err.message); }
    $("file-input").value = "";
  };
  reader.readAsText(file);
};

buildPanels();
renderYAML();
renderPreview();
