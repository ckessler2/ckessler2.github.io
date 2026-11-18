// Renders TeX with MathJax (loaded from the CDN in index.html). When MathJax is not available
// (CDN blocked, offline, or a load error), a readable plain version is shown instead of raw TeX:
// symbols as Unicode, sub- and superscripts, stacked fractions and cases (styles: .math-fallback
// in css/docs.css). The TeX source stays available as the fallback's tooltip.

export async function renderMath(tex, container, { inline = true } = {}) {
  if (!container) {
    return;
  }

  container.replaceChildren();

  if (!tex) {
    return;
  }

  const MathJax = window.MathJax;
  if (!MathJax?.tex2svgPromise || !MathJax?.startup?.promise) {
    showFallback(tex, container, inline);
    return;
  }

  try {
    await MathJax.startup.promise;
    const node = await MathJax.tex2svgPromise(tex, { display: !inline });
    const svg = node.querySelector("svg");
    if (!svg) {
      showFallback(tex, container, inline);
      return;
    }

    svg.style.verticalAlign = inline ? "middle" : "baseline";
    svg.style.overflow = "visible";
    svg.style.display = inline ? "inline-block" : "block";

    container.append(svg);
  } catch (_error) {
    showFallback(tex, container, inline);
  }
}

function showFallback(tex, container, inline) {
  container.replaceChildren();
  let node;
  try {
    node = texToNodes(tex);
  } catch (_error) {
    node = document.createTextNode(tex);
  }
  const wrap = document.createElement("span");
  wrap.className = inline ? "math-fallback" : "math-fallback math-fallback-display";
  wrap.title = tex;
  wrap.append(node);
  container.append(wrap);
}

// ---- a small TeX-to-DOM converter for the subset used on these pages ------------------------

const SYMBOLS = {
  le: "≤", leq: "≤", ge: "≥", geq: "≥", ne: "≠", neq: "≠", approx: "≈", in: "∈", notin: "∉",
  to: "→", rightarrow: "→", Rightarrow: "⇒", implies: "⇒", iff: "⇔", mapsto: "↦",
  cdot: "·", times: "×", pm: "±", infty: "∞", partial: "∂", nabla: "∇", sum: "Σ", prod: "∏",
  forall: "∀", exists: "∃", lVert: "‖", rVert: "‖", Vert: "‖", "|": "‖", lvert: "|", rvert: "|",
  lbrace: "{", rbrace: "}", "{": "{", "}": "}", ldots: "…", dots: "…", cdots: "⋯",
  alpha: "α", beta: "β", gamma: "γ", delta: "δ", Delta: "Δ", epsilon: "ε", varepsilon: "ε",
  eta: "η", theta: "θ", lambda: "λ", mu: "μ", pi: "π", sigma: "σ", tau: "τ", phi: "φ", omega: "ω",
  max: "max", min: "min", sup: "sup", inf: "inf", log: "log", exp: "exp", sign: "sign",
};
const SPACES = { qquad: "  ", quad: " ", ",": " ", ";": " ", ":": " ", "!": "", " ": " " };
const TEXT_COMMANDS = new Set(["text", "mathrm", "operatorname", "mathbf", "mathit", "textrm", "mathsf"]);
const RELATIONS = new Set(["=", "≤", "≥", "≠", "≈", "∈", "→", "⇒", "⇔", "<", ">"]);

function texToNodes(tex) {
  let i = 0;
  const frag = () => document.createDocumentFragment();
  const span = (cls) => {
    const s = document.createElement("span");
    s.className = cls;
    return s;
  };

  // Append text, putting spaces around relations and binary operators.
  function emit(out, text) {
    if (RELATIONS.has(text) || text === "+" || text === "×") {
      out.append(` ${text} `);
    } else if (text === "-") {
      const before = out.textContent.trimEnd();
      const unary = before === "" || /[=≤≥≠≈∈→⇒⇔<>(,\[{]$/.test(before);
      out.append(unary ? "−" : " − ");
    } else if (text === ",") {
      out.append(", ");
    } else {
      out.append(text);
    }
  }

  function readCommand() {
    // at "\"
    i++;
    if (i < tex.length && !/[a-zA-Z]/.test(tex[i])) return tex[i++];
    let name = "";
    while (i < tex.length && /[a-zA-Z]/.test(tex[i])) name += tex[i++];
    return name;
  }

  function skipSpaces() {
    while (i < tex.length && /\s/.test(tex[i])) i++;
  }

  // One argument: a braced group, a command or a single character.
  function readArg(textMode = false) {
    skipSpaces();
    if (tex[i] === "{") {
      i++;
      return parse("}", textMode);
    }
    const out = frag();
    if (tex[i] === "\\") handleCommand(out, readCommand());
    else if (i < tex.length) {
      const ch = tex[i++];
      if (!textMode && /[a-zA-Z]/.test(ch)) {
        const v = document.createElement("i");
        v.textContent = ch;
        out.append(v);
      } else emit(out, ch);
    }
    return out;
  }

  function readRawGroup() {
    skipSpaces();
    if (tex[i] !== "{") return "";
    let depth = 0;
    let s = "";
    for (; i < tex.length; i++) {
      if (tex[i] === "{") depth++;
      else if (tex[i] === "}") depth--;
      if (depth === 0) {
        i++;
        break;
      }
      if (depth > 1 || tex[i] !== "{") s += tex[i];
    }
    return s;
  }

  function handleCommand(out, name) {
    if (name in SPACES) {
      out.append(SPACES[name]);
    } else if (TEXT_COMMANDS.has(name)) {
      out.append(readArg(true));
    } else if (name === "frac") {
      const f = span("mf-frac");
      const num = span("mf-num");
      const den = span("mf-den");
      num.append(readArg());
      den.append(readArg());
      f.append(num, den);
      out.append(f);
    } else if (name === "left" || name === "right" || name === "big" || name === "Big" || name === "bigl" || name === "bigr") {
      skipSpaces();
      if (tex[i] === "\\") {
        const n = readCommand();
        out.append(SYMBOLS[n] ?? (n === "." ? "" : n));
      } else if (tex[i] === ".") i++;
      else out.append(tex[i++] ?? "");
    } else if (name === "begin") {
      const env = readRawGroup();
      out.append(env === "cases" ? readCases() : parse(`\\end{${env}}`));
    } else if (name === "\\") {
      out.append("; ");
    } else if (name in SYMBOLS) {
      const sym = SYMBOLS[name];
      if (/^[a-z]{2,}$/.test(sym) && out.textContent && !/\s$/.test(out.textContent)) out.append(" ");
      emit(out, sym);
    } else {
      out.append(name);
    }
  }

  function readCases() {
    const end = "\\end{cases}";
    const stop = tex.indexOf(end, i);
    const body = stop < 0 ? tex.slice(i) : tex.slice(i, stop);
    i = stop < 0 ? tex.length : stop + end.length;
    const box = span("mf-cases");
    const rows = span("mf-cases-rows");
    for (const row of body.split("\\\\")) {
      if (!row.trim()) continue;
      const [value, condition = ""] = row.split("&");
      const r = span("mf-case");
      const v = span("mf-case-value");
      v.append(texToNodes(value));
      const c = span("mf-case-cond");
      const cond = condition.trim();
      // "1 & u \ge -l" reads "1 if u ≥ −l"; text conditions ("otherwise") stand on their own.
      if (cond && !/^\\text/.test(cond)) c.append("if ");
      c.append(texToNodes(cond));
      r.append(v, c);
      rows.append(r);
    }
    box.append(span("mf-brace"), rows);
    box.firstChild.textContent = "{";
    return box;
  }

  function parse(stop, textMode = false) {
    const out = frag();
    while (i < tex.length) {
      if (stop === "}" && tex[i] === "}") {
        i++;
        return out;
      }
      if (stop.length > 1 && tex.startsWith(stop, i)) {
        i += stop.length;
        return out;
      }
      const ch = tex[i];
      if (ch === "\\") {
        handleCommand(out, readCommand());
      } else if (ch === "_" || ch === "^") {
        i++;
        const s = document.createElement(ch === "_" ? "sub" : "sup");
        const afterOperator = /(max|min|sup|inf|Σ|∏)$/.test(out.textContent);
        s.append(readArg());
        // Scripts are set tight: "k−1", not "k − 1".
        const w = document.createTreeWalker(s, NodeFilter.SHOW_TEXT);
        for (let n = w.nextNode(); n; n = w.nextNode()) n.textContent = n.textContent.replace(/ ?([−+=≠≤≥]) ?/g, "$1");
        out.append(s);
        if (afterOperator) out.append("\u2009");
      } else if (ch === "{") {
        i++;
        out.append(parse("}", textMode));
      } else if (/\s/.test(ch)) {
        i++;
        if (textMode) out.append(" ");
      } else if (ch === "&") {
        i++;
        out.append(" ");
      } else if (!textMode && /[a-zA-Z]/.test(ch)) {
        // Variables in italics, as in typeset maths.
        i++;
        const v = document.createElement("i");
        v.textContent = ch;
        out.append(v);
      } else {
        i++;
        if (textMode) out.append(ch);
        else emit(out, ch);
      }
    }
    return out;
  }

  const result = document.createDocumentFragment();
  result.append(parse(""));
  // Tidy doubled spaces from emitted operators.
  const walker = document.createTreeWalker(result, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) n.textContent = n.textContent.replace(/ {2,}/g, " ");
  return result;
}
