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
    insanity: 0,
    diet: "",          // mcMMO diet: "" none | "farmers" | "fishermans"
    food: { enabled: false, nutrition: 2, saturation: 1.0, seconds: 1.6,
            animation: "eat", alwaysEat: true },
    perishable: { enabled: false, lifetimeMinutes: 10080 },
    toxic: { enabled: false, grace: 10,
             effects: [{ type: "poison", duration: 100, amplifier: 0 }] },
    process: { enabled: false, type: "cut", difficulty: 1, rounds: "", durationSeconds: "",
               furnaceTypes: { furnace: true, smoker: false, blast_furnace: false,
                               campfire: true, soul_campfire: true } },
    ingredients: [],
    shape: ["", "", ""],
    addiction: { enabled: false, maxLevel: 1.0, decayPerTick: 0.001, effectSeverity: 1.0,
                 windowTicks: 36000, damageThresholdTicks: 72000, damagePerInterval: 0.5,
                 withdrawalCheckIntervalTicks: 100, overdoseThreshold: 0,
                 overdoseDurationTicks: 600, antidote: "" },
    events: makeEvents(),
  };
}

// Item event triggers (matches ItemEvents): on_consume when eaten, on_use on
// right-click, on_punch on left-click. All cosmetic (never cancel the action).
const CONSUMABLE_TRIGGERS = ["on_consume", "on_use", "on_punch"];
// Crafting effects: either one general `on_craft`, or per-quality-tier overrides.
const CRAFT_TIERS = ["ruined", "poor", "decent", "good", "perfect"];

/** A fresh events object for a consumable, including the crafting section. */
function makeEvents() {
  const e = EventsEditor.defaults(CONSUMABLE_TRIGGERS);
  e.on_craft = [];
  e.craftMode = "general";        // "general" = one on_craft; "tiers" = per-tier
  e.craftTiers = EventsEditor.defaults(CRAFT_TIERS);
  return e;
}

/** Backfill craft fields on an events object loaded from an older draft/import. */
function normalizeEvents(e) {
  if (!e) return makeEvents();
  for (const t of CONSUMABLE_TRIGGERS) if (!Array.isArray(e[t])) e[t] = [];
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
  e.on_craft = EventsEditor.fromYaml(o, ["on_craft"]).on_craft;
  const tiers = o.on_craft_tiers;
  e.craftMode = (tiers && typeof tiers === "object") ? "tiers" : "general";
  e.craftTiers = EventsEditor.fromYaml(tiers || {}, CRAFT_TIERS);
  return e;
}

/** Emit the combined `events:` block (flat triggers + crafting) for one item. */
function eventsYaml(ev, pad) {
  const flat = CONSUMABLE_TRIGGERS.slice();
  if (ev.craftMode !== "tiers") flat.push("on_craft");
  const flatHas = EventsEditor.hasAny(ev, flat);
  const tiersActive = ev.craftMode === "tiers"
    && CRAFT_TIERS.some(t => (ev.craftTiers[t] || []).some(EventsEditor.isReal));
  if (!flatHas && !tiersActive) return [];
  const L = [pad + "events:"];
  if (flatHas) L.push(...EventsEditor.triggerLines(ev, flat, pad + "  "));
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
        if (!it.perishable) it.perishable = { enabled: false, lifetimeMinutes: 10080 };
        if (it.headTexture == null) it.headTexture = "";
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
  if (o.insanity_multiplier != null) it.insanity = num(o.insanity_multiplier, 0);
  it.diet = (o.mcmmo && o.mcmmo.diet != null) ? String(o.mcmmo.diet).toLowerCase() : "";

  if (o.food) {
    it.food = { enabled: true,
      nutrition: num(o.food.nutrition, 2), saturation: num(o.food.saturation, 1),
      seconds: num(o.food.seconds, 1.6), animation: o.food.animation || "eat",
      alwaysEat: o.food.can_always_eat !== false };
  }
  if (o.perishable) {
    it.perishable = { enabled: true, lifetimeMinutes: num(o.perishable.lifetime_minutes, 10080) };
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
      rounds: o.process.rounds != null ? String(o.process.rounds) : "",
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
    const b = document.createElement("button");
    b.textContent = it.id || `item ${i + 1}`;
    b.className = i === state.current ? "active" : "";
    b.onclick = () => { state.current = i; changed(true); };
    tabs.appendChild(b);
  });
  if (state.items.length > 1) {
    const del = document.createElement("button");
    del.textContent = "✕";
    del.className = "danger";
    del.title = "Delete current consumable";
    del.onclick = () => {
      state.items.splice(state.current, 1);
      state.current = clamp(state.current, 0, state.items.length - 1);
      changed(true);
    };
    tabs.appendChild(del);
  }
  buildForm();
}

function buildForm() {
  const it = cur();
  const root = $("form-root");
  root.innerHTML = "";

  if (!it) {
    root.innerHTML = `<p class="hint" style="padding:20px 4px">No consumables yet.
      Upload an existing config to edit it, or press "+ consumable"
      to start a new one.</p>`;
    return;
  }

  root.appendChild(section("Identity", `
    <label>Id <input type="text" data-f="id" value="${esc(it.id)}" spellcheck="false"></label>
    <label>Display name <input type="text" data-f="name" value="${esc(it.name)}"></label>
    <label>Description <input type="text" data-f="description" value="${esc(it.description)}"></label>
    <p class="hint">Use &amp; codes for color and formatting. For example, &amp;6 makes text gold and &amp;l makes it bold. See
      <a href="https://minecraft.wiki/w/Formatting_codes" target="_blank" rel="noopener">Formatting codes</a>.
      Only the Java Edition set (0-9a-f, k/l/m/n/o/r) is supported.</p>
    <div class="with-chip">
      <label>Item model <input type="text" data-f="model" value="${esc(it.model)}" spellcheck="false" data-keys="item-models"></label>
      <canvas class="tex-chip" id="model-chip" width="16" height="16"></canvas>
    </div>
    <label>Head texture (skin URL or base64; overrides item model)
      <input type="text" data-f="headTexture" value="${esc(it.headTexture || "")}" spellcheck="false"></label>
    <label>Output amount (number or per_unit)
      <input type="text" data-f="outputAmount" value="${esc(it.outputAmount)}" spellcheck="false"></label>
    <label>Vanilla output item (optional; the craft yields this vanilla item instead, e.g. BREAD)
      <input type="text" data-f="outputItem" value="${esc(it.outputItem || "")}" spellcheck="false" placeholder="(leave blank for a custom item)" data-keys="items"></label>
    <label>Insanity multiplier <input type="number" data-f="insanity" min="0" step="0.1" value="${it.insanity}"></label>
    <label>mcMMO diet (only applies with mcMMO installed)
      <select data-f="diet">
        <option value="" ${!it.diet ? "selected" : ""}>none</option>
        <option value="farmers" ${it.diet === "farmers" ? "selected" : ""}>Farmer's Diet (Herbalism)</option>
        <option value="fishermans" ${it.diet === "fishermans" ? "selected" : ""}>Fisherman's Diet (Fishing)</option>
      </select></label>
  `, (f, t) => {
    if (f === "insanity") it.insanity = Math.max(0, num(t.value, 0));
    else it[f] = t.value;
    if (f === "id") renderYAML(); // tab label refreshes on rebuild
    paintModelChip();
  }));

  root.appendChild(toggleSection("Food (edible)", it.food, "enabled", `
    <div class="row">
      <label>nutrition <input type="number" data-f="nutrition" min="0" value="${it.food.nutrition}"></label>
      <label>saturation <input type="number" data-f="saturation" min="0" step="0.1" value="${it.food.saturation}"></label>
      <label>seconds <input type="number" data-f="seconds" min="0.1" step="0.1" value="${it.food.seconds}"></label>
    </div>
    <div class="row">
      <label>animation <select data-f="animation">
        <option value="eat" ${it.food.animation === "eat" ? "selected" : ""}>eat</option>
        <option value="drink" ${it.food.animation === "drink" ? "selected" : ""}>drink</option>
      </select></label>
      <label class="check"><input type="checkbox" data-f="alwaysEat" ${it.food.alwaysEat ? "checked" : ""}> always edible</label>
    </div>
    <p class="hint">Vanilla reference (nutrition / saturation): cookie 2 / 0.4 &middot; melon slice 2 / 1.2 &middot;
    apple 4 / 2.4 &middot; bread 5 / 6.0 &middot; cooked cod 5 / 6.0 &middot; cooked chicken 6 / 7.2 &middot;
    cooked salmon 6 / 9.6 &middot; golden carrot 6 / 14.4 &middot; steak 8 / 12.8 &middot; rabbit stew 10 / 12.0</p>
  `, (f, t) => {
    if (f === "alwaysEat") it.food.alwaysEat = t.checked;
    else if (f === "animation") it.food.animation = t.value;
    else it.food[f] = num(t.value, 1);
  }));

  root.appendChild(toggleSection("Perishable (spoils over time)", it.perishable, "enabled", `
    <label>lifetime minutes <input type="number" data-f="lifetimeMinutes" min="0.1" step="1" value="${it.perishable.lifetimeMinutes}"></label>
    <p class="hint">The item spoils after this time. Spoiled food has weaker effects and may cause nausea or poison.</p>
    <p class="hint">Useful values: 4320 for 3 days, 10080 for 1 week, 20160 for 2 weeks, and 43200 for 1 month.</p>
  `, (f, t) => {
    if (f === "lifetimeMinutes") it.perishable.lifetimeMinutes = Math.max(0.1, num(t.value, 10080));
  }));

  // toxic
  const toxic = toggleSection("Toxic to carry", it.toxic, "enabled", `
    <label>grace seconds <input type="number" data-f="grace" min="0" value="${it.toxic.grace}"></label>
    <div data-sub="toxic-effects"></div>
    <button class="add" data-add-toxic-effect>+ toxic effect</button>
  `, (f, t) => { if (f === "grace") it.toxic.grace = Math.max(0, num(t.value, 10)); });
  root.appendChild(toxic);
  const toxRoot = toxic.querySelector("[data-sub=toxic-effects]");
  if (toxRoot) {
    it.toxic.effects.forEach((eff, i) => {
      const row = document.createElement("div");
      row.className = "row";
      row.innerHTML = `
        <label>type <select data-f="type">${EFFECT_TYPES.map(e =>
          `<option ${eff.type === e ? "selected" : ""}>${e}</option>`).join("")}</select></label>
        <label>duration (ticks) <input type="number" data-f="duration" min="1" value="${eff.duration}"></label>
        <label>amplifier <input type="number" data-f="amplifier" min="0" value="${eff.amplifier}"></label>
        <button class="danger" data-del style="align-self:flex-end">✕</button>`;
      row.addEventListener("input", (e) => {
        const f = e.target.dataset.f;
        if (f === "type") eff.type = e.target.value;
        else eff[f] = Math.max(0, num(e.target.value, 0));
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

  const procSection = toggleSection("Preparation process", it.process, "enabled", `
    <div class="row">
      <label>type <select data-f="type">${PROCESS_TYPES.map(p =>
        `<option ${it.process.type === p ? "selected" : ""}>${p}</option>`).join("")}</select></label>
      <label data-minigame-field>difficulty (1-3) <input type="number" data-f="difficulty" min="1" max="3" value="${it.process.difficulty}"></label>
    </div>
    <div class="row" data-minigame-field>
      <label>rounds (blank = default) <input type="text" data-f="rounds" value="${esc(it.process.rounds)}"></label>
      <label>duration seconds <input type="text" data-f="durationSeconds" value="${esc(it.process.durationSeconds)}"></label>
    </div>
    <p class="hint">With no process items are an instant craft at full quality. rounds: flips/targets/beats/impurities.
    duration_seconds: temperature &amp; distill game length, ferment peak time, smelt cook time.
    Smelting has no minigame. It keeps the source quality. Use duration_seconds for its cook time.</p>
    <div data-smelt-only>
      <p class="hint" style="margin:6px 0 2px">Allowed heat sources <span style="opacity:.7">Cannot use both a blast furnace and a smoker/campfire.</span></p>
      <div class="row">
        <label class="check"><input type="checkbox" data-ft="furnace"       ${it.process.furnaceTypes?.furnace       !== false ? "checked" : ""}> furnace</label>
        <label class="check"><input type="checkbox" data-ft="smoker"        ${it.process.furnaceTypes?.smoker        !== false ? "checked" : ""}> smoker</label>
        <label class="check"><input type="checkbox" data-ft="blast_furnace" ${it.process.furnaceTypes?.blast_furnace !== false ? "checked" : ""}> blast furnace</label>
        <label class="check"><input type="checkbox" data-ft="campfire"      ${it.process.furnaceTypes?.campfire      !== false ? "checked" : ""}> campfire</label>
        <label class="check"><input type="checkbox" data-ft="soul_campfire" ${it.process.furnaceTypes?.soul_campfire !== false ? "checked" : ""}> soul campfire</label>
      </div>
    </div>
  `, (f, t) => {
    if (f === "type") { it.process.type = t.value; syncMinigameFields(); }
    else if (f === "difficulty") it.process.difficulty = clamp(num(t.value, 2), 1, 3);
    else it.process[f] = t.value;
  });
  // Reads it.process.type fresh each call, so it must run AFTER the onInput
  // callback above has updated it - not as an independent listener on the
  // <select>, which would fire during the event's target phase, before the
  // delegated listener on procSection (added by toggleSection) applies the
  // new value, leaving the furnace/minigame fields one selection stale.
  function syncMinigameFields() {
    const hide = NON_MINIGAME_TYPES.has(it.process.type);
    procSection.querySelectorAll("[data-minigame-field]").forEach(el => {
      el.style.display = hide ? "none" : "";
    });
    const isSmelt = it.process.type === "smelt";
    procSection.querySelectorAll("[data-smelt-only]").forEach(el => {
      el.style.display = isSmelt ? "" : "none";
    });
    if (isSmelt) syncFurnaceGrey();
  }

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
    procSection.querySelectorAll("input[data-ft]").forEach(cb => {
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
  root.appendChild(procSection);
  procSection.addEventListener("input", (e) => {
    const ft = e.target.dataset.ft;
    if (!ft) return;
    if (!it.process.furnaceTypes) it.process.furnaceTypes =
      { furnace: true, smoker: false, blast_furnace: false, campfire: true, soul_campfire: true };
    it.process.furnaceTypes[ft] = e.target.checked;
    // Mutual exclusivity: one item can't cook in both a blast furnace (ore group)
    // and a campfire/smoker (food group), so selecting one side clears the other.
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
  syncMinigameFields();

  // ingredients
  const ing = section("Ingredients", `<div data-sub="ing-list"></div>
    <button class="add" data-add-ing>+ ingredient</button>
    <p class="hint">Shaped recipe (optional): give ingredients single letter symbols, then fill
    the grid where each should go. Leave the grid blank for shapeless.</p>
    <div class="shape-grid" data-sub="shape"></div>`, () => {});
  root.appendChild(ing);
  const ingRoot = ing.querySelector("[data-sub=ing-list]");
  it.ingredients.forEach((rule, i) => ingRoot.appendChild(ingredientCard(it, rule, i)));
  ing.querySelector("[data-add-ing]").onclick = () => {
    it.ingredients.push({ kind: "material", value: "SUGAR", maxUnits: 4, symbol: "",
                          addictiveness: 0, effects: [] });
    changed(true);
  };
  const shapeRoot = ing.querySelector("[data-sub=shape]");
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      const cell = document.createElement("input");
      cell.type = "text";
      cell.maxLength = 1;
      cell.value = (it.shape[r] || "")[c] === " " ? "" : ((it.shape[r] || "")[c] || "");
      cell.addEventListener("input", () => {
        const row = (it.shape[r] || "").padEnd(3, " ").split("");
        row[c] = cell.value ? cell.value : " ";
        it.shape[r] = row.join("").replace(/\s+$/, "").padEnd(0);
        renderYAML(); save();
      });
      shapeRoot.appendChild(cell);
    }
  }

  // Smelt recipes accept one ingredient. Hide the add button after one exists.
  {
    const addIngBtn = ing.querySelector("[data-add-ing]");
    const smeltNote = document.createElement("p");
    smeltNote.className = "hint";
    smeltNote.textContent = "Smelt recipes accept exactly one ingredient.";
    ing.querySelector("[data-sub=ing-list]").before(smeltNote);
    const syncSmeltIngredient = () => {
      const isSmelt = it.process.enabled && it.process.type === "smelt";
      addIngBtn.style.display = (isSmelt && it.ingredients.length >= 1) ? "none" : "";
      smeltNote.style.display = isSmelt ? "" : "none";
    };
    syncSmeltIngredient();
    // Fires after procSection's own input listener has already updated it.process.type
    root.addEventListener("input", syncSmeltIngredient);
  }

  // addiction
  const add = it.addiction;
  root.appendChild(toggleSection("Addiction", add, "enabled", `
    <div class="row">
      <label>max_level <input type="number" data-f="maxLevel" min="0" step="0.1" value="${add.maxLevel}"></label>
      <label>decay_per_tick <input type="number" data-f="decayPerTick" min="0" step="0.0001" value="${add.decayPerTick}"></label>
      <label>effect_severity <input type="number" data-f="effectSeverity" min="0" step="0.1" value="${add.effectSeverity}"></label>
    </div>
    <div class="row">
      <label>window_ticks <input type="number" data-f="windowTicks" min="0" value="${add.windowTicks}"></label>
      <label>damage_threshold_ticks <input type="number" data-f="damageThresholdTicks" min="0" value="${add.damageThresholdTicks}"></label>
    </div>
    <div class="row">
      <label>damage_per_interval <input type="number" data-f="damagePerInterval" min="0" step="0.1" value="${add.damagePerInterval}"></label>
      <label>withdrawal_check_interval <input type="number" data-f="withdrawalCheckIntervalTicks" min="1" value="${add.withdrawalCheckIntervalTicks}"></label>
    </div>
    <div class="row">
      <label>overdose_threshold (0 = can't OD) <input type="number" data-f="overdoseThreshold" min="0" step="0.1" value="${add.overdoseThreshold}"></label>
      <label>overdose_duration_ticks <input type="number" data-f="overdoseDurationTicks" min="0" value="${add.overdoseDurationTicks}"></label>
    </div>
    <label>antidote (material or consumable id) <input type="text" data-f="antidote" value="${esc(add.antidote)}" spellcheck="false"></label>
  `, (f, t) => {
    if (f === "antidote") add.antidote = t.value.trim();
    else add[f] = Math.max(0, num(t.value, 0));
  }));

  // Sounds/particles fired on consume / right-click (use) / left-click (punch).
  const evWrap = document.createElement("div");
  evWrap.className = "subsection";
  evWrap.innerHTML = `<div class="sub-head"><strong>Effects</strong><span class="grow"></span></div>
    <p class="hint">Cosmetic sounds/particles. <code>on_consume</code> fires when eaten,
    <code>on_use</code> on right-click, <code>on_punch</code> on left-click.</p>
    <div class="ev-root"></div>`;
  root.appendChild(evWrap);
  it.events = normalizeEvents(it.events);
  EventsEditor.render(evWrap.querySelector(".ev-root"), it.events, CONSUMABLE_TRIGGERS,
    () => { renderYAML(); save(); });

  // Crafting effects: one general effect, or a set per quality tier. A poor or
  // ruined batch still smokes by default unless overridden here.
  const craftWrap = document.createElement("div");
  craftWrap.className = "subsection";
  craftWrap.innerHTML = `
    <div class="sub-head"><strong>Crafting effects</strong><span class="grow"></span></div>
    <p class="hint">Played when the item is crafted. Poor/ruined batches smoke by default.</p>
    <div class="row" style="margin-bottom:6px">
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
}

/** Render the crafting-effect editor for the item's current mode. */
function renderCraft(root, ev) {
  const onChange = () => { renderYAML(); save(); };
  if (ev.craftMode === "tiers") {
    EventsEditor.render(root, ev.craftTiers, CRAFT_TIERS, onChange);
  } else {
    EventsEditor.render(root, ev, ["on_craft"], onChange);
  }
}

/** Plain section card with a delegated input handler. */
function section(title, innerHTML, onInput) {
  const div = document.createElement("div");
  div.className = "subsection";
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
  div.className = "subsection";
  div.innerHTML = `
    <div class="sub-head">
      <label class="check"><input type="checkbox" data-toggle ${obj[key] ? "checked" : ""}> <strong>${title}</strong></label>
      <span class="grow"></span>
    </div>
    <div class="form-grid" style="${obj[key] ? "" : "display:none"}">${innerHTML}</div>`;
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

function ingredientCard(it, rule, i) {
  const card = document.createElement("div");
  card.className = "card";
  card.innerHTML = `
    <div class="card-head">
      <select data-f="kind">
        <option value="material" ${rule.kind === "material" ? "selected" : ""}>vanilla material</option>
        <option value="item" ${rule.kind === "item" ? "selected" : ""}>consumable id</option>
        <option value="seed" ${rule.kind === "seed" ? "selected" : ""}>crop seed</option>
        <option value="tag" ${rule.kind === "tag" ? "selected" : ""}>group tag</option>
      </select>
      <span class="grow"></span>
      <button class="danger" data-del>✕</button>
    </div>
    <div class="row">
      <label>${rule.kind === "material" ? "material" : rule.kind === "tag" ? "group name (consumable_groups)" : rule.kind === "seed" ? "crop id (uses that crop's seed)" : "consumable id"}
        <input type="text" data-f="value" value="${esc(rule.value)}" spellcheck="false" ${rule.kind === "material" ? 'data-keys="items"' : ""}></label>
      <label>max units <input type="number" data-f="maxUnits" min="1" value="${rule.maxUnits}"></label>
    </div>
    <div class="row">
      <label>symbol (shaped) <input type="text" data-f="symbol" maxlength="1" value="${esc(rule.symbol)}"></label>
      <label>addictiveness <input type="number" data-f="addictiveness" min="0" max="1" step="0.01" value="${rule.addictiveness}"></label>
    </div>
    <div data-sub="effects"></div>
    <button class="add" data-add-eff>+ consume effect (scales with units)</button>`;
  card.addEventListener("input", (e) => {
    const f = e.target.dataset.f;
    if (!f) return;
    if (f === "kind") { rule.kind = e.target.value; changed(true); return; }
    if (f === "value") rule.value = e.target.value;
    if (f === "symbol") rule.symbol = e.target.value.trim();
    if (f === "maxUnits") rule.maxUnits = Math.max(1, num(e.target.value, 1));
    if (f === "addictiveness") rule.addictiveness = clamp(num(e.target.value, 0), 0, 1);
    renderYAML(); renderPreview(); save();
  });
  card.querySelector("[data-del]").onclick = () => { it.ingredients.splice(i, 1); changed(true); };
  card.querySelector("[data-add-eff]").onclick = () => { rule.effects.push(defaultEffect()); changed(true); };

  const effRoot = card.querySelector("[data-sub=effects]");
  rule.effects.forEach((eff, ei) => {
    const sub = document.createElement("div");
    sub.className = "element-card";
    sub.innerHTML = `
      <div class="row">
        <label>effect <select data-e="type">${EFFECT_TYPES.map(t =>
          `<option ${eff.type === t ? "selected" : ""}>${t}</option>`).join("")}</select></label>
        <button class="danger" data-del-eff style="align-self:flex-end">✕</button>
      </div>
      <div class="row">
        <label>base_duration <input type="number" data-e="base_duration" min="0" value="${eff.base_duration}"></label>
        <label>duration_per_unit <input type="number" data-e="duration_per_unit" min="0" value="${eff.duration_per_unit}"></label>
      </div>
      <div class="row">
        <label>base_amplifier <input type="number" data-e="base_amplifier" min="0" value="${eff.base_amplifier}"></label>
        <label>amp_per_unit <input type="number" data-e="amplifier_per_unit" min="0" step="0.1" value="${eff.amplifier_per_unit}"></label>
        <label>amp_cap <input type="number" data-e="amplifier_cap" min="0" value="${eff.amplifier_cap}"></label>
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

function renderPreview() {
  const it = cur();
  const root = $("tooltip-preview");
  if (!it) { root.innerHTML = `<div class="t-desc">No consumable selected.</div>`; return; }
  const lines = [];
  if (it.description.trim()) lines.push(`<div class="t-desc">${LegacyText.toHtml(it.description, esc)}</div>`);
  if (it.food.enabled) {
    lines.push(`<div class="t-line">🍗 ${it.food.nutrition} nutrition · ${it.food.seconds}s ${it.food.animation}</div>`);
  }
  if (it.perishable.enabled) {
    lines.push(`<div class="t-gold">⌛ perishable, spoils in ${it.perishable.lifetimeMinutes}m</div>`);
  }
  if (it.toxic.enabled) {
    lines.push(`<div class="t-warn">☠ Toxic after ${it.toxic.grace}s. `
      + it.toxic.effects.map(e => e.type).join(", ") + `</div>`);
  }
  if (it.process.enabled) {
    const procLabel = NON_MINIGAME_TYPES.has(it.process.type)
      ? `⚒ ${it.process.type} (auto)`
      : `⚒ ${it.process.type} (difficulty ${it.process.difficulty})`;
    lines.push(`<div class="t-gold">${procLabel}</div>`);
  }
  if (it.addiction.enabled) {
    lines.push(`<div class="t-warn">⚠ addictive${it.addiction.overdoseThreshold > 0 ? " · can overdose" : ""}</div>`);
  }
  const ingredients = it.ingredients
    .map(r => `${r.maxUnits}× ${r.value}`).join(", ");
  if (ingredients) lines.push(`<div class="t-line" style="color:#8a94a1">from: ${esc(ingredients)}</div>`);

  root.innerHTML = `<canvas class="big-tex" width="16" height="16"></canvas>
    <div class="t-name">${LegacyText.toHtml(it.name || prettify(it.id), esc)}</div>${lines.join("")}`;
  const big = root.querySelector(".big-tex").getContext("2d");
  big.imageSmoothingEnabled = false;
  const tex = (it.headTexture || "").trim()
    ? MCAssets.headFace(it.headTexture) : MCAssets.item(it.model);
  if (tex) big.drawImage(tex, 0, 0, 16, 16);
  else { big.fillStyle = MCAssets.colorFor(it.model); big.fillRect(3, 3, 10, 10); }
}

MCAssets.onReady(() => { paintModelChip(); renderPreview(); });

// ── YAML (matches ConsumableConfig parsing exactly) ────────────────────────

function q(s) { return `"${String(s).replace(/"/g, '\\"')}"`; }

function yamlOut() {
  const L = [];
  L.push(`# Generated by tools/consumable-designer`);
  L.push(`# Drop into plugins/C4/consumables/`);
  L.push(`consumables:`);
  for (const it of state.items) {
    L.push(``);
    L.push(`  ${it.id || "unnamed"}:`);
    L.push(`    display_name: ${q(it.name)}`);
    if (it.description.trim()) L.push(`    description: ${q(it.description)}`);
    if ((it.headTexture || "").trim()) L.push(`    head_texture: ${q(it.headTexture.trim())}`);
    else if (it.model.trim()) L.push(`    item_model: ${it.model.trim()}`);
    const out = it.outputAmount.trim();
    if (out && out !== "1") L.push(`    output_amount: ${/^\d+$/.test(out) ? out : "per_unit"}`);
    if ((it.outputItem || "").trim()) L.push(`    output_item: ${it.outputItem.trim().toUpperCase()}`);
    if (+it.insanity !== 0) L.push(`    insanity_multiplier: ${it.insanity}`);

    if (it.food.enabled) {
      L.push(`    food:`);
      L.push(`      nutrition: ${it.food.nutrition}`);
      L.push(`      saturation: ${it.food.saturation}`);
      L.push(`      seconds: ${it.food.seconds}`);
      L.push(`      animation: ${it.food.animation}`);
      L.push(`      can_always_eat: ${it.food.alwaysEat}`);
    }
    if (it.perishable.enabled) {
      L.push(`    perishable:`);
      L.push(`      lifetime_minutes: ${it.perishable.lifetimeMinutes}`);
    }
    if (it.toxic.enabled) {
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
        if (String(it.process.rounds).trim()) L.push(`      rounds: ${parseInt(it.process.rounds, 10) || 1}`);
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
        if (r.symbol) L.push(`        symbol: ${q(r.symbol)}`);
        if (r.addictiveness > 0) L.push(`        addictiveness: ${r.addictiveness}`);
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
    const shapeRows = it.shape.map(r => (r || "").replace(/\s+$/, "")).filter((r, i, arr) =>
      r.length || arr.slice(i + 1).some(x => x.trim().length));
    if (shapeRows.some(r => r.trim().length)) {
      L.push(`    shape:`);
      for (const row of shapeRows) L.push(`      - ${q(row)}`);
    }
    const a = it.addiction;
    if (a.enabled) {
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
    L.push(...eventsYaml(it.events, "    "));
    if ((it.diet || "").trim()) {
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
