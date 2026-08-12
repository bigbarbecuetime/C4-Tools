/* Shared '&'-color/format code parser for the designer previews - Java
 * Edition's classic set only (0-9a-f colors, k/l/m/n/o/r formats), matching
 * net.kyori.adventure.text.serializer.legacy.LegacyComponentSerializer
 * .legacyAmpersand() on the plugin side, so a name/description previewed
 * here looks like what actually renders in-game. Bedrock-only codes (g-w)
 * are intentionally not supported - this plugin is Java Edition only.
 * Reference: https://minecraft.wiki/w/Formatting_codes
 */
"use strict";

const LegacyText = (() => {
  const COLORS = {
    "0": "#000000", "1": "#0000AA", "2": "#00AA00", "3": "#00AAAA",
    "4": "#AA0000", "5": "#AA00AA", "6": "#FFAA00", "7": "#AAAAAA",
    "8": "#555555", "9": "#5555FF", a: "#55FF55", b: "#55FFFF",
    c: "#FF5555", d: "#FF55FF", e: "#FFFF55", f: "#FFFFFF",
  };

  /**
   * Parses '&'-coded text into runs: [{ text, color, bold, italic,
   * underline, strikethrough, obfuscated }]. `color` is a hex string or
   * null (inherit the caller's default); `italic`/`bold`/`underline`/
   * `strikethrough`/`obfuscated` are booleans, but only ever explicitly
   * true - there's no legacy code for "force off", so false always means
   * "inherit the caller's default" too. A color code or &r resets every
   * flag, exactly like vanilla legacy parsing (only the format codes
   * k/l/m/n/o are additive). An unrecognized code after '&' is left as
   * literal text, matching Adventure's own parser.
   */
  function parse(text) {
    const runs = [];
    let color = null, bold = false, underline = false, strikethrough = false, obfuscated = false, italic = false;
    let buf = "";
    const flush = () => {
      if (buf) runs.push({ text: buf, color, bold, italic, underline, strikethrough, obfuscated });
      buf = "";
    };
    const reset = () => { color = null; bold = underline = strikethrough = obfuscated = italic = false; };
    const s = String(text || "");
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (ch === "&" && i + 1 < s.length) {
        const code = s[i + 1].toLowerCase();
        if (COLORS[code]) { flush(); reset(); color = COLORS[code]; i++; continue; }
        if (code === "r") { flush(); reset(); i++; continue; }
        if (code === "k") { flush(); obfuscated = true; i++; continue; }
        if (code === "l") { flush(); bold = true; i++; continue; }
        if (code === "m") { flush(); strikethrough = true; i++; continue; }
        if (code === "n") { flush(); underline = true; i++; continue; }
        if (code === "o") { flush(); italic = true; i++; continue; }
      }
      buf += ch;
    }
    flush();
    return runs;
  }

  /** HTML runs for an innerHTML preview: only emits styles a run actually
   *  sets, so the surrounding element's own CSS (default color, italic,
   *  font-size, ...) still applies wherever no code overrides it. */
  function toHtml(text, escFn) {
    return parse(text).map(r => {
      const styles = [];
      if (r.color) styles.push(`color:${r.color}`);
      if (r.bold) styles.push("font-weight:bold");
      if (r.italic) styles.push("font-style:italic");
      const decos = [];
      if (r.underline) decos.push("underline");
      if (r.strikethrough) decos.push("line-through");
      if (decos.length) styles.push(`text-decoration:${decos.join(" ")}`);
      const attr = styles.length ? ` style="${styles.join(";")}"` : "";
      return `<span${attr}>${escFn(r.text)}</span>`;
    }).join("");
  }

  /**
   * Draws '&'-coded text on a canvas 2D context as a single line starting
   * at (x, y), run by run (color/bold/italic/underline/strikethrough - no
   * animated obfuscated effect, this is a static preview). `baseFont` is a
   * canvas font suffix, e.g. "13px Consolas, monospace"; runs with no
   * explicit color use `defaultColor`. Returns the x position right after
   * the drawn text, so callers can keep appending plain text on the line.
   */
  function drawRuns(ctx, text, x, y, defaultColor, baseFont) {
    let cursor = x;
    for (const r of parse(text)) {
      ctx.font = `${r.italic ? "italic " : ""}${r.bold ? "bold " : ""}${baseFont}`;
      ctx.fillStyle = r.color || defaultColor;
      ctx.fillText(r.text, cursor, y);
      const width = ctx.measureText(r.text).width;
      if (r.underline || r.strikethrough) {
        const lineY = r.underline ? y + 3 : y - 4;
        ctx.fillRect(cursor, lineY, width, 1);
      }
      cursor += width;
    }
    ctx.font = baseFont;
    return cursor;
  }

  return { parse, toHtml, drawRuns, COLORS };
})();
