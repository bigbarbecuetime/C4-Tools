/* Farmland Designer - custom farmland types for the crop system.
 * Preview renders the actual in-game construction: vanilla farmland with the
 * configured visual block as a slightly-inflated BlockDisplay overlay, sitting
 * in a small patch of its source block, with the hydration radius marked.
 */
"use strict";

const STORE_KEY = "farmland-designer-v1";
const $ = (id) => document.getElementById(id);
const colorFor = MCAssets.colorFor;

function blankType(id) {
  return {
    id: id || "new_farmland",
    name: "New Farmland",
    sources: "",
    tools: "",
    wrongToolMessage: "", // flavour before the auto "only … hoes" list
    visual: "",
    needsTilling: true,   // false = plant directly (soul soil)
    source: "WATER",      // hydration source block (LAVA for nether soils)
    radius: 4,
    baseline: 0.1,
    dryRate: 0.05,
    biomes: [],
  };
}

// Uploaded/created files live in shared/file-store.js (FileStore), not here
// - that keeps the file dock the same across every tool page.
function emptyState() {
  return { types: [], current: 0, view: { yaw: 0.7, pitch: 0.45, zoom: 130, water: 0.6 } };
}

let state = load();

function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const loaded = JSON.parse(raw);
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

// ── import (parse a FarmlandTypes.yml back into the editor) ─────────────────

function toList(v) { return Array.isArray(v) ? v : (v == null ? [] : [v]); }

function typeFromYaml(id, o) {
  o = o || {};
  const water = o.water || {};
  const baseline = water.biome_baseline || {};
  const visual = o.visual || {};
  const visualField = toList(visual.block);
  const biomes = [];
  for (const [k, v] of Object.entries(baseline)) {
    if (k !== "default") biomes.push({ biome: k, value: num(v, 0.1) });
  }
  return {
    id,
    name: o.display_name || "",
    sources: toList(o.source_blocks).join(", "),
    tools: toList(o.till_tools).join(", "),
    wrongToolMessage: o.wrong_tool_message != null ? String(o.wrong_tool_message) : "",
    visual: visualField.join(", "),
    needsTilling: o.needs_tilling !== false,
    source: water.source != null ? String(water.source) : "WATER",
    radius: num(water.radius, 4),
    baseline: num(baseline.default, 0.1),
    dryRate: num(water.dry_rate_per_minute, 0.05),
    biomes,
  };
}

function importYaml(text, fileName) {
  const doc = YAMLLite.parse(text);
  const ft = doc && doc.farmland_types;
  if (!ft || typeof ft !== "object") {
    throw new Error("No 'farmland_types:' section found.");
  }
  const types = Object.entries(ft).map(([id, o]) => typeFromYaml(id, o));
  if (!types.length) throw new Error("No farmland types in that file.");
  state = emptyState();
  state.types = types;
  state.current = 0;
  // keep the raw upload in the file dock; re-uploads replace by name
  FileStore.remember(fileName || "upload.yml", text);
  changed(true);
}

function cur() { return state.types[state.current]; }
function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }
function num(v, f) { const n = parseFloat(v); return isNaN(n) ? f : n; }

function changed(structural) {
  if (structural) buildPanels();
  renderYAML();
  draw();
  save();
}

// ── 3D preview (compact renderer, same projection as the crop designer) ────

const canvas = $("preview");
const ctx = canvas.getContext("2d");
const LIGHT = norm([0.45, 1, 0.25]);

function norm(v) { const l = Math.hypot(...v) || 1; return v.map(x => x / l); }
function crossV(a, b) { return [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]]; }
function dotV(a, b) { return a[0]*b[0]+a[1]*b[1]+a[2]*b[2]; }

function toView(p) {
  const { yaw, pitch } = state.view;
  let [x, y, z] = p;
  let c = Math.cos(yaw), s = Math.sin(yaw);
  [x, z] = [x*c + z*s, -x*s + z*c];
  c = Math.cos(pitch); s = Math.sin(pitch);
  [y, z] = [y*c - z*s, y*s + z*c];
  return [x, y, z];
}
function project(p) {
  const v = toView(p);
  // Keep the configured radius and its source block in frame while preserving
  // the user's zoom as the base scale.
  const radius = Math.max(1, cur()?.radius || 1);
  const zoom = state.view.zoom / Math.max(1, radius / 2.5);
  return { x: canvas.width/2 + v[0]*zoom, y: canvas.height/2 + 40 - v[1]*zoom, z: v[2] };
}

function hydrationKind(t) {
  return (t?.source || "WATER").toUpperCase() === "LAVA" ? "lava" : "water";
}

function syncPreviewChrome(t) {
  const empty = !t;
  document.body.classList.toggle("farmland-empty", empty);
  $("farmland-preview-empty").hidden = !empty;
  $("farmland-editor-empty").hidden = !empty;
  $("preview-summary").hidden = empty;
  document.querySelectorAll(".outline [data-pane-target]").forEach(button => button.disabled = empty);
  if (empty) {
    $("pane-title").textContent = "Farmland";
    return;
  }
  const activePane = document.querySelector(".outline [data-pane-target].on");
  if (activePane) {
    $("pane-title").textContent = activePane.dataset.paneTitle || activePane.textContent.trim();
  }
  const kind = hydrationKind(t);
  document.body.dataset.hydration = kind;
  $("hydration-content-label").textContent = `${kind} content`;
  $("hydration-preview-hint").textContent = `drag to orbit · scroll to zoom · the ${kind === "lava" ? "orange" : "blue"} ring shows the hydration radius`;
  const amount = Math.round(state.view.water * 100);
  const name = LegacyText.toHtml(t.name || t.id, esc);
  $("preview-summary").innerHTML = `<span class="name">${name}</span>`
    + `<span class="detail">${amount}% ${kind} · ${Math.round(t.baseline * 100)}% baseline · radius ${t.radius} · dries ${t.dryRate}/min</span>`;
}

/** Axis-aligned box from min/max corners, with a texture name. */
function box(min, max, texName, alphaTop) {
  const C = [];
  for (let i = 0; i < 8; i++) {
    C.push([(i&1) ? max[0] : min[0], (i&2) ? max[1] : min[1], (i&4) ? max[2] : min[2]]);
  }
  const F = [
    { idx: [2,3,1,0], kind: "side" }, { idx: [7,6,4,5], kind: "side" },
    { idx: [6,2,0,4], kind: "side" }, { idx: [3,7,5,1], kind: "side" },
    { idx: [6,7,3,2], kind: "top" },  { idx: [0,1,5,4], kind: "bottom" },
  ];
  return F.map(f => {
    const pts = f.idx.map(i => C[i]);
    const n = norm(crossV(
      [pts[1][0]-pts[0][0], pts[1][1]-pts[0][1], pts[1][2]-pts[0][2]],
      [pts[3][0]-pts[0][0], pts[3][1]-pts[0][1], pts[3][2]-pts[0][2]]));
    const proj = pts.map(project);
    return { proj, normal: n, depth: proj.reduce((s,p)=>s+p.z,0)/4,
             tex: MCAssets.block(texName, f.kind), color: colorFor(texName),
             alpha: (f.kind === "top" && alphaTop !== undefined) ? alphaTop : 1 };
  });
}

function draw() {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const t = cur();
  syncPreviewChrome(t);
  if (!t) {
    return;
  }
  const srcBlock = (t.sources.split(",")[0] || "SAND").trim() || "SAND";

  // hydration radius ring (on the ground plane)
  ctx.strokeStyle = hydrationKind(t) === "lava" ? "rgba(231,101,34,0.68)" : "rgba(61,128,215,0.68)";
  ctx.setLineDash([6, 5]);
  ctx.beginPath();
  const R = t.radius + 0.5;
  for (let a = 0; a <= 64; a++) {
    const p = project([Math.cos(a/64*Math.PI*2)*R, 0, Math.sin(a/64*Math.PI*2)*R]);
    if (a === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
  }
  ctx.stroke();
  ctx.setLineDash([]);

  const faces = [];
  // surrounding patch of untilled source blocks (3x3 minus center)
  for (let dx = -1; dx <= 1; dx++) {
    for (let dz = -1; dz <= 1; dz++) {
      if (dx === 0 && dz === 0) continue;
      faces.push(...box([dx-0.5, -1, dz-0.5], [dx+0.5, 0, dz+0.5], srcBlock));
    }
  }
  // center: vanilla farmland (sunken)…
  faces.push(...box([-0.5, -1, -0.5], [0.5, -0.0625, 0.5], "farmland_moist"));
  // …hidden by the inflated overlay, exactly like the plugin spawns it
  faces.push(...box([-0.501, -0.9995, -0.501], [0.501, -0.0605, 0.501], firstVisual(t) || srcBlock));

  // a hydration block at the radius edge, for scale - matches the configured
  // source liquid (lava for nether soils, otherwise water).
  const liquidTex = (t.source || "WATER").toUpperCase() === "LAVA" ? "lava_still" : "water_still";
  faces.push(...box([t.radius - 0.5, -1, -0.5], [t.radius + 0.5, -0.12, 0.5], liquidTex, 0.8));

  faces.sort((a, b) => a.depth - b.depth);
  for (const f of faces) {
    const vn = toView(f.normal);
    if (vn[2] < 0) continue;
    paintFace(f);
  }

}

function paintFace(f) {
  const path = () => {
    ctx.beginPath();
    ctx.moveTo(f.proj[0].x, f.proj[0].y);
    for (let i = 1; i < 4; i++) ctx.lineTo(f.proj[i].x, f.proj[i].y);
    ctx.closePath();
  };
  const bright = 0.55 + 0.45 * Math.max(0, dotV(f.normal, LIGHT));
  if (f.tex) {
    const p0 = f.proj[0], p1 = f.proj[1], p3 = f.proj[3];
    ctx.save();
    path(); ctx.clip();
    ctx.setTransform((p1.x-p0.x)/f.tex.width, (p1.y-p0.y)/f.tex.width,
                     (p3.x-p0.x)/f.tex.height, (p3.y-p0.y)/f.tex.height, p0.x, p0.y);
    ctx.imageSmoothingEnabled = false;
    ctx.globalAlpha = f.alpha;
    ctx.drawImage(f.tex, 0, 0);
    ctx.restore();
    path();
    ctx.fillStyle = `rgba(5,8,20,${(1-bright)*0.6})`;
    ctx.fill();
  } else {
    path();
    ctx.globalAlpha = f.alpha;
    const c = f.color.startsWith("#") ? f.color : "#8a8a8a";
    const rgb = [parseInt(c.slice(1,3),16), parseInt(c.slice(3,5),16), parseInt(c.slice(5,7),16)];
    ctx.fillStyle = `rgb(${rgb.map(v=>Math.round(v*bright)).join(",")})`;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = "rgba(0,0,0,0.35)";
    ctx.stroke();
  }
}

MCAssets.onReady(() => { draw(); paintChip(); });

/** First entry of the (possibly comma-separated) visual field - the preview
 * always shows the first source's look. */
function firstVisual(t) {
  return (t.visual || "").split(",")[0].trim();
}

function paintChip() {
  const c = $("fl-chip").getContext("2d");
  c.imageSmoothingEnabled = false;
  c.clearRect(0, 0, 16, 16);
  if (!cur()) return;
  const v = firstVisual(cur());
  const tex = MCAssets.block(v, "top");
  if (tex) c.drawImage(tex, 0, 0, 16, 16);
  else { c.fillStyle = colorFor(v); c.fillRect(2, 2, 12, 12); }
}

// ── UI ─────────────────────────────────────────────────────────────────────

function buildPanels() {
  // tabs
  const tabs = $("type-tabs");
  tabs.innerHTML = "";
  state.types.forEach((t, i) => {
    const row = document.createElement("div");
    row.className = "entity-nav-row";
    const b = document.createElement("button");
    b.textContent = t.id || `type ${i+1}`;
    b.className = i === state.current ? "active" : "";
    b.onclick = () => { state.current = i; changed(true); };
    row.appendChild(b);
    const del = document.createElement("button");
    del.textContent = "\u2715";
    del.className = "danger";
    del.title = `Delete ${t.id || `type ${i + 1}`}`;
    del.setAttribute("aria-label", del.title);
    del.onclick = () => {
      state.types.splice(i, 1);
      if (i < state.current) state.current--;
      else if (i === state.current) state.current = clamp(i, 0, state.types.length - 1);
      changed(true);
    };
    row.appendChild(del);
    tabs.appendChild(row);
  });

  const t = cur();
  syncPreviewChrome(t);
  if (!t) {
    // empty editor - blank the form and clear the biome list
    ["fl-id", "fl-name", "fl-sources", "fl-tools", "fl-wrongtool", "fl-visual", "fl-source",
     "fl-radius", "fl-baseline", "fl-dryrate"].forEach(id => $(id).value = "");
    $("fl-notill").checked = false;
    $("biome-list").innerHTML = "";
    paintChip();
    UI.refresh();
    return;
  }
  $("fl-id").value = t.id; $("fl-name").value = t.name;
  $("fl-sources").value = t.sources; $("fl-tools").value = t.tools;
  $("fl-wrongtool").value = t.wrongToolMessage || "";
  $("fl-visual").value = t.visual;
  $("fl-notill").checked = t.needsTilling === false;
  $("fl-source").value = t.source || "WATER";
  $("fl-radius").value = t.radius; $("fl-baseline").value = t.baseline; $("fl-dryrate").value = t.dryRate;

  // biome baselines
  const root = $("biome-list");
  root.innerHTML = "";
  t.biomes.forEach((b, i) => {
    const card = document.createElement("div");
    card.className = "card";
    card.innerHTML = `
      <div class="row">
        <label>biome key <input type="text" data-f="biome" data-keys="biomes" value="${esc(b.biome)}" spellcheck="false"></label>
        <label>baseline <input type="number" data-f="value" min="0" max="1" step="0.05" value="${b.value}"></label>
        <button class="danger row-delete" data-del>✕</button>
      </div>`;
    card.addEventListener("input", (e) => {
      const f = e.target.dataset.f;
      if (f === "biome") b.biome = e.target.value;
      if (f === "value") b.value = clamp(num(e.target.value, 0.1), 0, 1);
      renderYAML(); save();
    });
    card.querySelector("[data-del]").onclick = () => { t.biomes.splice(i, 1); changed(true); };
    root.appendChild(card);
  });
  paintChip();
  // repaint the shared controls (meters, '&'-code name field) for this type
  UI.refresh();
}

function esc(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

// ── YAML ───────────────────────────────────────────────────────────────────

function q(s) { return `"${String(s).replace(/"/g, '\\"')}"`; }

function yamlOut() {
  const L = [];
  L.push(`# Generated by tools/farmland-designer`);
  L.push(`# Drop into plugins/C4/farming/farmland/`);
  L.push(`farmland_types:`);
  for (const t of state.types) {
    const sources = t.sources.split(",").map(s => s.trim().toUpperCase()).filter(Boolean);
    const tools = t.tools.split(",").map(s => s.trim().toUpperCase()).filter(Boolean);
    L.push(``);
    L.push(`  ${t.id || "unnamed"}:`);
    L.push(`    display_name: ${q(t.name)}`);
    L.push(`    source_blocks: [${sources.join(", ") || "SAND"}]`);
    if (tools.length) L.push(`    till_tools: [${tools.join(", ")}]`);
    // Optional flavour shown before the auto-generated "only … hoes" list.
    const wrongMsg = (t.wrongToolMessage || "").trim();
    if (wrongMsg) L.push(`    wrong_tool_message: ${q(wrongMsg)}`);
    // Visual: one block for every source, or a comma list mapped 1:1 onto
    // source_blocks so each source keeps its own look.
    const visuals = (t.visual || "").split(",").map(s => s.trim().toUpperCase()).filter(Boolean);
    L.push(`    visual:`);
    if (visuals.length > 1) {
      L.push(`      block: [${visuals.join(", ")}]`);
    } else {
      L.push(`      block: ${visuals[0] || sources[0] || "SAND"}`);
    }
    // Only emit needs_tilling when it differs from the default (true).
    if (t.needsTilling === false) L.push(`    needs_tilling: false`);
    L.push(`    water:`);
    const source = (t.source || "WATER").trim().toUpperCase();
    if (source && source !== "WATER") L.push(`      source: ${source}`);
    L.push(`      radius: ${t.radius}`);
    L.push(`      biome_baseline:`);
    L.push(`        default: ${t.baseline}`);
    for (const b of t.biomes) {
      if (b.biome.trim()) L.push(`        ${q(b.biome.trim().toLowerCase())}: ${b.value}`);
    }
    L.push(`      dry_rate_per_minute: ${t.dryRate}`);
  }
  return L.join("\n") + "\n";
}

function renderYAML() {
  FileDock.render($("file-dock"), [
    { name: "farming/farmland/FarmlandTypes.yml", text: yamlOut(), badge: "new", open: true },
    ...FileStore.all(),
  ]);
}

// ── events ─────────────────────────────────────────────────────────────────

function bindEvents() {
  const bind = (id, apply, structural) =>
    $(id).addEventListener("input", (e) => { if (!cur()) return; apply(e.target); changed(!!structural); });
  bind("fl-id", t => { cur().id = t.value.trim(); }, false);
  $("fl-id").addEventListener("change", () => changed(true)); // refresh tab label
  bind("fl-name", t => cur().name = t.value);
  bind("fl-sources", t => cur().sources = t.value);
  bind("fl-tools", t => cur().tools = t.value);
  bind("fl-wrongtool", t => cur().wrongToolMessage = t.value);
  bind("fl-visual", t => { cur().visual = t.value.trim(); paintChip(); });
  $("fl-notill").addEventListener("input", (e) => {
    if (!cur()) return; cur().needsTilling = !e.target.checked; changed(false);
  });
  bind("fl-source", t => cur().source = (t.value.trim().toUpperCase() || "WATER"));
  bind("fl-radius", t => cur().radius = clamp(num(t.value, 4), 1, 8));
  bind("fl-baseline", t => cur().baseline = clamp(num(t.value, 0.1), 0, 1));
  bind("fl-dryrate", t => cur().dryRate = Math.max(0, num(t.value, 0.05)));

  $("btn-add-type").onclick = () => {
    state.types.push(blankType(`type_${state.types.length + 1}`));
    state.current = state.types.length - 1;
    changed(true);
  };
  $("btn-add-biome").onclick = () => {
    if (!cur()) return;
    cur().biomes.push({ biome: "minecraft:plains", value: 0.3 });
    changed(true);
  };
  $("btn-clear").onclick = () => {
    if ((state.types.length || FileStore.all().length) && !confirm("Clear all farmland types and uploaded files?")) return;
    state = emptyState();
    FileStore.clear();
    changed(true);
  };

  // upload an existing FarmlandTypes.yml to edit
  $("btn-upload").onclick = () => $("file-input").click();
  $("file-input").onchange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        importYaml(reader.result, file.name);
      } catch (err) {
        alert("Could not read that config:\n" + err.message);
      }
      $("file-input").value = "";
    };
    reader.readAsText(file);
  };

  const slider = $("water-slider");
  slider.addEventListener("input", () => {
    state.view.water = slider.value / 100;
    $("water-label").textContent = slider.value + "%";
    draw();
  });

  let dragging = false, lastX = 0, lastY = 0;
  canvas.addEventListener("pointerdown", (e) => {
    dragging = true; lastX = e.clientX; lastY = e.clientY;
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    state.view.yaw += (e.clientX - lastX) * 0.008;
    state.view.pitch = clamp(state.view.pitch + (e.clientY - lastY) * 0.008, -0.2, 1.4);
    lastX = e.clientX; lastY = e.clientY;
    draw();
  });
  canvas.addEventListener("pointerup", () => { dragging = false; save(); });
  canvas.addEventListener("wheel", (e) => {
    e.preventDefault();
    state.view.zoom = clamp(state.view.zoom * (e.deltaY > 0 ? 0.9 : 1.1), 30, 400);
    draw(); save();
  }, { passive: false });

}

// ── boot ───────────────────────────────────────────────────────────────────

bindEvents();
document.addEventListener("ui:pane", () => {
  if (!cur()) $("pane-title").textContent = "Farmland";
});
buildPanels();
renderYAML();
draw();
setTimeout(() => syncPreviewChrome(cur()), 0);
