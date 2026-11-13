export function createAccordion({
  title,
  titleNode = null,
  content,
  open = false,
  onToggle = null,
}) {
  const details = document.createElement("details");
  details.className = "accordion";
  details.open = open;

  if (onToggle) {
    details.addEventListener("toggle", () => {
      onToggle(details.open);
    });
  }

  const summary = document.createElement("summary");
  if (titleNode) {
    summary.append(titleNode);
  } else {
    summary.textContent = title;
  }

  const body = document.createElement("div");
  body.className = "accordion-body";

  if (typeof content === "string") {
    const paragraph = document.createElement("p");
    paragraph.textContent = content;
    body.append(paragraph);
  } else {
    body.append(content);
  }

  details.append(summary, body);
  return details;
}
