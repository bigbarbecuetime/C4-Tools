/* Crop Designer - plain JS, uses ../shared/mc-assets.js for official textures.
 *
 * Visualizes crop stage "shapes" exactly as the plugin builds them:
 * each stage = a list of display elements (ItemDisplay or BlockDisplay)
 * with translation / rotation (XYZ euler degrees) / scale, relative to the
 * farmland block's top-center. Anchoring matches FarmingManager:
 *   - item elements pivot around their sprite center, use the FIXED item
 *     transform (flat, never follows the viewer) and render at full scale,
 *     matching observed in-game ItemDisplay rendering - scale 1 ≈ 1 block
 *   - block elements anchor at the bottom-center of the scaled, rotated block
 * Rotation order matches JOML rotationXYZ: Z, then Y, then X.
 */
"use strict";

// ── state ──────────────────────────────────────────────────────────────────

const STORE_KEY = "crop-designer-v4";

// Crop event triggers (matches CropDefinition / ItemEvents). Per-stage events
// use the same set and override the crop-wide values when present.
const CROP_TRIGGERS = ["on_punch", "on_harvest", "ambient"];
const DEFAULT_HB_OFFSET = 0.0625; // matches CropDefinition.DEFAULT_HITBOX_OFFSET

function defaultState() {
  return {
    crop: {
      id: "",
      name: "",
      farmland: "minecraft",
      seedName: "",
      seedModel: "minecraft:wheat_seeds",
      seedConsumable: "",
      randomRotation: false,
      randomOffset: true,
      netherOnly: false,
      fertilizer: "",
      herbalismXp: 50,
      mcmmoDoubleDrops: true,
      grassChance: 0,
      biomes: [],
      outsideRate: 0.4,
      minutes: 20,
      minLight: 9,
      minWater: 0.3,
      replant: false,
      harvestStage: 0,
      harvests: [],
      events: EventsEditor.defaults(CROP_TRIGGERS),
      stages: [
        { weight: 1, elements: [], hitbox: defHitbox(), events: null },
      ],
    },
    // Custom farmland comes from uploading a FarmlandTypes.yml; the crop
    // defaults to plain vanilla farmland ("minecraft").
    farmlandTypes: {},
    // Uploaded/created files live in shared/file-store.js (FileStore), not
    // here - that keeps the file dock the same across every tool page.
    view: { yaw: 0.65, pitch: 0.42, zoom: 220, stage: 0, progress: 1 },
  };
}

function el(type, model, block, translation, rotation, scale, texture) {
  return { type, model: model || "minecraft:short_grass", block: block || "CACTUS",
           texture: texture || "", translation, rotation, scale };
}

let state = load();

function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const loaded = JSON.parse(raw);
      // forward-compat: fill any fields added since the draft was saved
      const def = defaultState();
      loaded.crop = Object.assign(def.crop, loaded.crop);
      // migrate: biomes was a comma-separated string, now an array
      if (typeof loaded.crop.biomes === "string") {
        loaded.crop.biomes = loaded.crop.biomes.split(",").map(b => b.trim()).filter(Boolean);
      } else if (!Array.isArray(loaded.crop.biomes)) {
        loaded.crop.biomes = [];
      }
      // forward-compat: drafts saved before events existed
      if (!loaded.crop.events) loaded.crop.events = EventsEditor.defaults(CROP_TRIGGERS);
      loaded.farmlandTypes = loaded.farmlandTypes || {};
      // migrate: files used to live in this tool's own draft; move any into
      // the shared cross-page store, then drop the field for good.
      if (Array.isArray(loaded.files)) {
        for (const f of loaded.files) FileStore.remember(f.name, f.text);
        delete loaded.files;
      }
      loaded.view = Object.assign(def.view, loaded.view);
      return loaded;
    }
  } catch (e) { /* fall through to defaults */ }
  return defaultState();
}

function save() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) { /* full/blocked */ }
}

// ── import (parse the tool's own .yml files back into the editor) ───────────
// One upload handles crop / farmland / consumables files: crop and farmland
// configs load into the editor; consumables files are kept in the file dock
// (they are edited in the consumable designer).

function toList(v) { return Array.isArray(v) ? v : (v == null ? [] : [v]); }

function cropFromYaml(id, o) {
  o = o || {};
  const seed = o.seed || {};
  const growth = o.growth || {};
  const req = o.requirements || {};
  const harvest = o.harvest || {};
  const stages = toList(growth.stages).map(s => ({
    weight: num((s || {}).weight, 1),
    hitbox: hbFromYaml((s || {}).hitbox),
    events: (s || {}).events ? EventsEditor.fromYaml((s || {}).events, CROP_TRIGGERS) : null,
    elements: toList((s || {}).elements).map(e => el(
      e.type === "block" ? "block" : e.type === "head" ? "head" : "item",
      e.model != null ? String(e.model) : null,
      e.block != null ? String(e.block) : null,
      toVec(e.translation, [0, 0, 0]), toVec(e.rotation, [0, 0, 0]), toVec(e.scale, [1, 1, 1]),
      e.texture != null ? String(e.texture) : "")),
  }));
  const harvests = toList(harvest.results).map(r => r.seed
    ? { seed: true, item: "", min: num(r.min, 1), max: num(r.max, 1) }
    : { seed: false, item: String(r.item != null ? r.item : ""), min: num(r.min, 1), max: num(r.max, 1) });
  return {
    id, name: o.display_name || "",
    farmland: o.farmland != null ? String(o.farmland) : "minecraft",
    randomRotation: o.random_rotation === true,
    randomOffset: o.random_offset !== false,
    netherOnly: req.nether_only === true,
    fertilizer: o.fertilizer != null ? String(o.fertilizer) : "",
    herbalismXp: num((o.mcmmo || {}).herbalism_xp, 50),
    mcmmoDoubleDrops: (o.mcmmo || {}).double_drops !== false,
    seedName: seed.display_name || "", seedModel: seed.item_model != null ? String(seed.item_model) : "",
    seedConsumable: seed.consumable != null ? String(seed.consumable) : "",
    grassChance: num(seed.grass_drop_chance, 0),
    biomes: toList(req.biomes).map(b => String(b).trim()).filter(Boolean), outsideRate: num(req.outside_biome_rate, 0.4),
    minutes: num(growth.total_minutes, 20),
    minLight: num(req.min_light, 9), minWater: num(req.min_water, 0.3),
    replant: harvest.replant === true,
    harvestStage: num(harvest.harvest_stage, 0),
    harvests,
    events: EventsEditor.fromYaml(o.events, CROP_TRIGGERS),
    stages: stages.length ? stages : [{ weight: 1, elements: [], hitbox: defHitbox(), events: null }],
  };
}

function defHitbox() { return { width: 1, height: 1, offset: DEFAULT_HB_OFFSET }; }
function hbFromYaml(h) {
  h = h || {};
  return { width: num(h.width, 1), height: num(h.height, 1), offset: num(h.offset, DEFAULT_HB_OFFSET) };
}

function toVec(v, fallback) {
  if (!Array.isArray(v) || v.length < 3) return fallback.slice();
  return [num(v[0], fallback[0]), num(v[1], fallback[1]), num(v[2], fallback[2])];
}

function farmlandFromYaml(id, o) {
  o = o || {};
  const visual = toList((o.visual || {}).block);
  return {
    name: o.display_name || prettify(id),
    visual: visual[0] != null ? String(visual[0]) : "",
  };
}

function importYaml(text, fileName) {
  const doc = YAMLLite.parse(text);
  if (!doc || typeof doc !== "object") throw new Error("Couldn't parse that file.");
  let touched = false;

  if (doc.crops && typeof doc.crops === "object") {
    const [id, o] = Object.entries(doc.crops)[0] || [];
    if (id) { state.crop = cropFromYaml(id, o); touched = true; }
  }
  if (doc.farmland_types && typeof doc.farmland_types === "object") {
    for (const [id, o] of Object.entries(doc.farmland_types)) {
      state.farmlandTypes[id] = farmlandFromYaml(id, o);
      if (!state.crop.farmland || state.crop.farmland === "minecraft") {
        state.crop.farmland = id;
      }
      touched = true;
    }
  }
  // Consumables are edited in the consumable designer; here the file is only
  // kept (and listed in the dock) so the whole config set stays together.
  if (doc.consumables && typeof doc.consumables === "object") touched = true;
  if (!touched) {
    throw new Error("No 'crops:', 'farmland_types:' or 'consumables:' section found.");
  }
  rememberFile(fileName || "upload.yml", text);
  state.view.stage = clamp(state.view.stage, 0, state.crop.stages.length - 1);
  changed(true);
  setStage(state.view.stage);
}

/** Keeps the raw text of an uploaded config; re-uploads replace by name. */
function rememberFile(name, text) {
  FileStore.remember(name, text);
}

// ── small helpers ──────────────────────────────────────────────────────────

const $ = (id) => document.getElementById(id);
const colorFor = MCAssets.colorFor;

function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }
function num(v, fallback) { const n = parseFloat(v); return isNaN(n) ? fallback : n; }

function changed(structural) {
  if (structural) buildPanels();
  renderYAML();
  draw();
  save();
}

function prettify(id) {
  return id.split(/[_\-]/).filter(Boolean)
    .map(w => w[0].toUpperCase() + w.slice(1)).join(" ");
}

function shade(hex, factor) {
  const c = parseColor(hex);
  return `rgb(${Math.round(c[0] * factor)}, ${Math.round(c[1] * factor)}, ${Math.round(c[2] * factor)})`;
}

function parseColor(color) {
  if (color.startsWith("#")) {
    return [parseInt(color.slice(1, 3), 16), parseInt(color.slice(3, 5), 16), parseInt(color.slice(5, 7), 16)];
  }
  const m = color.match(/hsl\((\d+),\s*(\d+)%?,\s*(\d+)%?\)/);
  if (m) return hslToRgb(+m[1] / 360, +m[2] / 100, +m[3] / 100);
  return [160, 160, 160];
}

function hslToRgb(h, s, l) {
  const f = (n) => {
    const k = (n + h * 12) % 12;
    return Math.round(255 * (l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
  };
  return [f(0), f(8), f(4)];
}

// ── 3D math (mirrors the plugin's transform semantics) ─────────────────────

function rotXYZ(v, rx, ry, rz) {
  // JOML rotationXYZ ⇒ apply Z, then Y, then X
  let [x, y, z] = v;
  let c = Math.cos(rz), s = Math.sin(rz);
  [x, y] = [x * c - y * s, x * s + y * c];
  c = Math.cos(ry); s = Math.sin(ry);
  [x, z] = [x * c + z * s, -x * s + z * c];
  c = Math.cos(rx); s = Math.sin(rx);
  [y, z] = [y * c - z * s, y * s + z * c];
  return [x, y, z];
}

function deg(d) { return d * Math.PI / 180; }

// view transform: orbit yaw (Y) then pitch (X); larger view-z = closer
function toView(p) {
  const { yaw, pitch } = state.view;
  let [x, y, z] = p;
  let c = Math.cos(yaw), s = Math.sin(yaw);
  [x, z] = [x * c + z * s, -x * s + z * c];
  c = Math.cos(pitch); s = Math.sin(pitch);
  [y, z] = [y * c - z * s, y * s + z * c];
  return [x, y, z];
}

const canvas = $("preview");
const ctx = canvas.getContext("2d");

function project(p) {
  const v = toView(p);
  const cx = canvas.width / 2, cy = canvas.height / 2 + 110;
  return { x: cx + v[0] * state.view.zoom, y: cy - v[1] * state.view.zoom, z: v[2] };
}

// ── scene building ─────────────────────────────────────────────────────────

const LIGHT = normalize([0.45, 1, 0.25]);

function normalize(v) {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

function cross(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }

/**
 * One renderable quad. pts are ordered top-left, top-right, bottom-right,
 * bottom-left (texture-space orientation), so a texture maps directly:
 * u runs p0→p1, v runs p0→p3.
 */
function quadFace(pts, opts) {
  const n = normalize(cross(
    [pts[1][0] - pts[0][0], pts[1][1] - pts[0][1], pts[1][2] - pts[0][2]],
    [pts[3][0] - pts[0][0], pts[3][1] - pts[0][1], pts[3][2] - pts[0][2]]));
  return Object.assign({ pts, normal: n, alpha: 1, cull: false, flat: false, tex: null, texU: null, texV: null }, opts);
}

/** Box faces from 8 corners (bit order: x=1, y=2, z=4), texture-oriented. */
function boxFaces(corners, blockName) {
  const F = [
    { idx: [2, 3, 1, 0], kind: "side" },   // -z
    { idx: [7, 6, 4, 5], kind: "side" },   // +z
    { idx: [6, 2, 0, 4], kind: "side" },   // -x
    { idx: [3, 7, 5, 1], kind: "side" },   // +x
    { idx: [6, 7, 3, 2], kind: "top" },    // +y
    { idx: [0, 1, 5, 4], kind: "bottom" }, // -y
  ];
  const color = colorFor(blockName);
  return F.map(f => quadFace(f.idx.map(i => corners[i]), {
    color, cull: true, tex: MCAssets.block(blockName, f.kind),
  }));
}

function blockCorners(scale, rotation, translation) {
  // local: x ∈ [-sx/2, sx/2], y ∈ [0, sy], z ∈ [-sz/2, sz/2]  (bottom-center pivot)
  const [sx, sy, sz] = scale;
  const r = rotation.map(deg);
  const corners = [];
  for (let i = 0; i < 8; i++) {
    const local = [
      ((i & 1) ? sx / 2 : -sx / 2),
      ((i & 2) ? sy : 0),
      ((i & 4) ? sz / 2 : -sz / 2),
    ];
    const p = rotXYZ(local, r[0], r[1], r[2]);
    corners.push([p[0] + translation[0], p[1] + translation[1], p[2] + translation[2]]);
  }
  return corners;
}

/** Item sprite quads - full scale (scale 1 ≈ 1 block), matching how the
 * game actually renders FIXED ItemDisplays of the models we use. If editor
 * and game ever drift apart, this is the single factor to calibrate. */
function spriteQuads(element) {
  const [sx, sy, sz] = element.scale;
  const r = element.rotation.map(deg);
  const t = element.translation;
  const tex = MCAssets.item(element.model);
  const color = colorFor(element.model);
  const quads = [];
  // A FIXED ItemDisplay renders the flat item sprite as a SINGLE billboard -
  // not the crossed (#/X) planes a planted crop uses - extruded one texture
  // pixel deep (16x16x1 px), so the front and back planes sit scale_z/16
  // apart. Both are drawn without culling; the offset pair reads as the
  // item's thickness, especially near edge-on.
  const half = (sz || 1) / 32; // half of the 1/16-block extrusion depth
  for (const lz of [half, -half]) {
    // texture-space order: TL, TR, BR, BL (world +y is up)
    const pts = [];
    for (const [lx, ly] of [[-sx / 2, sy / 2], [sx / 2, sy / 2], [sx / 2, -sy / 2], [-sx / 2, -sy / 2]]) {
      const p = rotXYZ([lx, ly, lz], r[0], r[1], r[2]);
      pts.push([p[0] + t[0], p[1] + t[1], p[2] + t[2]]);
    }
    quads.push(quadFace(pts, { color, flat: true, tex }));
  }
  // Extrusion side faces along the sprite's opaque-pixel silhouette, each
  // textured with its 1-px edge strip (shaded by normal, like in-game).
  const runs = tex && MCAssets.edgeRuns(tex);
  if (runs) {
    const w = tex.width, h = tex.height;
    const X = u => (u / w - 0.5) * sx; // texture x -> sprite-local x
    const Y = v => (0.5 - v / h) * sy; // texture y -> sprite-local y
    const side = (pts, texU, texV) => quads.push(quadFace(pts.map(local => {
      const p = rotXYZ(local, r[0], r[1], r[2]);
      return [p[0] + t[0], p[1] + t[1], p[2] + t[2]];
    }), { color, tex, texU, texV }));
    for (const e of runs.left)
      side([[X(e.u), Y(e.v0), half], [X(e.u), Y(e.v0), -half], [X(e.u), Y(e.v1), -half], [X(e.u), Y(e.v1), half]],
           [e.col / w, (e.col + 1) / w], [e.v0 / h, e.v1 / h]);
    for (const e of runs.right)
      side([[X(e.u), Y(e.v0), -half], [X(e.u), Y(e.v0), half], [X(e.u), Y(e.v1), half], [X(e.u), Y(e.v1), -half]],
           [e.col / w, (e.col + 1) / w], [e.v0 / h, e.v1 / h]);
    for (const e of runs.top)
      side([[X(e.u0), Y(e.v), half], [X(e.u1), Y(e.v), half], [X(e.u1), Y(e.v), -half], [X(e.u0), Y(e.v), -half]],
           [e.u0 / w, e.u1 / w], [e.row / h, (e.row + 1) / h]);
    for (const e of runs.bottom)
      side([[X(e.u0), Y(e.v), -half], [X(e.u1), Y(e.v), -half], [X(e.u1), Y(e.v), half], [X(e.u0), Y(e.v), half]],
           [e.u0 / w, e.u1 / w], [e.row / h, (e.row + 1) / h]);
  }
  return quads;
}

/** Vanilla plant-block quads (wheat, carrots, bushes, corals, ...): the #
 * pattern of the crop model, or two diagonal planes for cross models, with
 * the right stage texture for the element's [age=n]. Growing stems (cs.h < 1)
 * shorten the planes and sample only the bottom of the texture, like the
 * vanilla stem models. Transforms apply like blockCorners (bottom-center
 * pivot). */
function plantQuads(element, cs) {
  const [sx, sy, sz] = element.scale;
  const r = element.rotation.map(deg);
  const t = element.translation;
  const tex = MCAssets.blockSprite(element.block);
  const color = colorFor(element.block);
  const h = cs.h != null ? cs.h : 1;
  const quads = [];
  // plane endpoints in unit-block local space (x0,z0 -> x1,z1)
  const planes = cs.shape === "cross"
    ? [
        [[-0.354, -0.354], [0.354, 0.354]],
        [[-0.354, 0.354], [0.354, -0.354]],
      ]
    : [
        [[-0.25, -0.5], [-0.25, 0.5]],
        [[0.25, -0.5], [0.25, 0.5]],
        [[-0.5, -0.25], [0.5, -0.25]],
        [[-0.5, 0.25], [0.5, 0.25]],
      ];
  for (const [[x0, z0], [x1, z1]] of planes) {
    // texture-space order: TL, TR, BR, BL (world +y is up)
    const pts = [];
    for (const [lx, lz, ly] of [[x0, z0, h], [x1, z1, h], [x1, z1, 0], [x0, z0, 0]]) {
      let p = [lx * sx, ly * sy, lz * sz];
      p = rotXYZ(p, r[0], r[1], r[2]);
      pts.push([p[0] + t[0], p[1] + t[1], p[2] + t[2]]);
    }
    quads.push(quadFace(pts, {
      color, alpha: 0.95, flat: true, tex,
      texV: h < 1 ? [1 - h, 1] : null,
    }));
  }
  return quads;
}

/**
 * Quads for a vanilla block model's cuboid elements (cactus, chorus, heavy
 * core, chests, ...). Element coords are 0..16 model space mapped into the
 * unit block (bottom-center pivot, like blockCorners), then the display's
 * scale/rotation/translation apply. Per-face uv (0..16 over the texture)
 * maps through texU/texV; face rotation cycles the corner order.
 */
function modelQuads(element, model) {
  const [sx, sy, sz] = element.scale;
  const r = element.rotation.map(deg);
  const t = element.translation;
  const color = colorFor(element.block);
  const quads = [];
  for (const el of model.elements) {
    const [x1, y1, z1] = el.from, [x2, y2, z2] = el.to;
    const L = (x, y, z) => {
      let p = [x / 16 - 0.5, y / 16, z / 16 - 0.5];
      if (el.rotation) p = elementRot(p, el.rotation);
      p = rotXYZ([p[0] * sx, p[1] * sy, p[2] * sz], r[0], r[1], r[2]);
      return [p[0] + t[0], p[1] + t[1], p[2] + t[2]];
    };
    // texture-space corner order (TL,TR,BR,BL) with outward normals
    // (winding matches boxFaces), and default uv per direction
    const F = {
      north: { c: [[x1, y2, z1], [x2, y2, z1], [x2, y1, z1], [x1, y1, z1]], uv: [16 - x2, 16 - y2, 16 - x1, 16 - y1] },
      south: { c: [[x2, y2, z2], [x1, y2, z2], [x1, y1, z2], [x2, y1, z2]], uv: [x1, 16 - y2, x2, 16 - y1] },
      west:  { c: [[x1, y2, z2], [x1, y2, z1], [x1, y1, z1], [x1, y1, z2]], uv: [z1, 16 - y2, z2, 16 - y1] },
      east:  { c: [[x2, y2, z1], [x2, y2, z2], [x2, y1, z2], [x2, y1, z1]], uv: [16 - z2, 16 - y2, 16 - z1, 16 - y1] },
      up:    { c: [[x1, y2, z2], [x2, y2, z2], [x2, y2, z1], [x1, y2, z1]], uv: [x1, z1, x2, z2] },
      down:  { c: [[x1, y1, z1], [x2, y1, z1], [x2, y1, z2], [x1, y1, z2]], uv: [x1, 16 - z2, x2, 16 - z1] },
    };
    for (const dir in F) {
      const face = el.faces && el.faces[dir];
      if (!face) continue;
      const pts = F[dir].c.map(([x, y, z]) => L(x, y, z));
      for (let k = (face.rotation || 0) / 90; k > 0; k--) pts.push(pts.shift());
      const uv = face.uv || F[dir].uv;
      quads.push(quadFace(pts, {
        color, cull: true, flat: el.shade === false,
        tex: MCAssets.modelTexture(model, face.texture),
        texU: [Math.min(uv[0], uv[2]) / 16, Math.max(uv[0], uv[2]) / 16],
        texV: [Math.min(uv[1], uv[3]) / 16, Math.max(uv[1], uv[3]) / 16],
      }));
    }
  }
  return quads;
}

/** Applies a model element's {origin, axis, angle, rescale} rotation in unit-block space. */
function elementRot(p, rot) {
  const o = [rot.origin[0] / 16 - 0.5, rot.origin[1] / 16, rot.origin[2] / 16 - 0.5];
  const a = deg(rot.angle || 0), c = Math.cos(a), s = Math.sin(a);
  let v = [p[0] - o[0], p[1] - o[1], p[2] - o[2]];
  if (rot.rescale && c) { // stretch perpendicular axes so 45° planes reach the corners
    const f = 1 / Math.abs(c);
    if (rot.axis === "x") { v[1] *= f; v[2] *= f; }
    else if (rot.axis === "y") { v[0] *= f; v[2] *= f; }
    else { v[0] *= f; v[1] *= f; }
  }
  if (rot.axis === "x") v = [v[0], v[1] * c - v[2] * s, v[1] * s + v[2] * c];
  else if (rot.axis === "y") v = [v[0] * c + v[2] * s, v[1], -v[0] * s + v[2] * c];
  else v = [v[0] * c - v[1] * s, v[0] * s + v[1] * c, v[2]];
  return [v[0] + o[0], v[1] + o[1], v[2] + o[2]];
}

/** Player-head quads: a half-block cube with the skin's face textures,
 * centered on the translation like an item pivot (an ItemDisplay head at
 * scale 1 renders as a 0.5-block head). */
function headQuads(element) {
  const cube = MCAssets.headCube(element.texture);
  const r = element.rotation.map(deg);
  const t = element.translation;
  const ex = 0.25 * element.scale[0], ey = 0.25 * element.scale[1], ez = 0.25 * element.scale[2];
  const C = [];
  for (let i = 0; i < 8; i++) {
    const local = [(i & 1) ? ex : -ex, (i & 2) ? ey : -ey, (i & 4) ? ez : -ez];
    const p = rotXYZ(local, r[0], r[1], r[2]);
    C.push([p[0] + t[0], p[1] + t[1], p[2] + t[2]]);
  }
  // MCAssets names the side faces by the head's own anatomy, matching the skin
  // layout: "right" is the region at (0,8), the head's right side. The head
  // looks down -z here, so its right hand points +x - and a viewer facing it
  // sees that side on their left. Getting these two the wrong way round
  // mirrors any asymmetric head skin.
  const F = [
    { idx: [2, 3, 1, 0], face: "front" },  // -z
    { idx: [7, 6, 4, 5], face: "back" },   // +z
    { idx: [6, 2, 0, 4], face: "left" },   // -x, the head's left
    { idx: [3, 7, 5, 1], face: "right" },  // +x, the head's right
    { idx: [6, 7, 3, 2], face: "top" },    // +y
    { idx: [0, 1, 5, 4], face: "bottom" }, // -y
  ];
  return F.map(f => quadFace(f.idx.map(i => C[i]), {
    color: "#9a7a5a", cull: true, tex: cube ? cube[f.face] : null,
  }));
}

// ── BSP hidden-surface ordering ────────────────────────────────────────────
//
// Painter's sort by average depth fails for interpenetrating quads (crops
// clipping through the farmland box) and flips between near-equal depths
// (sprite planes vs their edge faces). A BSP tree splits quads along each
// other's planes so back-to-front traversal is exact from every angle.
// Built once per draw (O(n²) plane tests on ~100s of quads - negligible).

const BSP_EPS = 1e-4;

/**
 * Splits a convex polygon (array of [x,y,z]) by plane n·p = d.
 * @returns {{front: Array|null, back: Array|null}} polygon pieces on each side
 */
function splitPoly(poly, n, d) {
  const front = [], back = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const da = dot(n, a) - d, db = dot(n, b) - d;
    if (da >= -BSP_EPS) front.push(a);
    if (da <= BSP_EPS) back.push(a);
    if ((da > BSP_EPS && db < -BSP_EPS) || (da < -BSP_EPS && db > BSP_EPS)) {
      const t = da / (da - db);
      const m = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
      front.push(m);
      back.push(m);
    }
  }
  return { front: front.length > 2 ? front : null, back: back.length > 2 ? back : null };
}

/** Inserts {face, poly} into the BSP tree rooted at node (mutates), splitting as needed. */
function bspInsert(node, item) {
  let minD = 0, maxD = 0;
  for (const p of item.poly) {
    const dd = dot(node.n, p) - node.d;
    if (dd < minD) minD = dd;
    if (dd > maxD) maxD = dd;
  }
  const send = (key, it) => {
    if (node[key]) bspInsert(node[key], it);
    else node[key] = { n: it.face.normal, d: dot(it.face.normal, it.poly[0]), items: [it], front: null, back: null };
  };
  if (minD >= -BSP_EPS && maxD <= BSP_EPS) node.items.push(item);
  else if (minD >= -BSP_EPS) send("front", item);
  else if (maxD <= BSP_EPS) send("back", item);
  else {
    const s = splitPoly(item.poly, node.n, node.d);
    if (s.front) send("front", { face: item.face, poly: s.front });
    if (s.back) send("back", { face: item.face, poly: s.back });
  }
}

/** Builds a BSP tree over faces (zero-area faces are dropped - invisible). */
function bspBuild(faces) {
  let root = null;
  for (const face of faces) {
    const n = face.normal;
    if (!n[0] && !n[1] && !n[2]) continue;
    const item = { face, poly: face.pts };
    if (root) bspInsert(root, item);
    else root = { n, d: dot(n, face.pts[0]), items: [item], front: null, back: null };
  }
  return root;
}

/** Paints the tree back-to-front for the current view (culls per-face flags). */
function bspPaint(node) {
  if (!node) return;
  const near = toView(node.n)[2] > 0 ? "front" : "back";
  bspPaint(near === "front" ? node.back : node.front);
  for (const it of node.items) {
    if (it.face.cull && toView(it.face.normal)[2] < 0) continue;
    paintFace(it.face, it.poly);
  }
  bspPaint(node[near]);
}

// ── render ─────────────────────────────────────────────────────────────────

function draw() {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  drawGrid();

  const faces = [];

  // farmland block (top at y=0), textured with the farmland's visual block
  const flType = state.farmlandTypes[state.crop.farmland];
  const visual = flType && flType.visual ? flType.visual : "farmland_moist";
  faces.push(...boxFaces(blockCorners([1, 0.9375, 1], [0, 0, 0], [0, -0.9375, 0]), visual));

  // crop stage shape
  const stage = state.crop.stages[clamp(state.view.stage, 0, state.crop.stages.length - 1)];
  if (stage) {
    for (const element of stage.elements) {
      if (element.type === "block") {
        const cs = MCAssets.cropState(element.block);
        if (cs) {
          faces.push(...plantQuads(element, cs));
        } else {
          const model = MCAssets.blockModel(element.block);
          if (model) {
            faces.push(...modelQuads(element, model));
          } else { // plain cube while the model loads / for modelless blocks
            faces.push(...boxFaces(
              blockCorners(element.scale, element.rotation, element.translation), element.block));
          }
        }
      } else if (element.type === "head") {
        faces.push(...headQuads(element));
      } else {
        faces.push(...spriteQuads(element));
      }
    }
  }

  const hbToggle = $("show-hitbox");
  if (stage && (!hbToggle || hbToggle.checked)) faces.push(...hitboxQuads(stage));

  // exact back-to-front order via BSP (see bspBuild)
  bspPaint(bspBuild(faces));

  // anchor marker
  const o = project([0, 0, 0]);
  ctx.fillStyle = "rgba(255,255,255,0.5)";
  ctx.beginPath();
  ctx.arc(o.x, o.y, 2.5, 0, Math.PI * 2);
  ctx.fill();

  drawHud(stage);
}

/** Paints face f clipped to poly (a piece of f from BSP splitting, or f.pts whole). */
function paintFace(f, poly) {
  const frag = (poly || f.pts).map(project);
  const path = () => {
    ctx.beginPath();
    ctx.moveTo(frag[0].x, frag[0].y);
    for (let i = 1; i < frag.length; i++) ctx.lineTo(frag[i].x, frag[i].y);
    ctx.closePath();
  };
  const bright = f.flat ? 1 : 0.55 + 0.45 * Math.max(0, dot(f.normal, LIGHT));

  if (f.tex) {
    // Orthographic projection of a planar rectangle is a parallelogram, so a
    // single affine transform maps the texture exactly onto the face; the
    // fragment path clips it to this BSP piece.
    // texU/texV limit sampling to a texture slice (growing stems, edge runs).
    const [p0, p1, , p3] = f.pts.map(project);
    const tw = f.tex.width, th = f.tex.height;
    const sx = f.texU ? f.texU[0] * tw : 0;
    const sw = f.texU ? (f.texU[1] - f.texU[0]) * tw : tw;
    const sy = f.texV ? f.texV[0] * th : 0;
    const sh = f.texV ? (f.texV[1] - f.texV[0]) * th : th;
    ctx.save();
    path();
    ctx.clip();
    ctx.setTransform((p1.x - p0.x) / sw, (p1.y - p0.y) / sw,
                     (p3.x - p0.x) / sh, (p3.y - p0.y) / sh, p0.x, p0.y);
    ctx.imageSmoothingEnabled = false;
    ctx.globalAlpha = f.alpha;
    ctx.drawImage(f.tex, sx, sy, sw, sh, 0, 0, sw, sh);
    ctx.restore();
    if (bright < 0.999) {
      path();
      ctx.fillStyle = `rgba(5, 8, 20, ${(1 - bright) * 0.6})`;
      ctx.fill();
    }
  } else {
    path();
    ctx.globalAlpha = f.alpha;
    ctx.fillStyle = shade(f.color, bright);
    ctx.fill();
    ctx.globalAlpha = 1;
    // outline whole faces only - not BSP seams, not unstroked (hitbox) bars
    if (f.stroke !== false && (!poly || poly === f.pts)) {
      ctx.strokeStyle = "rgba(0,0,0,0.35)";
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }
}

/**
 * Quads for the stage's Interaction hitbox: 12 thin glowing bars along the
 * box edges (width x height, base at the farmland surface + offset, centered
 * on the block - FarmingManager's anchor). Real geometry, so the BSP
 * depth-sorts it against the crop like the in-game CropHighlighter bars.
 */
function hitboxQuads(stage) {
  const hb = stage.hitbox || defHitbox();
  const w = hb.width / 2, y0 = hb.offset, y1 = hb.offset + hb.height;
  const C = [[-w, -w], [w, -w], [w, w], [-w, w]];
  const quads = [];
  for (let i = 0; i < 4; i++) {
    const [x, z] = C[i], [nx, nz] = C[(i + 1) % 4];
    quads.push(...barQuads([x, y0, z], [nx, y0, nz])); // bottom edge
    quads.push(...barQuads([x, y1, z], [nx, y1, nz])); // top edge
    quads.push(...barQuads([x, y0, z], [x, y1, z]));   // vertical edge
  }
  return quads;
}

/** A thin axis-aligned box (bar) from a to b, as 6 unstroked glowing faces. */
function barQuads(a, b) {
  const t = 0.015;
  const mn = a.map((v, i) => Math.min(v, b[i]) - t);
  const mx = a.map((v, i) => Math.max(v, b[i]) + t);
  const C = [];
  for (let i = 0; i < 8; i++) {
    C.push([(i & 1) ? mx[0] : mn[0], (i & 2) ? mx[1] : mn[1], (i & 4) ? mx[2] : mn[2]]);
  }
  const F = [[2, 3, 1, 0], [7, 6, 4, 5], [6, 2, 0, 4], [3, 7, 5, 1], [6, 7, 3, 2], [0, 1, 5, 4]];
  return F.map(idx => quadFace(idx.map(i => C[i]), {
    color: "#82f096", flat: true, alpha: 0.85, cull: true, stroke: false,
  }));
}

function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawGrid() {
  ctx.strokeStyle = "rgba(120,150,180,0.15)";
  ctx.lineWidth = 1;
  const ext = 2.5, top = -0.9375;
  for (let i = -ext; i <= ext; i += 0.5) {
    line([i, top, -ext], [i, top, ext]);
    line([-ext, top, i], [ext, top, i]);
  }
  function line(a, b) {
    const pa = project(a), pb = project(b);
    ctx.beginPath();
    ctx.moveTo(pa.x, pa.y);
    ctx.lineTo(pb.x, pb.y);
    ctx.stroke();
  }
}

function drawHud(stage) {
  const i = clamp(state.view.stage, 0, state.crop.stages.length - 1);
  const count = stage ? stage.elements.length : 0;
  const nameColor = "rgba(215,221,229,0.85)";
  const cursor = LegacyText.drawRuns(ctx, state.crop.name || state.crop.id, 14, 22,
    nameColor, "13px Consolas, monospace");
  ctx.fillStyle = nameColor;
  ctx.fillText(`. Stage ${i + 1}/${state.crop.stages.length}`
    + ` (${count} element${count === 1 ? "" : "s"})`, cursor, 22);
  ctx.fillStyle = "rgba(138,148,161,0.8)";
  ctx.fillText(`light ≥ ${state.crop.minLight}   water ≥ ${state.crop.minWater}`
    + `   ${state.crop.minutes} min (×${state.crop.outsideRate} outside biomes)`, 14, 40);
}

// redraw whenever a texture finishes loading
MCAssets.onReady(() => { draw(); paintChips(); });

// ── texture chips ──────────────────────────────────────────────────────────

function paintChips() {
  chip($("seed-chip"), MCAssets.item(state.crop.seedModel), colorFor(state.crop.seedModel));
  // Fertilizer chip: blank shows the auto default (magma cream for nether crops, else bonemeal).
  const fert = (state.crop.fertilizer || "").trim()
    || (state.crop.netherOnly ? "MAGMA_CREAM" : "BONE_MEAL");
  const fertModel = "minecraft:" + fert.toLowerCase();
  chip($("fert-chip"), MCAssets.item(fertModel), colorFor(fertModel));
}

function chip(canvasEl, tex, fallback) {
  if (!canvasEl) return;
  const c = canvasEl.getContext("2d");
  c.imageSmoothingEnabled = false;
  c.clearRect(0, 0, 16, 16);
  if (tex) c.drawImage(tex, 0, 0, 16, 16);
  else { c.fillStyle = fallback; c.fillRect(2, 2, 12, 12); }
}

// ── stage / progress mapping (mirrors CropDefinition.stageFor) ─────────────

// The final stage IS full growth: it appears only at progress 1.0 (when the
// crop is harvestable). Earlier stages divide [0,1) by weight - the final
// stage's weight is ignored, like a mature vanilla crop.
function stageFor(progress) {
  const stages = state.crop.stages;
  if (!stages.length) return 0;
  if (progress >= 1 || stages.length === 1) return stages.length - 1;
  const growing = stages.slice(0, -1).reduce((s, st) => s + (st.weight || 1), 0);
  let cumulative = 0;
  for (let i = 0; i < stages.length - 2; i++) {
    cumulative += stages[i].weight || 1;
    if (progress < cumulative / growing) return i;
  }
  return stages.length - 2;
}

function stageMidProgress(index) {
  const stages = state.crop.stages;
  if (index >= stages.length - 1) return 1;
  const growing = stages.slice(0, -1).reduce((s, st) => s + (st.weight || 1), 0);
  let cumulative = 0;
  for (let i = 0; i < index; i++) cumulative += stages[i].weight || 1;
  return (cumulative + (stages[index].weight || 1) / 2) / growing;
}

// ── UI: panels ─────────────────────────────────────────────────────────────

function buildPanels() {
  bindCropForm();
  buildHarvestList();
  buildCropEvents();
  buildStageList();
  buildStageBar();
  paintChips();
}

function buildCropEvents() {
  EventsEditor.render($("crop-events"), state.crop.events, CROP_TRIGGERS,
    () => { renderYAML(); save(); });
}

/** The crop-designer YAML output omits grass_drop_chance entirely at 0 (the
 *  field's own default), which silently made a crop unobtainable from grass
 *  in every biome with nothing in the UI to flag it - surface that state. */
function syncGrassChanceWarning() {
  $("crop-grasschance-warn").style.display = state.crop.grassChance > 0 ? "none" : "";
}

/** Live-renders the seed name's '&' color codes, so the seed name gets the
 *  same in-tool feedback the crop name does via the 3D HUD. */
function syncSeedNamePreview() {
  $("seed-name-preview").innerHTML = LegacyText.toHtml(state.crop.seedName || "", esc);
}

function bindCropForm() {
  const c = state.crop;
  setVal("crop-id", c.id); setVal("crop-name", c.name); setVal("crop-farmland", c.farmland);
  setVal("seed-name", c.seedName); setVal("seed-model", c.seedModel);
  $("seed-isconsumable").checked = !!(c.seedConsumable || "").trim();
  setVal("crop-grasschance", c.grassChance);
  syncGrassChanceWarning();
  syncSeedNamePreview();
  buildBiomePicker(); setVal("crop-outsiderate", c.outsideRate);
  setVal("crop-minutes", c.minutes); setVal("crop-light", c.minLight); setVal("crop-water", c.minWater);
  $("crop-replant").checked = c.replant;
  setVal("crop-harveststage", c.harvestStage || 0);
  $("crop-netheronly").checked = !!c.netherOnly;
  setVal("crop-fertilizer", c.fertilizer || "");
  $("crop-randomrot").checked = !!c.randomRotation;
  $("crop-randomoffset").checked = c.randomOffset !== false;
  setVal("crop-herbxp", c.herbalismXp);
  $("crop-doubledrops").checked = c.mcmmoDoubleDrops !== false;
}

function setVal(id, v) { $(id).value = v; }

// ── multi-select biome picker ──────────────────────────────────────────────
// Natural biomes are stored as an array of keys. This widget renders them as
// removable chips and exposes a searchable dropdown of every vanilla biome
// (MCKeys.BIOMES) with checkboxes. Custom keys (e.g. biome-group names like
// "plains_like") can be typed into the search box and added with Enter.
function buildBiomePicker() {
  const root = $("crop-biomes");
  if (!root) return;
  const c = state.crop;
  if (!Array.isArray(c.biomes)) c.biomes = [];

  // Clean up a previous render's document-level click handler.
  if (root._msOutsideClick) document.removeEventListener("click", root._msOutsideClick);

  root.innerHTML = "";
  root.classList.add("multi-select");

  // ── chips: one per selected biome, each removable ──
  const chipsWrap = document.createElement("div");
  chipsWrap.className = "ms-chips";

  const renderChips = () => {
    chipsWrap.innerHTML = "";
    if (c.biomes.length === 0) {
      chipsWrap.innerHTML = '<span class="ms-empty">none. Full speed everywhere.</span>';
      return;
    }
    for (const b of c.biomes) {
      const chip = document.createElement("span");
      chip.className = "ms-chip";
      const label = document.createElement("span");
      label.textContent = b;
      chip.appendChild(label);
      const x = document.createElement("button");
      x.className = "danger";
      x.type = "button";
      x.textContent = "✕";
      x.title = "remove " + b;
      x.onclick = (e) => {
        e.stopPropagation();
        c.biomes = c.biomes.filter(v => v !== b);
        renderChips();
        renderList();
        changed(false);
      };
      chip.appendChild(x);
      chipsWrap.appendChild(chip);
    }
  };

  // ── add button + searchable dropdown ──
  const addBtn = document.createElement("button");
  addBtn.className = "add ms-add";
  addBtn.type = "button";
  addBtn.textContent = "+ biome";

  const dropdown = document.createElement("div");
  dropdown.className = "ms-drop";
  dropdown.hidden = true;

  const search = document.createElement("input");
  search.type = "text";
  search.spellcheck = false;
  search.placeholder = "search biomes…";

  const list = document.createElement("div");
  list.className = "ms-list";

  const renderList = () => {
    const q = search.value.trim().toLowerCase();
    const all = (typeof MCKeys !== "undefined" && MCKeys.BIOMES) ? MCKeys.BIOMES : [];
    const filtered = q ? all.filter(b => b.toLowerCase().includes(q)) : all;
    list.innerHTML = "";
    for (const b of all) {
      if (q && !b.toLowerCase().includes(q)) continue;
      const row = document.createElement("label");
      row.className = "check ms-row";
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = c.biomes.includes(b);
      const span = document.createElement("span");
      span.textContent = b;
      row.appendChild(cb);
      row.appendChild(span);
      cb.onchange = () => {
        if (cb.checked) {
          if (!c.biomes.includes(b)) c.biomes.push(b);
        } else {
          c.biomes = c.biomes.filter(v => v !== b);
        }
        renderChips();
        changed(false);
      };
      list.appendChild(row);
    }
    // Offer to add a custom key (e.g. a biome-group name) when the typed text
    // isn't an exact match for a canonical biome and isn't already selected.
    const typed = search.value.trim();
    if (typed && !all.some(b => b.toLowerCase() === typed.toLowerCase())
              && !c.biomes.some(v => v.toLowerCase() === typed.toLowerCase())) {
      const row = document.createElement("div");
      row.className = "ms-row ms-custom";
      row.title = "add custom key";
      row.textContent = '+ add "' + typed + '"';
      row.onclick = () => {
        if (!c.biomes.includes(typed)) c.biomes.push(typed);
        search.value = "";
        renderChips();
        renderList();
        changed(false);
        search.focus();
      };
      list.appendChild(row);
    }
    if (filtered.length === 0 && list.children.length === 0) {
      list.innerHTML = '<div class="ms-empty">no matches</div>';
    }
  };

  search.oninput = renderList;
  search.onkeydown = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const v = search.value.trim();
      if (v && !c.biomes.some(b => b.toLowerCase() === v.toLowerCase())) {
        c.biomes.push(v);
        renderChips();
        changed(false);
      }
      search.value = "";
      renderList();
    } else if (e.key === "Escape") {
      close();
    }
  };

  dropdown.appendChild(search);
  dropdown.appendChild(list);

  const open = () => {
    dropdown.hidden = false;
    search.value = "";
    renderList();
    search.focus();
  };
  const close = () => { dropdown.hidden = true; };

  addBtn.onclick = (e) => {
    e.stopPropagation();
    if (dropdown.hidden) open(); else close();
  };
  // Close when clicking outside the widget. Stored on the root so a rebuild
  // can remove the previous handler before adding a fresh one.
  root._msOutsideClick = (e) => {
    if (!dropdown.hidden && !root.contains(e.target)) close();
  };
  document.addEventListener("click", root._msOutsideClick);

  root.appendChild(chipsWrap);
  root.appendChild(addBtn);
  root.appendChild(dropdown);

  renderChips();
}

function buildHarvestList() {
  const root = $("harvest-list");
  root.innerHTML = "";
  state.crop.harvests.forEach((h, i) => {
    const card = document.createElement("div");
    card.className = "card";
    card.innerHTML = `
      <div class="card-head">
        <label class="check"><input type="checkbox" data-f="seed" ${h.seed ? "checked" : ""}> seeds</label>
        <span class="grow"></span>
        <button class="danger" data-del>✕</button>
      </div>
      <div class="row">
        <label>consumable id <input type="text" data-f="item" value="${esc(h.item)}" ${h.seed ? "disabled" : ""}></label>
        <label>min <input type="number" data-f="min" min="0" value="${h.min}"></label>
        <label>max <input type="number" data-f="max" min="0" value="${h.max}"></label>
      </div>`;
    card.addEventListener("input", (e) => {
      const f = e.target.dataset.f;
      if (f === "seed") { h.seed = e.target.checked; changed(true); return; }
      if (f === "item") { h.item = e.target.value; changed(false); return; }
      if (f) { h[f] = num(e.target.value, 1); changed(false); }
    });
    card.querySelector("[data-del]").onclick = () => {
      state.crop.harvests.splice(i, 1);
      changed(true);
    };
    root.appendChild(card);
  });
}

function buildStageList() {
  const root = $("stage-list");
  root.innerHTML = "";
  state.crop.stages.forEach((stage, si) => {
    if (!stage.hitbox) stage.hitbox = defHitbox();
    const hb = stage.hitbox;
    const card = document.createElement("div");
    card.className = "card stage-card" + (si === state.view.stage ? " active" : "");
    card.innerHTML = `
      <div class="card-head">
        <strong>Stage ${si + 1}</strong>
        <label class="check">weight <input type="number" data-weight style="width:60px" min="0.1" step="0.5" value="${stage.weight}"></label>
        <span class="grow"></span>
        <button data-view title="Preview this stage">👁</button>
        <button data-dup title="Duplicate stage">⧉</button>
        <button class="danger" data-del>✕</button>
      </div>
      <div class="hitbox-row">
        <span class="muted">hitbox</span>
        <label>w <input type="number" data-hb="width" style="width:56px" min="0.1" max="3" step="0.1" value="${hb.width}"></label>
        <label>h <input type="number" data-hb="height" style="width:56px" min="0.1" max="3" step="0.1" value="${hb.height}"></label>
        <label>offset <input type="number" data-hb="offset" style="width:56px" min="-1" max="2" step="0.05" value="${hb.offset}"></label>
      </div>
      <div class="stage-events-row">
        <label class="check"><input type="checkbox" data-stage-ev ${stage.events ? "checked" : ""}> stage effects (override crop-wide)</label>
        <div class="stage-events" ${stage.events ? "" : "hidden"}></div>
      </div>
      <div class="elements"></div>
      <button class="add" data-add-el>+ element</button>`;
    card.querySelectorAll("[data-hb]").forEach(inp => inp.addEventListener("input", (e) => {
      stage.hitbox[e.target.dataset.hb] = num(e.target.value,
        e.target.dataset.hb === "offset" ? DEFAULT_HB_OFFSET : 1);
      changed(false);
    }));
    const evToggle = card.querySelector("[data-stage-ev]");
    const evRoot = card.querySelector(".stage-events");
    const renderStageEvents = () => EventsEditor.render(evRoot, stage.events, CROP_TRIGGERS,
      () => { renderYAML(); save(); });
    if (stage.events) renderStageEvents();
    evToggle.addEventListener("change", () => {
      if (evToggle.checked) {
        stage.events = stage.events || EventsEditor.defaults(CROP_TRIGGERS);
        evRoot.hidden = false;
        renderStageEvents();
      } else {
        stage.events = null;
        evRoot.hidden = true;
        evRoot.innerHTML = "";
      }
      changed(false);
    });
    const elRoot = card.querySelector(".elements");
    stage.elements.forEach((element, ei) => elRoot.appendChild(elementCard(stage, element, si, ei)));

    card.querySelector("[data-weight]").addEventListener("input", (e) => {
      stage.weight = Math.max(0.1, num(e.target.value, 1));
      changed(false);
    });
    card.querySelector("[data-view]").onclick = () => { setStage(si); };
    card.querySelector("[data-dup]").onclick = () => {
      state.crop.stages.splice(si + 1, 0, JSON.parse(JSON.stringify(stage)));
      changed(true);
    };
    card.querySelector("[data-del]").onclick = () => {
      if (state.crop.stages.length <= 1) return;
      state.crop.stages.splice(si, 1);
      state.view.stage = clamp(state.view.stage, 0, state.crop.stages.length - 1);
      changed(true);
    };
    card.querySelector("[data-add-el]").onclick = () => {
      stage.elements.push(el("item", "minecraft:short_grass", "CACTUS",
        [0, 0.25, 0], [0, 45, 0], [1, 1, 1]));
      changed(true);
    };
    root.appendChild(card);
  });
}

function elementCard(stage, element, si, ei) {
  const isBlock = element.type === "block";
  const isHead = element.type === "head";
  const card = document.createElement("div");
  card.className = "element-card";
  card.innerHTML = `
    <div class="card-head">
      <canvas class="swatch" width="14" height="14"></canvas>
      <select data-f="type">
        <option value="item" ${!isBlock && !isHead ? "selected" : ""}>item</option>
        <option value="block" ${isBlock ? "selected" : ""}>block</option>
        <option value="head" ${isHead ? "selected" : ""}>head</option>
      </select>
      <span class="grow"></span>
      <button data-clone title="Clone element">⧉</button>
      <button class="danger" data-del>✕</button>
    </div>
    <div class="form-grid">
      ${isBlock
        ? `<label>block material / state (e.g. WHEAT[age=7]) <input type="text" data-f="block" value="${esc(element.block)}" spellcheck="false" data-keys="blockstates"></label>`
        : isHead
          ? `<label>head texture (skin URL or base64) <input type="text" data-f="texture" value="${esc(element.texture || "")}" spellcheck="false"></label>`
          : `<label>item model <input type="text" data-f="model" value="${esc(element.model)}" spellcheck="false" data-keys="item-models"></label>`}
      <label>translation x/y/z <span class="vec">${vecInputs("translation", element.translation, 0.05)}</span></label>
      <label>rotation °x/y/z <span class="vec">${vecInputs("rotation", element.rotation, 5)}</span></label>
      <label>scale x/y/z <span class="vec">${vecInputs("scale", element.scale, 0.05)}</span></label>
    </div>`;
  const paintSwatch = () => {
    const sw = card.querySelector(".swatch").getContext("2d");
    sw.imageSmoothingEnabled = false;
    sw.clearRect(0, 0, 14, 14);
    const tex = element.type === "block" ? MCAssets.blockSprite(element.block)
      : element.type === "head" ? MCAssets.headFace(element.texture)
      : MCAssets.item(element.model);
    if (tex) sw.drawImage(tex, 0, 0, 14, 14);
    else { sw.fillStyle = colorFor(element.type === "block" ? element.block : element.model); sw.fillRect(1, 1, 12, 12); }
  };
  paintSwatch();
  MCAssets.onReady(() => { if (card.isConnected) paintSwatch(); });
  card.addEventListener("input", (e) => {
    const f = e.target.dataset.f;
    const vec = e.target.dataset.vec;
    if (vec !== undefined) {
      element[e.target.dataset.vecname][+vec] = num(e.target.value, 0);
      setStage(si, true);
      changed(false);
      return;
    }
    if (!f) return;
    if (f === "type") { element.type = e.target.value; changed(true); setStage(si, true); return; }
    element[f] = e.target.value;
    paintSwatch();
    setStage(si, true);
    changed(false);
  });
  card.querySelector("[data-clone]").onclick = () => {
    stage.elements.splice(ei + 1, 0, JSON.parse(JSON.stringify(element)));
    changed(true);
  };
  card.querySelector("[data-del]").onclick = () => {
    stage.elements.splice(ei, 1);
    changed(true);
  };
  return card;
}

function vecInputs(name, values, step) {
  return values.map((v, i) =>
    `<input type="number" step="${step}" data-vec="${i}" data-vecname="${name}" value="${v}">`).join("");
}

function esc(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

function buildStageBar() {
  const bar = $("stage-bar");
  bar.innerHTML = "";
  state.crop.stages.forEach((_, i) => {
    const b = document.createElement("button");
    b.textContent = `stage ${i + 1}`;
    b.className = i === state.view.stage ? "active" : "";
    b.onclick = () => setStage(i);
    bar.appendChild(b);
  });
}

function setStage(i, keepProgress) {
  state.view.stage = clamp(i, 0, state.crop.stages.length - 1);
  if (!keepProgress) {
    state.view.progress = stageMidProgress(state.view.stage);
    $("progress-slider").value = Math.round(state.view.progress * 1000);
    $("progress-label").textContent = Math.round(state.view.progress * 100) + "%";
  }
  buildStageBar();
  document.querySelectorAll(".stage-card").forEach((c, idx) =>
    c.classList.toggle("active", idx === state.view.stage));
  draw();
  save();
}

// ── YAML generation (matches FarmingConfig parsing) ────────────────────────

function q(s) { return `"${String(s).replace(/"/g, '\\"')}"`; }

function fmtVec(v) {
  return `[${v.map(n => +(+n).toFixed(4)).join(", ")}]`;
}

function isVec(v, x) { return v.every(n => +n === x); }

function biomeList() {
  return (state.crop.biomes || []).map(b => String(b).trim().toLowerCase()).filter(Boolean);
}

function yamlFarming() {
  const c = state.crop;
  const L = [];
  L.push(`# Generated by tools/crop-designer`);
  L.push(`# Drop into plugins/C4/farming/`);
  L.push(`crops:`);
  L.push(`  ${c.id || "my_crop"}:`);
  L.push(`    display_name: ${q(c.name)}`);
  L.push(`    farmland: ${c.farmland || "minecraft"}`);
  if ((c.fertilizer || "").trim()) L.push(`    fertilizer: ${c.fertilizer.trim().toUpperCase()}`);
  L.push(`    seed:`);
  L.push(`      display_name: ${q(c.seedName)}`);
  L.push(`      item_model: ${c.seedModel}`);
  if ((c.seedConsumable || "").trim()) L.push(`      consumable: ${c.seedConsumable.trim()}`);
  if (c.grassChance > 0) L.push(`      grass_drop_chance: ${c.grassChance}`);
  L.push(`    growth:`);
  L.push(`      total_minutes: ${c.minutes}`);
  L.push(`      stages:`);
  for (const stage of c.stages) {
    const hb = stage.hitbox || defHitbox();
    L.push(`        - weight: ${stage.weight}`);
    L.push(`          hitbox:`);
    L.push(`            width: ${hb.width}`);
    L.push(`            height: ${hb.height}`);
    L.push(`            offset: ${hb.offset}`);
    // Per-stage event overrides, emitted only when the stage defines any.
    if (stage.events) {
      L.push(...EventsEditor.toYamlLines(stage.events, CROP_TRIGGERS, "          "));
    }
    L.push(`          elements:`);
    for (const e of stage.elements) {
      L.push(`            - type: ${e.type}`);
      if (e.type === "block") {
        // Plain materials keep the traditional UPPERCASE; block states with
        // properties (WHEAT[age=7]) emit lowercase, the vanilla state syntax.
        const b = e.block.trim();
        L.push(`              block: ${b.includes("[") ? b.toLowerCase() : b.toUpperCase()}`);
      }
      else if (e.type === "head") L.push(`              texture: ${q(e.texture || "")}`);
      else L.push(`              model: ${e.model}`);
      if (!isVec(e.translation, 0)) L.push(`              translation: ${fmtVec(e.translation)}`);
      if (!isVec(e.rotation, 0)) L.push(`              rotation: ${fmtVec(e.rotation)}`);
      if (!isVec(e.scale, 1)) L.push(`              scale: ${fmtVec(e.scale)}`);
    }
  }
  L.push(`    requirements:`);
  L.push(`      min_light: ${c.minLight}`);
  L.push(`      min_water: ${c.minWater}`);
  if (c.netherOnly) L.push(`      nether_only: true`);
  const biomes = biomeList();
  if (biomes.length) {
    L.push(`      biomes: [${biomes.join(", ")}]`);
    L.push(`      outside_biome_rate: ${c.outsideRate}`);
  }
  L.push(`    harvest:`);
  L.push(`      results:`);
  for (const h of c.harvests) {
    if (h.seed) L.push(`        - seed: true`);
    else L.push(`        - item: ${h.item.trim() || "UNSET"}`);
    L.push(`          min: ${h.min}`);
    L.push(`          max: ${h.max}`);
  }
  L.push(`      replant: ${c.replant}`);
  if (c.replant && num(c.harvestStage, 0) > 0) L.push(`      harvest_stage: ${num(c.harvestStage, 0)}`);
  if (c.randomRotation) L.push(`    random_rotation: true`);
  if (c.randomOffset === false) L.push(`    random_offset: false`); // on by default
  // mcMMO (only emitted when it differs from the defaults: xp 50, double drops on).
  const herbXp = num(c.herbalismXp, 50);
  if (herbXp !== 50 || c.mcmmoDoubleDrops === false) {
    L.push(`    mcmmo:`);
    if (herbXp !== 50) L.push(`      herbalism_xp: ${herbXp}`);
    if (c.mcmmoDoubleDrops === false) L.push(`      double_drops: false`);
  }
  // Crop-wide effects (omitted entirely when nothing is defined).
  L.push(...EventsEditor.toYamlLines(c.events, CROP_TRIGGERS, "    "));
  return L.join("\n") + "\n";
}

function renderYAML() {
  const base = prettify(state.crop.id || "my_crop").replace(/ /g, "");
  // Generated file first (tagged "new" - it's the created/updated config),
  // then raw copies of every file uploaded/created across all tool pages.
  FileDock.render($("file-dock"), [
    { name: `farming/${base}.yml`, text: yamlFarming(), badge: "new", open: true },
    ...FileStore.all(),
  ]);
}

// ── top-level events ───────────────────────────────────────────────────────

function bindStaticEvents() {
  // crop form
  const bindField = (id, apply, structural) => {
    $(id).addEventListener("input", (e) => { apply(e.target); changed(!!structural); });
  };
  bindField("crop-id", t => {
    state.crop.id = t.value.trim();
    // "consumable is seed" tracks the crop id
    if ((state.crop.seedConsumable || "").trim()) state.crop.seedConsumable = state.crop.id;
  });
  bindField("crop-name", t => state.crop.name = t.value);
  bindField("crop-farmland", t => state.crop.farmland = t.value.trim());
  bindField("seed-name", t => { state.crop.seedName = t.value; syncSeedNamePreview(); });
  bindField("seed-model", t => { state.crop.seedModel = t.value.trim(); paintChips(); });
  $("seed-isconsumable").addEventListener("input", e => {
    state.crop.seedConsumable = e.target.checked ? (state.crop.id || "my_crop") : "";
    changed(false);
  });
  bindField("crop-grasschance", t => {
    // A relative weight in the biome's grass-seed pool, so no upper bound -
    // grass_seeds.drop_chance is what caps how often grass yields anything.
    state.crop.grassChance = Math.max(0, num(t.value, 0));
    syncGrassChanceWarning();
  });
  /* biomes handled by buildBiomePicker() */
  bindField("crop-outsiderate", t => state.crop.outsideRate = clamp(num(t.value, 0.5), 0, 1));
  bindField("crop-minutes", t => state.crop.minutes = num(t.value, 20));
  bindField("crop-light", t => state.crop.minLight = clamp(num(t.value, 9), 0, 15));
  bindField("crop-water", t => state.crop.minWater = clamp(num(t.value, 0.3), 0, 1));
  $("crop-replant").addEventListener("input", e => { state.crop.replant = e.target.checked; changed(false); });
  $("crop-harveststage").addEventListener("input", e => { state.crop.harvestStage = Math.max(0, num(e.target.value, 0)); changed(false); });
  $("crop-netheronly").addEventListener("input", e => { state.crop.netherOnly = e.target.checked; paintChips(); changed(false); });
  bindField("crop-fertilizer", t => { state.crop.fertilizer = t.value.trim(); paintChips(); });
  $("crop-randomrot").addEventListener("input", e => { state.crop.randomRotation = e.target.checked; changed(false); });
  $("crop-randomoffset").addEventListener("input", e => { state.crop.randomOffset = e.target.checked; changed(false); });
  bindField("crop-herbxp", t => state.crop.herbalismXp = Math.max(0, num(t.value, 50)));
  $("crop-doubledrops").addEventListener("input", e => { state.crop.mcmmoDoubleDrops = e.target.checked; changed(false); });

  $("btn-add-harvest").onclick = () => {
    state.crop.harvests.push({ seed: false, item: "", min: 1, max: 1 });
    changed(true);
  };
  $("btn-add-stage").onclick = () => {
    state.crop.stages.push({ weight: 1, hitbox: defHitbox(), elements: [
      el("item", "minecraft:short_grass", "CACTUS", [0, 0.25, 0], [0, 45, 0], [1, 1, 1]),
      el("item", "minecraft:short_grass", "CACTUS", [0, 0.25, 0], [0, -45, 0], [1, 1, 1]),
    ]});
    state.view.stage = state.crop.stages.length - 1;
    changed(true);
  };
  $("btn-clear").onclick = () => {
    if (!confirm("Clear the crop draft and uploaded files?")) return;
    state = defaultState();
    FileStore.clear();
    changed(true);
    setStage(state.view.stage);
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

  // progress / grow animation
  const slider = $("progress-slider");
  slider.addEventListener("input", () => {
    state.view.progress = slider.value / 1000;
    $("progress-label").textContent = Math.round(state.view.progress * 100) + "%";
    const s = stageFor(state.view.progress);
    if (s !== state.view.stage) { state.view.stage = s; buildStageBar(); draw(); }
  });
  let growTimer = null;
  $("btn-grow").onclick = () => {
    if (growTimer) { clearInterval(growTimer); growTimer = null; $("btn-grow").textContent = "▶ grow"; return; }
    state.view.progress = 0;
    $("btn-grow").textContent = "■ stop";
    growTimer = setInterval(() => {
      state.view.progress = Math.min(1, state.view.progress + 0.006);
      slider.value = Math.round(state.view.progress * 1000);
      $("progress-label").textContent = Math.round(state.view.progress * 100) + "%";
      const s = stageFor(state.view.progress);
      if (s !== state.view.stage) { state.view.stage = s; buildStageBar(); }
      draw();
      if (state.view.progress >= 1) { clearInterval(growTimer); growTimer = null; $("btn-grow").textContent = "▶ grow"; }
    }, 30);
  };

  $("show-hitbox").addEventListener("change", () => draw());

  // orbit + zoom
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
    state.view.zoom = clamp(state.view.zoom * (e.deltaY > 0 ? 0.9 : 1.1), 60, 700);
    draw(); save();
  }, { passive: false });

}

// ── boot ───────────────────────────────────────────────────────────────────

bindStaticEvents();
buildPanels();
renderYAML();
setStage(state.view.stage);
