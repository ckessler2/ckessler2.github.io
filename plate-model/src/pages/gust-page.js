export function renderGustPage() {
  const page = document.createElement("section");
  page.className = "page-flow";

  const card = document.createElement("article");
  card.className = "page-card";
  card.innerHTML = `
    <p>To be implemented ...</p>
  `;

  page.append(card);
  return page;
}
