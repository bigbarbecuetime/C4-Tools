import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const here = dirname(fileURLToPath(import.meta.url));
const read = (name) => {
  const path = join(here, name);
  return existsSync(path) ? readFileSync(path, "utf8") : "";
};

test("crop preview has one WebGL rendering pipeline", () => {
  const renderer = read("preview-gl.js");
  const app = read("app.js");
  const html = read("index.html");

  assert.match(renderer, /getContext\("webgl2"/);
  assert.match(renderer, /globalThis\.CropPreviewGL/);
  assert.match(html, /src="preview-gl\.js\?v=3"/);
  assert.doesNotMatch(app, /const ctx = canvas\.getContext/);
  assert.doesNotMatch(app, /function bspBuild|function bspPaint|function paintFace/);
});

test("WebGL renderer batches faces by texture and uses the depth buffer", () => {
  const renderer = read("preview-gl.js");

  assert.match(renderer, /gl\.enable\(gl\.DEPTH_TEST\)/);
  assert.match(renderer, /gl\.bufferData\(gl\.ARRAY_BUFFER/);
  assert.match(renderer, /batchesByTexture/);
  assert.match(renderer, /opaqueData = new Float32Array\(opaqueSize\)/);
  assert.match(renderer, /opaqueData\.set\(batch\.data, opaqueOffset\)/);
  assert.doesNotMatch(renderer, /opaqueData\.push\(\.\.\.batch\.data\)/);
  assert.match(renderer, /gl\.drawArrays\(gl\.TRIANGLES/);
  assert.match(renderer, /discard/);
});

test("field and single-plot scenes submit through the same renderer", () => {
  const app = read("app.js");

  assert.match(app, /previewGL\.faces\(faces, project, toView, LIGHT, dot\)/);
  assert.match(app, /spriteQuads\(element, !field\)/);
  assert.match(app, /if \(!includeEdgeExtrusion\) return quads/);
  assert.doesNotMatch(app, /fieldGroups|BSP_EPS|splitPoly/);
  assert.match(app, /previewGL\.begin\(\)/);
  assert.match(app, /previewGL\.end\(\)/);
});

test("grid, particles, and gizmos stay on the WebGL pipeline", () => {
  const app = read("app.js");
  const gizmo = read("gizmo.js");

  assert.match(app, /previewGL\.(line|rect|circle|polygon|image)\(/);
  assert.match(gizmo, /previewGL\.(line|rect|circle|text)\(/);
  assert.doesNotMatch(gizmo, /\bctx\./);
});

test("renderer publishes field performance counters", () => {
  const renderer = read("preview-gl.js");

  assert.match(renderer, /frameMs/);
  assert.match(renderer, /drawCalls/);
  assert.match(renderer, /faces/);
  assert.match(renderer, /vertices/);
  assert.match(renderer, /canvas\.dataset\.frameMs/);
  assert.match(renderer, /stats\(\)/);
});
