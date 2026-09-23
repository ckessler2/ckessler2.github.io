export function renderEquationsPage() {
  const page = document.createElement("section");
  page.className = "page-flow";

  const card = document.createElement("article");
  card.className = "page-card";
  card.innerHTML = `
    <h2>Equations and aerodynamic curves</h2>
    <p>This page will explain how the model works with diagrams and equations.</p>
 `;

  page.append(card);
  return page;
}
