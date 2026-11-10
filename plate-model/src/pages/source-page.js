function escapeHtml(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function highlightJs(source) {
  const tokenPattern =
    /(\/\/[^\n]*|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\b(?:import|from|export|function|return|const|let|if|else)\b|\b(?:Math|Number|Array|Object|Boolean)\b|\b\d+(?:\.\d+)?(?:e-?\d+)?\b)/g;

  let html = "";
  let lastIndex = 0;

  for (const match of source.matchAll(tokenPattern)) {
    const [token] = match;
    const start = match.index ?? 0;
    html += escapeHtml(source.slice(lastIndex, start));

    let className = "";
    if (token.startsWith("//")) {
      className = "code-comment";
    } else if (token.startsWith('"') || token.startsWith("'")) {
      className = "code-string";
    } else if (/^(import|from|export|function|return|const|let|if|else)$/.test(token)) {
      className = "code-keyword";
    } else if (/^(Math|Number|Array|Object|Boolean)$/.test(token)) {
      className = "code-builtin";
    } else {
      className = "code-number";
    }

    html += `<span class="${className}">${escapeHtml(token)}</span>`;
    lastIndex = start + token.length;
  }

  html += escapeHtml(source.slice(lastIndex));
  return html;
}

function createCodeCard(titleText, source) {
  const card = document.createElement("section");
  card.className = "page-card";

  const title = document.createElement("h2");
  title.textContent = titleText;

  const pre = document.createElement("pre");
  pre.className = "code-block";

  const code = document.createElement("code");
  code.className = "code-block-inner";
  code.innerHTML = highlightJs(source);

  pre.append(code);
  card.append(title, pre);
  return card;
}

async function loadSourceFile(path) {
  try {
    const response = await fetch(path, { cache: "no-store" });
    if (!response.ok) {
      return `// Could not load ${path} (HTTP ${response.status}).`;
    }
    return await response.text();
  } catch (_error) {
    return `// Could not load ${path}.`;
  }
}

export function renderSourcePage() {
  const page = document.createElement("section");
  page.className = "page-flow";

  const loadingCard = document.createElement("section");
  loadingCard.className = "page-card";
  loadingCard.textContent = "Loading source files...";
  page.append(loadingCard);

  Promise.all([
    loadSourceFile("./src/simulation/nondim-falling-plate-quiescent.js"),
    loadSourceFile("./src/simulation/run-quiescent.js"),
  ]).then(([liveModelSource, liveRunnerSource]) => {
    page.replaceChildren(
      createCodeCard("nondim-falling-plate-quiescent.js", liveModelSource),
      createCodeCard("run-quiescent.js", liveRunnerSource),
    );
  });

  return page;
}
