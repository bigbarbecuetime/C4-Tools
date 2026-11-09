/* Crop preview renderer.
 *
 * The crop editor has one rendering path: WebGL 2. Scene quads, the grid,
 * particles, and transform gizmos all enter this pipeline. The 5x5 field is
 * uploaded once per frame and issued in texture batches; the depth buffer
 * replaces the old CPU-side BSP rebuild.
 */
"use strict";

(() => {
  const canvas = document.getElementById("preview");
  let gl = null;
  let program = null;
  let buffer = null;
  let vao = null;
  let whiteTexture = null;
  let textureCache = new WeakMap();
  let uploadedThisFrame = new WeakSet();
  let overlayBatches = [];
  let frameStarted = 0;
  let frameDrawCalls = 0;
  let frameFaces = 0;
  let frameVertices = 0;
  let lastStats = {
    webgl: false, frameMs: 0, drawCalls: 0, faces: 0, vertices: 0,
  };

  const VERTEX_SOURCE = `#version 300 es
    in vec3 a_position;
    in vec2 a_uv;
    in vec4 a_color;
    out vec2 v_uv;
    out vec4 v_color;
    void main() {
      gl_Position = vec4(a_position, 1.0);
      v_uv = a_uv;
      v_color = a_color;
    }`;

  const FRAGMENT_SOURCE = `#version 300 es
    precision mediump float;
    uniform sampler2D u_texture;
    in vec2 v_uv;
    in vec4 v_color;
    out vec4 outColor;
    void main() {
      vec4 sampled = texture(u_texture, v_uv);
      if (sampled.a < 0.05) discard;
      outColor = sampled * v_color;
    }`;

  function compile(type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      gl.deleteShader(shader);
      return null;
    }
    return shader;
  }

  function initialize() {
    gl = canvas && canvas.getContext("webgl2", {
      alpha: true,
      antialias: false,
      depth: true,
      premultipliedAlpha: false,
      preserveDrawingBuffer: false,
    });
    if (!gl) {
      lastStats = { ...lastStats, webgl: false, error: "WebGL 2 is unavailable" };
      canvas?.setAttribute("aria-label", "Crop preview unavailable: WebGL 2 is required");
      return false;
    }

    const vertex = compile(gl.VERTEX_SHADER, VERTEX_SOURCE);
    const fragment = compile(gl.FRAGMENT_SHADER, FRAGMENT_SOURCE);
    if (!vertex || !fragment) return false;
    program = gl.createProgram();
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return false;

    buffer = gl.createBuffer();
    vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    const stride = 9 * Float32Array.BYTES_PER_ELEMENT;
    const position = gl.getAttribLocation(program, "a_position");
    const uv = gl.getAttribLocation(program, "a_uv");
    const color = gl.getAttribLocation(program, "a_color");
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 3, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(uv);
    gl.vertexAttribPointer(uv, 2, gl.FLOAT, false, stride, 3 * Float32Array.BYTES_PER_ELEMENT);
    gl.enableVertexAttribArray(color);
    gl.vertexAttribPointer(color, 4, gl.FLOAT, false, stride, 5 * Float32Array.BYTES_PER_ELEMENT);

    whiteTexture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, whiteTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE,
      new Uint8Array([255, 255, 255, 255]));
    setTextureParameters();
    textureCache = new WeakMap();
    gl.useProgram(program);
    gl.uniform1i(gl.getUniformLocation(program, "u_texture"), 0);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.disable(gl.CULL_FACE);
    gl.clearColor(0, 0, 0, 0);
    canvas.dataset.renderer = "webgl2";
    return true;
  }

  function setTextureParameters() {
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  function sourceSize(source) {
    return [source?.naturalWidth || source?.videoWidth || source?.width || 0,
      source?.naturalHeight || source?.videoHeight || source?.height || 0];
  }

  /** Upload each live DOM texture at most once per frame. Animated Minecraft
   * canvases keep the same identity, so refreshing them here preserves motion. */
  function textureFor(source) {
    if (!source || typeof source !== "object") return null;
    const [width, height] = sourceSize(source);
    if (!width || !height) return null;
    let record = textureCache.get(source);
    if (!record) {
      record = { texture: gl.createTexture(), failed: false };
      textureCache.set(source, record);
    }
    if (record.failed) return null;
    if (!uploadedThisFrame.has(source)) {
      gl.bindTexture(gl.TEXTURE_2D, record.texture);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      try {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
        setTextureParameters();
        uploadedThisFrame.add(source);
      } catch (error) {
        // Cross-origin head skins cannot legally become GPU textures. They stay
        // in this WebGL path as their material-color cube, never a Canvas scene.
        record.failed = true;
        gl.deleteTexture(record.texture);
        return null;
      }
    }
    return record.texture;
  }

  function color(value) {
    const text = String(value || "#a0a0a0").trim().toLowerCase();
    if (text[0] === "#") {
      const hex = text.slice(1);
      const full = hex.length <= 4 ? [...hex].map(ch => ch + ch).join("") : hex;
      const alpha = full.length >= 8 ? parseInt(full.slice(6, 8), 16) / 255 : 1;
      return [parseInt(full.slice(0, 2), 16) / 255, parseInt(full.slice(2, 4), 16) / 255,
        parseInt(full.slice(4, 6), 16) / 255, alpha];
    }
    const rgb = text.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)$/);
    if (rgb) return [+rgb[1] / 255, +rgb[2] / 255, +rgb[3] / 255, rgb[4] == null ? 1 : +rgb[4]];
    const hsl = text.match(/^hsla?\(\s*([\d.]+)\s*,\s*([\d.]+)%\s*,\s*([\d.]+)%(?:\s*,\s*([\d.]+))?\s*\)$/);
    if (hsl) {
      const h = (+hsl[1] % 360) / 360, s = +hsl[2] / 100, l = +hsl[3] / 100;
      const channel = n => {
        const k = (n + h * 12) % 12;
        return l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1));
      };
      return [channel(0), channel(8), channel(4), hsl[4] == null ? 1 : +hsl[4]];
    }
    const names = { white: [1, 1, 1, 1], black: [0, 0, 0, 1] };
    return names[text] || [0.63, 0.63, 0.63, 1];
  }

  function clipPoint(point, depth) {
    return [point.x / canvas.width * 2 - 1, 1 - point.y / canvas.height * 2,
      Math.max(-0.98, Math.min(0.98, depth || 0))];
  }

  function pushVertex(data, position, uv, rgba) {
    data.push(position[0], position[1], position[2], uv[0], uv[1],
      rgba[0], rgba[1], rgba[2], rgba[3]);
  }

  function pushQuad(data, positions, uvs, rgba) {
    const order = [0, 1, 2, 0, 2, 3];
    for (const index of order) pushVertex(data, positions[index], uvs[index], rgba);
  }

  function drawBuffer(data, batches, depthTest, depthWrite) {
    if (!data.length) return;
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    const vertexData = data instanceof Float32Array ? data : new Float32Array(data);
    gl.bufferData(gl.ARRAY_BUFFER, vertexData, gl.DYNAMIC_DRAW);
    gl.useProgram(program);
    if (depthTest) gl.enable(gl.DEPTH_TEST); else gl.disable(gl.DEPTH_TEST);
    gl.depthMask(depthWrite);
    for (const batch of batches) {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, batch.texture);
      gl.drawArrays(gl.TRIANGLES, batch.first, batch.count);
      frameDrawCalls++;
    }
    frameVertices += data.length / 9;
  }

  function begin() {
    if (!gl || !program) return false;
    frameStarted = performance.now();
    frameDrawCalls = 0;
    frameFaces = 0;
    frameVertices = 0;
    uploadedThisFrame = new WeakSet();
    overlayBatches = [];
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.depthMask(true);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    return true;
  }

  /** Submit every crop/soil quad through one GPU path. Opaque/cutout geometry
   * is grouped by texture; the small translucent set is depth-sorted. */
  function faces(sceneFaces, project, toView, light, dot) {
    if (!gl || !sceneFaces.length) return;
    const batchesByTexture = new Map();
    const transparent = [];
    let visibleFaces = 0;

    const make = face => {
      if (face.cull && toView(face.normal)[2] < 0) return null;
      const projected = face.pts.map(project);
      const positions = projected.map(point => clipPoint(point,
        -Math.max(-12, Math.min(12, point.z)) / 12));
      const u0 = face.texU ? face.texU[0] : 0, u1 = face.texU ? face.texU[1] : 1;
      const v0 = face.texV ? face.texV[0] : 0, v1 = face.texV ? face.texV[1] : 1;
      const uvs = [[u0, 1 - v0], [u1, 1 - v0], [u1, 1 - v1], [u0, 1 - v1]];
      const uploaded = face.tex ? textureFor(face.tex) : null;
      const texture = uploaded || whiteTexture;
      const base = uploaded ? [1, 1, 1, 1] : color(face.color);
      const brightness = face.flat ? 1 : 0.55 + 0.45 * Math.max(0, dot(face.normal, light));
      const rgba = [base[0] * brightness, base[1] * brightness, base[2] * brightness,
        base[3] * (face.alpha == null ? 1 : face.alpha)];
      const depth = projected.reduce((sum, point) => sum + point.z, 0) / projected.length;
      visibleFaces++;
      return { positions, uvs, rgba, texture, depth };
    };

    for (const face of sceneFaces) {
      const item = make(face);
      if (!item) continue;
      if (item.rgba[3] < 0.999) {
        transparent.push(item);
        continue;
      }
      let batch = batchesByTexture.get(item.texture);
      if (!batch) {
        batch = { texture: item.texture, data: [] };
        batchesByTexture.set(item.texture, batch);
      }
      pushQuad(batch.data, item.positions, item.uvs, item.rgba);
    }

    const opaqueSize = [...batchesByTexture.values()]
      .reduce((total, batch) => total + batch.data.length, 0);
    const opaqueData = new Float32Array(opaqueSize), opaqueBatches = [];
    let opaqueOffset = 0;
    for (const batch of batchesByTexture.values()) {
      const first = opaqueOffset / 9;
      opaqueData.set(batch.data, opaqueOffset);
      opaqueOffset += batch.data.length;
      opaqueBatches.push({ texture: batch.texture, first, count: batch.data.length / 9 });
    }
    drawBuffer(opaqueData, opaqueBatches, true, true);

    transparent.sort((a, b) => a.depth - b.depth);
    if (transparent.length) {
      const data = [], batches = [];
      for (const item of transparent) {
        const first = data.length / 9;
        pushQuad(data, item.positions, item.uvs, item.rgba);
        const previous = batches[batches.length - 1];
        if (previous && previous.texture === item.texture) previous.count += 6;
        else batches.push({ texture: item.texture, first, count: 6 });
      }
      drawBuffer(data, batches, true, false);
      gl.depthMask(true);
    }
    frameFaces += visibleFaces;
  }

  function overlayBatch(texture) {
    let batch = overlayBatches[overlayBatches.length - 1];
    if (!batch || batch.texture !== texture) {
      batch = { texture, data: [] };
      overlayBatches.push(batch);
    }
    return batch.data;
  }

  function screenPoint(x, y) { return clipPoint({ x, y }, 0); }

  function rect(x, y, width, height, fill, angle = 0, alpha = 1) {
    const cx = x + width / 2, cy = y + height / 2;
    const c = Math.cos(angle), s = Math.sin(angle);
    const points = [[-width / 2, -height / 2], [width / 2, -height / 2],
      [width / 2, height / 2], [-width / 2, height / 2]].map(([px, py]) =>
      screenPoint(cx + px * c - py * s, cy + px * s + py * c));
    const rgba = color(fill); rgba[3] *= alpha;
    pushQuad(overlayBatch(whiteTexture), points, [[0, 0], [1, 0], [1, 1], [0, 1]], rgba);
  }

  function polygon(points, fill, alpha = 1) {
    if (points.length < 3) return;
    const rgba = color(fill); rgba[3] *= alpha;
    const data = overlayBatch(whiteTexture);
    const p0 = screenPoint(points[0][0], points[0][1]);
    for (let i = 1; i < points.length - 1; i++) {
      pushVertex(data, p0, [0, 0], rgba);
      pushVertex(data, screenPoint(points[i][0], points[i][1]), [0, 0], rgba);
      pushVertex(data, screenPoint(points[i + 1][0], points[i + 1][1]), [0, 0], rgba);
    }
  }

  function line(x1, y1, x2, y2, stroke, width = 1, alpha = 1) {
    const dx = x2 - x1, dy = y2 - y1;
    const length = Math.hypot(dx, dy);
    if (!length) return;
    const nx = -dy / length * width / 2, ny = dx / length * width / 2;
    polygon([[x1 + nx, y1 + ny], [x2 + nx, y2 + ny],
      [x2 - nx, y2 - ny], [x1 - nx, y1 - ny]], stroke, alpha);
  }

  function circle(x, y, radius, fill, options = {}) {
    const start = options.start == null ? 0 : options.start;
    const end = options.end == null ? Math.PI * 2 : options.end;
    const segments = Math.max(8, Math.ceil(Math.abs(end - start) * radius / 4));
    if (options.stroke) {
      const every = options.dash ? 2 : 1;
      for (let i = 0; i < segments; i += every) {
        const a = start + (end - start) * i / segments;
        const b = start + (end - start) * Math.min(i + 1, segments) / segments;
        line(x + Math.cos(a) * radius, y + Math.sin(a) * radius,
          x + Math.cos(b) * radius, y + Math.sin(b) * radius,
          fill, options.width || 1, options.alpha == null ? 1 : options.alpha);
      }
      return;
    }
    const points = [];
    for (let i = 0; i < segments; i++) {
      const a = start + (end - start) * i / Math.max(1, segments - 1);
      points.push([x + Math.cos(a) * radius, y + Math.sin(a) * radius]);
    }
    polygon([[x, y], ...points], fill, options.alpha == null ? 1 : options.alpha);
  }

  function image(source, sx, sy, sw, sh, dx, dy, dw, dh, alpha = 1) {
    const texture = textureFor(source);
    if (!texture) return;
    const [width, height] = sourceSize(source);
    const u0 = sx / width, u1 = (sx + sw) / width;
    const v0 = sy / height, v1 = (sy + sh) / height;
    const positions = [screenPoint(dx, dy), screenPoint(dx + dw, dy),
      screenPoint(dx + dw, dy + dh), screenPoint(dx, dy + dh)];
    pushQuad(overlayBatch(texture), positions,
      [[u0, 1 - v0], [u1, 1 - v0], [u1, 1 - v1], [u0, 1 - v1]], [1, 1, 1, alpha]);
  }

  const textSources = new Map();
  function textLabel(value, options) {
    const font = options.font || "600 11px system-ui, sans-serif";
    const fill = options.fill || "#fff";
    const stroke = options.stroke || "";
    const strokeWidth = options.strokeWidth || 0;
    const key = [value, font, fill, stroke, strokeWidth].join("\u0000");
    if (textSources.has(key)) return textSources.get(key);
    const measure = document.createElement("canvas").getContext("2d");
    measure.font = font;
    const metrics = measure.measureText(value);
    const width = Math.ceil(metrics.width + strokeWidth * 2 + 4);
    const size = Math.ceil((metrics.actualBoundingBoxAscent || 10) +
      (metrics.actualBoundingBoxDescent || 3) + strokeWidth * 2 + 4);
    const source = document.createElement("canvas");
    source.width = width; source.height = size;
    const ctx = source.getContext("2d");
    ctx.font = font;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    if (stroke) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = strokeWidth;
      ctx.strokeText(value, width / 2, size / 2);
    }
    ctx.fillStyle = fill;
    ctx.fillText(value, width / 2, size / 2);
    const label = { source, width, height: size };
    textSources.set(key, label);
    return label;
  }

  function text(value, x, y, options = {}) {
    const label = textLabel(String(value), options);
    let dx = x - label.width / 2;
    if (options.align === "left") dx = x;
    else if (options.align === "right") dx = x - label.width;
    image(label.source, 0, 0, label.width, label.height,
      dx, y - label.height / 2, label.width, label.height,
      options.alpha == null ? 1 : options.alpha);
  }

  function flushOverlay() {
    if (!overlayBatches.length) return;
    const size = overlayBatches.reduce((total, batch) => total + batch.data.length, 0);
    const data = new Float32Array(size), batches = [];
    let offset = 0;
    for (const batch of overlayBatches) {
      const first = offset / 9;
      data.set(batch.data, offset);
      offset += batch.data.length;
      batches.push({ texture: batch.texture, first, count: batch.data.length / 9 });
    }
    overlayBatches = [];
    drawBuffer(data, batches, false, false);
    gl.depthMask(true);
  }

  function end() {
    if (!gl || !program) return;
    flushOverlay();
    lastStats = {
      webgl: true,
      frameMs: performance.now() - frameStarted,
      drawCalls: frameDrawCalls,
      faces: frameFaces,
      vertices: frameVertices,
    };
    canvas.dataset.frameMs = lastStats.frameMs.toFixed(3);
    canvas.dataset.drawCalls = String(lastStats.drawCalls);
    canvas.dataset.faces = String(lastStats.faces);
    canvas.dataset.vertices = String(lastStats.vertices);
  }

  function stats() { return { ...lastStats }; }

  if (canvas) {
    initialize();
    canvas.addEventListener("webglcontextlost", event => {
      event.preventDefault();
      program = null;
      lastStats = { ...lastStats, webgl: false, error: "WebGL context lost" };
    });
    canvas.addEventListener("webglcontextrestored", () => {
      initialize();
      window.dispatchEvent(new Event("crop-preview-webgl-restored"));
    });
  }

  globalThis.CropPreviewGL = {
    begin, faces, line, rect, circle, polygon, image, text, flushOverlay, end, stats,
    available: () => !!(gl && program),
  };
})();
