import { el, para, code, link, list } from "../components/prose.js";

// VehicleWrapper: design, plus the status of each step. The runner exists (runner/ in this
// folder); this tab's interface to it does not yet.

const START_COMMAND =
  "docker run --rm --init --pull=always -p 127.0.0.1:8765:8765 --read-only --tmpfs /tmp:size=2g " +
  "--cap-drop=ALL --security-opt=no-new-privileges --memory=4g --cpus=2 --pids-limit=256 " +
  "-e EASYNNV_TOKEN=<token from this page> ghcr.io/ckessler2/easynnv-runner";

function numbered(items) {
  const ol = el("ol", "bullet-list");
  for (const item of items) {
    const li = el("li");
    if (Array.isArray(item)) li.append(...item);
    else li.append(item);
    ol.append(li);
  }
  return ol;
}

export function renderVehiclePage() {
  const card = el("article", "page-card prose");

  card.append(
    el(
      "p",
      "warning-box",
      "In progress. The local runner is built and tested; this tab cannot use it yet. The working tool is the rapidNNV tab.",
    ),

    el("h2", "", "Aim"),
    para(
      "rapidNNV is fast but incomplete: some points and properties stay unknown. VehicleWrapper adds complete verification behind the same browser interface. You write a specification in the ",
      link("https://vehicle-lang.readthedocs.io/", "Vehicle"),
      " language, and Vehicle checks it with the ",
      link("https://github.com/NeuralNetworkVerification/Marabou", "Marabou"),
      " verifier: each property is proved, or refuted with a counterexample, unless it runs out of time.",
    ),
    para(
      "It is a wrapper, not a reimplementation: Vehicle and Marabou do all the work, unchanged, and this page only makes them easier to run. You never need to install Python or either tool yourself.",
    ),

    el("h2", "", "Where the computation runs"),
    para(
      "Complete verifiers are native programs that can run for minutes or hours, too heavy for a browser tab. They run in a local runner instead: a Docker container on your own machine, holding Vehicle, Marabou and a small web server. The page talks to it at ",
      code("http://127.0.0.1:8765"),
      ".",
    ),
    list([
      "Setup is Docker plus one command, which this page shows with a copy button.",
      "Models and specifications never leave your machine.",
      "Verifiers run natively, at full speed.",
    ]),

    el("h3", "", "The runner lives and dies with this tab"),
    para("Nothing is left running after you close the page, even if the browser crashes:"),
    list([
      "During a run, the runner sends a small message every 2 seconds. If the tab has gone, sending fails and the runner stops the verification within about 4 seconds.",
      "When idle, the page checks in regularly. If it has not heard from the page for 2 minutes, the runner stops, and Docker deletes the container.",
      "When the tab closes normally, the page tells the runner, which stops within 10 seconds. The delay lets a reloaded page reconnect instead.",
      "Each verification runs as a process group, so stopping it also stops Marabou. Every run also has a time limit.",
    ]),
    para("Reloading the page or closing it cancels a running verification."),

    el("h2", "", "Starting the runner"),
    para("The page will show this command with your token filled in:"),
    el("pre", "mono", START_COMMAND),
    list([
      [code("--pull=always"), ": fetches the newest runner image each time."],
      [code("--init --rm"), ": processes are cleaned up and the container is deleted when it stops."],
      [code("-p 127.0.0.1:8765:8765"), ": only your own machine can connect, not your network."],
      [
        code("--read-only --tmpfs …"),
        ", ",
        code("--cap-drop=ALL"),
        ", ",
        code("--security-opt=no-new-privileges"),
        ": the container cannot change its own files or gain privileges.",
      ],
      [code("--memory --cpus --pids-limit"), ": caps on the resources it can use (adjustable)."],
      [code("EASYNNV_TOKEN"), ": a random secret this page generates and keeps; requests without it are refused."],
    ]),

    el("h2", "", "Always the newest versions"),
    para(
      "No versions are pinned. A GitHub Action rebuilds the runner image every day with the newest Vehicle, Marabou and base image, runs an example verification and the security checks, and publishes the image only if they pass and something has changed. ",
      code("--pull=always"),
      " then gives you the newest image each time you start the runner. The page shows the versions that ran.",
    ),
    list([
      "The image is about 700 MB, downloaded in full the first time and again only when something in it changes.",
      "Vehicle and Marabou publish Linux builds for x86 only, so on Apple Silicon Macs the image runs under emulation: it works, but more slowly.",
      "Marabou's newest packaged release is 2.0.0 (April 2024), built for Python 3.8–3.11. Vehicle needs 3.10 or later, so the image uses Python 3.11.",
      "Docker itself is updated by Docker Desktop, or by your system's package manager on Linux.",
    ]),

    el("h2", "", "Security"),
    para(
      "The runner runs programs on your machine at the request of a web page, so it only accepts requests that are clearly from this page, and limits what a request can do.",
    ),
    el("h3", "", "Other websites"),
    para(
      "While the runner is up, any page open in your browser can send it requests, and CORS does not stop a request from running, only another site reading the reply. So every request is checked before any work is done:",
    ),
    list([
      [el("strong", "", "Origin"), ": must be this site. Requests with no Origin are refused."],
      [
        el("strong", "", "Host"),
        ": must be ",
        code("127.0.0.1:8765"),
        " or ",
        code("localhost:8765"),
        ". This defeats DNS rebinding, where another site's domain is switched to point at your machine.",
      ],
      [el("strong", "", "Token"), ": the secret from the start command, sent in a custom header (which also forces the browser to check with the runner before sending)."],
      [el("strong", "", "Content type"), ": jobs must be JSON; form-style posts are refused."],
    ]),
    el("h3", "", "Malicious specifications or models"),
    para("Vehicle and Marabou read the files you give them. If a file came from someone else, the container is the wall:"),
    list([
      "No folders from your machine are mounted. Files are sent to the runner, kept in a temporary folder, and deleted after each run.",
      "The runner runs as an unprivileged user, on a read-only filesystem, with all Linux privileges dropped and resources capped.",
      "Commands are fixed. The runner builds the Vehicle command itself, never through a shell; the solver is chosen from a fixed list; no extra solver options are accepted; names must be plain identifiers; and the runner picks every file name, so none can point outside the temporary folder.",
      "One run at a time, a 200 MB upload limit and a time limit per run.",
    ]),
    el("h3", "", "This page"),
    list([
      "The runner's output is shown as plain text, never as HTML, so a crafted file cannot run script on this site.",
      "A Content Security Policy will limit the page's connections to this site, its CDNs and the local runner.",
    ]),

    el("h2", "", "Runner interface"),
    list([
      [code("GET /status"), ": versions, available solvers, and whether a run is in progress. The page calls it regularly, which keeps the runner alive."],
      [
        code("POST /verify"),
        ": the specification, networks (ONNX), datasets, parameters, property names, solver and time limit, as JSON. The reply streams Vehicle's output line by line, then the outcome (finished, timed out or cancelled).",
      ],
      [code("POST /shutdown"), ": the page is closing."],
    ]),
    para(
      "The solver is named in each request, so more can be added without changing the interface. If no runner is found, the page shows how to start one and offers the rapidNNV tab instead.",
    ),

    el("h2", "", "First version of this tab"),
    list([
      "Runner detection, the start command with its token, and the versions in use.",
      [
        "A plain text box for the ",
        code(".vcl"),
        " specification, preloaded with a working example and its model.",
      ],
      "File inputs for networks and datasets, fields for parameters, a time limit, Run and Cancel.",
      "Vehicle's output as plain text, as it arrives.",
    ]),

    el("h2", "", "Steps"),
    numbered([
      [el("strong", "", "Done"), ": the runner, its image and the daily build, tested end to end on an example (one property proved, one refuted)."],
      "This tab's first version, as above.",
      "Testing in Chrome, Firefox and Safari.",
      [
        "VNNLib verifiers: Vehicle can compile specifications to VNNLib queries, so verifiers such as ",
        link("https://github.com/Verified-Intelligence/alpha-beta-CROWN", "α,β-CROWN"),
        " can be added to the solver list.",
      ],
      "Nicer results: verdicts and counterexamples as tables, and a better editor (Vehicle includes a language server).",
      "A combined mode: rapidNNV reads VNNLib, so it can first try Vehicle's compiled queries in the browser and send only the undecided ones to the runner.",
    ]),

    el("h2", "", "Open questions"),
    list([
      "Browsers treat requests from a public site to your own machine differently. Recent Chrome asks for permission; Safari may block them entirely. To be tested.",
      "Marabou cannot express strict inequalities (x < y), so Vehicle relaxes them to x ≤ y and warns. Counterexamples can then sit exactly on a boundary. The page should show that warning clearly.",
    ]),
  );

  return card;
}
