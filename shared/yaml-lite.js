/* yaml-lite.js - tiny YAML reader for the designer tools.
 *
 * Just enough to round-trip the block-style YAML these tools emit (and that the
 * plugin reads): nested maps by indentation, block sequences (including lists of
 * maps), inline flow sequences [a, b], quoted/plain scalars, comments and blank
 * lines. NOT a general YAML implementation - no anchors, multi-line scalars,
 * flow maps, etc. Exposes window.YAMLLite.parse(text) → JS value.
 */
(function (global) {
  "use strict";

  function parse(text) {
    const tokens = [];
    let pending = null; // a logical line still accumulating unbalanced [ ] / { }
    for (const rawLine of String(text).split(/\r?\n/)) {
      const line = stripComment(rawLine);
      if (!line.trim()) { if (!pending) continue; }
      if (pending) {
        // continuation of a multi-line flow collection - fold it onto one line
        pending.content += " " + line.trim();
      } else {
        const indent = line.length - line.replace(/^ +/, "").length;
        pending = { indent, content: line.trim() };
      }
      if (flowDepth(pending.content) <= 0) { tokens.push(pending); pending = null; }
    }
    if (pending) tokens.push(pending); // unterminated, but keep what we have
    if (!tokens.length) return null;
    const ctx = { tokens, i: 0 };
    return parseNode(ctx, tokens[0].indent);
  }

  /** Net open depth of [ ] and { } in a string, ignoring quoted regions. */
  function flowDepth(s) {
    let depth = 0, inQuote = false;
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (c === '"') inQuote = !inQuote;
      else if (!inQuote && (c === "[" || c === "{")) depth++;
      else if (!inQuote && (c === "]" || c === "}")) depth--;
    }
    return depth;
  }

  function parseNode(ctx, indent) {
    const tok = ctx.tokens[ctx.i];
    if (!tok) return null;
    if (tok.content[0] === "-") return parseSeq(ctx, indent);
    return parseMap(ctx, indent);
  }

  function parseSeq(ctx, indent) {
    const arr = [];
    while (ctx.i < ctx.tokens.length) {
      const tok = ctx.tokens[ctx.i];
      if (tok.indent !== indent || tok.content[0] !== "-") break;
      const after = tok.content.slice(1).trim(); // strip the dash
      if (after === "") {
        // nested block lives on the following deeper lines
        ctx.i++;
        const next = ctx.tokens[ctx.i];
        arr.push(next && next.indent > indent ? parseNode(ctx, next.indent) : null);
      } else if (isMapEntry(after)) {
        // "- key: value" - rewrite as a map line starting after "- "
        ctx.tokens[ctx.i] = { indent: indent + 2, content: after };
        arr.push(parseMap(ctx, indent + 2));
      } else {
        arr.push(parseScalar(after));
        ctx.i++;
      }
    }
    return arr;
  }

  function parseMap(ctx, indent) {
    const map = {};
    while (ctx.i < ctx.tokens.length) {
      const tok = ctx.tokens[ctx.i];
      if (tok.indent !== indent || tok.content[0] === "-") break;
      const { key, val } = splitKeyVal(tok.content);
      if (val === "") {
        ctx.i++;
        const next = ctx.tokens[ctx.i];
        if (next && next.indent > indent) {
          map[key] = parseNode(ctx, next.indent);
        } else if (next && next.indent === indent && next.content[0] === "-") {
          map[key] = parseSeq(ctx, indent); // block seq not extra-indented
        } else {
          map[key] = null;
        }
      } else {
        map[key] = parseScalar(val);
        ctx.i++;
      }
    }
    return map;
  }

  // ── line helpers ───────────────────────────────────────────────────────────

  /** Strip a trailing/whole-line comment, ignoring '#' inside quotes. */
  function stripComment(line) {
    let inQuote = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') inQuote = !inQuote;
      else if (c === "#" && !inQuote && (i === 0 || line[i - 1] === " ")) {
        return line.slice(0, i);
      }
    }
    return line;
  }

  /** Index of the first ':' that acts as a key/value separator (followed by a
   * space or end of line) - so "minecraft:desert: 0" splits at the second one. */
  function keyColon(s) {
    let inQuote = false;
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (c === '"') inQuote = !inQuote;
      else if (c === ":" && !inQuote && (i + 1 >= s.length || s[i + 1] === " ")) return i;
    }
    return -1;
  }

  function isMapEntry(s) { return keyColon(s) !== -1; }

  function splitKeyVal(s) {
    const idx = keyColon(s);
    if (idx === -1) return { key: unquote(s.trim()), val: "" };
    return { key: unquote(s.slice(0, idx).trim()), val: s.slice(idx + 1).trim() };
  }

  // ── scalars ──────────────────────────────────────────────────────────────

  function parseScalar(s) {
    s = s.trim();
    if (s === "" || s === "~" || s === "null") return null;
    if (s[0] === "[" && s[s.length - 1] === "]") {
      const inner = s.slice(1, -1).trim();
      if (inner === "") return [];
      return splitFlow(inner).map(parseScalar);
    }
    if (s[0] === "{" && s[s.length - 1] === "}") {
      // inline flow map: { key: value, key2: [a, b] }
      const inner = s.slice(1, -1).trim();
      const map = {};
      if (inner === "") return map;
      for (const part of splitFlow(inner)) {
        const idx = keyColon(part);
        if (idx === -1) continue;
        map[unquote(part.slice(0, idx).trim())] = parseScalar(part.slice(idx + 1).trim());
      }
      return map;
    }
    if (s[0] === '"') return unquote(s);
    if (s === "true") return true;
    if (s === "false") return false;
    if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
    return s;
  }

  /** Split a flow-sequence body on commas not inside quotes or nested brackets. */
  function splitFlow(s) {
    const out = [];
    let depth = 0, inQuote = false, start = 0;
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (c === '"') inQuote = !inQuote;
      else if (!inQuote && (c === "[" || c === "{")) depth++;
      else if (!inQuote && (c === "]" || c === "}")) depth--;
      else if (c === "," && !inQuote && depth === 0) {
        out.push(s.slice(start, i));
        start = i + 1;
      }
    }
    out.push(s.slice(start));
    return out.map(x => x.trim()).filter(x => x.length);
  }

  function unquote(s) {
    s = s.trim();
    if (s.length >= 2 && s[0] === '"' && s[s.length - 1] === '"') {
      return s.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\");
    }
    return s;
  }

  // ── dump (JS value → block YAML) ───────────────────────────────────────────

  /**
   * Serialize a JS value to block-style YAML the plugin reads. Supports the
   * same subset parse() does: nested maps, sequences (scalars and maps),
   * scalars. Objects/arrays nest by indentation; empty maps/arrays emit `{}`
   * / `[]`. Not a general YAML emitter, but a faithful inverse of parse() for
   * the config shapes these tools produce.
   */
  function dump(value) {
    const lines = [];
    dumpNode(value, 0, lines);
    return lines.join("\n") + "\n";
  }

  function dumpNode(value, indent, lines) {
    const pad = "  ".repeat(indent);
    if (Array.isArray(value)) {
      if (!value.length) { lines.push(pad + "[]"); return; }
      for (const item of value) {
        if (isMap(item) && Object.keys(item).length) {
          // "- key: ..." with the rest of the map indented under it
          const sub = [];
          dumpNode(item, indent + 1, sub);
          sub[0] = pad + "- " + sub[0].slice((indent + 1) * 2);
          lines.push(...sub);
        } else if (Array.isArray(item) && item.length) {
          const sub = [];
          dumpNode(item, indent + 1, sub);
          sub[0] = pad + "- " + sub[0].slice((indent + 1) * 2);
          lines.push(...sub);
        } else {
          lines.push(pad + "- " + scalar(item));
        }
      }
      return;
    }
    if (isMap(value)) {
      const keys = Object.keys(value);
      if (!keys.length) { lines.push(pad + "{}"); return; }
      for (const key of keys) {
        const v = value[key];
        const k = mapKey(key);
        if (isMap(v) && Object.keys(v).length) {
          lines.push(pad + k + ":");
          dumpNode(v, indent + 1, lines);
        } else if (Array.isArray(v) && v.length && v.some(e => isMap(e) || Array.isArray(e))) {
          lines.push(pad + k + ":");
          dumpNode(v, indent, lines); // block seq at the same indent as the key
        } else {
          lines.push(pad + k + ": " + scalar(v));
        }
      }
      return;
    }
    lines.push(pad + scalar(value));
  }

  function isMap(v) { return v && typeof v === "object" && !Array.isArray(v); }

  function mapKey(key) {
    return /^[A-Za-z0-9_.\-]+$/.test(key) ? key : '"' + String(key).replace(/"/g, '\\"') + '"';
  }

  /** Inline scalar (also used for short flow arrays of scalars). */
  function scalar(v) {
    if (v == null) return "";
    if (typeof v === "boolean" || typeof v === "number") return String(v);
    if (Array.isArray(v)) return "[" + v.map(scalar).join(", ") + "]";
    if (isMap(v)) {
      const keys = Object.keys(v);
      if (!keys.length) return "{}";
      return "{ " + keys.map(k => mapKey(k) + ": " + scalar(v[k])).join(", ") + " }";
    }
    const s = String(v);
    // Quote when the plain form would be misread (looks numeric/bool, has
    // special leading chars, a colon-space, or surrounding whitespace).
    if (s === "" || /^[\s]|[\s]$/.test(s) || /^(true|false|null|~)$/i.test(s)
        || /^-?\d/.test(s) || /:\s|^[\[\]{}#&*!|>'"%@`-]/.test(s) || s.includes(": ")) {
      return '"' + s.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
    }
    return s;
  }

  global.YAMLLite = { parse, dump };
})(typeof window !== "undefined" ? window : this);
