// Small inline-SVG histogram of per-point smallest successful ε. Points with
// no counterexample at the full ε get their own "> ε" bar.

const SVG = "http://www.w3.org/2000/svg";

function el(name, attrs = {}, text) {
  const node = document.createElementNS(SVG, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (text !== undefined) node.textContent = text;
  return node;
}

export function createEpsilonHistogram(values, epsMax, bins = 10) {
  const counts = new Array(bins).fill(0);
  let over = 0;
  for (const v of values) {
    if (!Number.isFinite(v)) over++;
    else counts[Math.min(bins - 1, Math.floor((v / epsMax) * bins))]++;
  }
  const all = [...counts, over];
  const maxCount = Math.max(1, ...all);

  const W = 520;
  const H = 180;
  const pad = { l: 34, r: 8, t: 18, b: 34 };
  const bw = (W - pad.l - pad.r) / all.length;
  const ph = H - pad.t - pad.b;

  const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, class: "histogram", role: "img" });
  svg.append(el("title", {}, "Distribution of the smallest ε at which a counterexample was found"));

  all.forEach((c, i) => {
    const h = (c / maxCount) * ph;
    svg.append(
      el("rect", {
        x: pad.l + i * bw + 1,
        y: pad.t + ph - h,
        width: Math.max(1, bw - 2),
        height: h,
        class: i === bins ? "bar-over" : "bar",
      }),
    );
    if (c > 0) svg.append(el("text", { x: pad.l + (i + 0.5) * bw, y: pad.t + ph - h - 3, "text-anchor": "middle" }, String(c)));
  });

  svg.append(el("line", { x1: pad.l, x2: W - pad.r, y1: pad.t + ph, y2: pad.t + ph, class: "axis" }));
  const tick = (x, label) => svg.append(el("text", { x, y: H - pad.b + 14, "text-anchor": "middle" }, label));
  tick(pad.l, "0");
  tick(pad.l + (bins / 2) * bw, String(Number((epsMax / 2).toPrecision(3))));
  svg.append(el("text", { x: pad.l + bins * bw - 2, y: H - pad.b + 14, "text-anchor": "end" }, String(Number(epsMax.toPrecision(3)))));
  tick(pad.l + (bins + 0.5) * bw, "> ε");
  svg.append(el("text", { x: pad.l + (bins / 2) * bw, y: H - 4, "text-anchor": "middle" }, "smallest ε with a counterexample"));
  svg.append(el("text", { x: 4, y: pad.t + 8 }, "points"));
  return svg;
}
