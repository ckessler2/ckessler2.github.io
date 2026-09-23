export function renderBackgroundPage() {
  const page = document.createElement("section");
  page.className = "page-flow";

  const intro = document.createElement("article");
  intro.className = "hero-panel";
  intro.innerHTML = `
    <h2>Introduction</h2>
    <p>To be completed ...</p>
  `;

  const sources = document.createElement("article");
  sources.className = "page-card";
  sources.innerHTML = `
    <h2>Planned content</h2>
    <ul class="bullet-list">
      <li>Background on the nondimensional falling-plate model and its assumptions.</li>
      <li>References to the literature and any validation cases we want to preserve.</li>
      <li>Notes on the browser implementation so users can understand what is computed client-side.</li>
    </ul>
  `;

  page.append(intro, sources);
  return page;
}
