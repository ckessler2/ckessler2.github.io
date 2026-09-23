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
    container.textContent = tex;
    return;
  }

  try {
    await MathJax.startup.promise;
    const node = await MathJax.tex2svgPromise(tex, { display: !inline });
    const svg = node.querySelector("svg");
    if (!svg) {
      container.textContent = tex;
      return;
    }

    svg.style.verticalAlign = inline ? "middle" : "baseline";
    svg.style.overflow = "visible";
    svg.style.display = inline ? "inline-block" : "block";

    container.append(svg);
  } catch (_error) {
    container.textContent = tex;
  }
}
