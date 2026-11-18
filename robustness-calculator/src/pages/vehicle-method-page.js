import { el, para, code, link, list } from "../components/prose.js";

// VehicleWrapper Method tab: how the runner works, how it is secured, and what comes next.
// The command shown here is a template; the Run tab fills in the token.

const START_COMMAND =
  "docker run --rm --init --pull=always -p 127.0.0.1:8765:8765 --read-only --tmpfs /tmp:size=2g " +
  "--cap-drop=ALL --security-opt=no-new-privileges --memory=4g --cpus=2 --pids-limit=256 " +
  "-e EASYNNV_TOKEN_SHA256=<from this page> ghcr.io/ckessler2/easynnv-runner";

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

export function renderVehicleMethodPage() {
  const card = el("article", "page-card prose");

  card.append(
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

    el("h3", "", "The runner lives and dies with this page"),
    para("Nothing is left running after you close the page, even if the browser crashes:"),
    list([
      "During a run, the runner checks every 2 seconds whether the tab is still connected, and stops the verification within a few seconds if it is not.",
      "Each open tab checks in every 30 seconds. When no tab has checked in for 2 minutes, the runner stops, and Docker deletes the container.",
      "When a tab closes normally, it tells the runner. Once the last tab has closed, the runner stops within 10 seconds; the delay lets a reloaded page reconnect instead. Closing one tab never stops another tab's run.",
      "After every run, the runner kills every process the run started (including any that tried to detach) and empties its temporary space. Every run also has a time limit.",
    ]),
    para("Reloading the page or closing it cancels a running verification."),

    el("h2", "", "Starting the runner"),
    para("The Run tab shows this command with your token filled in, and a copy button:"),
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
      [
        code("EASYNNV_TOKEN_SHA256"),
        ": the fingerprint (SHA-256) of a random secret the page generates for this browser tab. The page sends the secret with every request and the runner checks it against the fingerprint. The secret itself never appears in the command, your shell history, the process list or the container.",
      ],
    ]),

    el("h2", "", "Always the newest versions"),
    para(
      "No versions are pinned. A GitHub Action rebuilds the runner image every day with the newest Vehicle, Marabou and base image, runs an example verification and the security checks, and publishes the image only if they pass and something has changed. ",
      code("--pull=always"),
      " then gives you the newest image each time you start the runner. The page shows the versions that ran.",
    ),
    list([
      "The image is about 650 MB, downloaded in full the first time and again only when something in it changes.",
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
      [el("strong", "", "Token"), ": the tab's secret, sent in a custom header (which also forces the browser to check with the runner before sending)."],
      [el("strong", "", "Content type"), ": jobs must be JSON; form-style posts are refused."],
      "Each of these headers must appear exactly once. Any refused request closes its connection, so nothing sent after it can be read as a second request.",
      "At most 32 connections at once, each closed after 20 seconds without progress, so stalled connections cannot block the runner for long.",
    ]),
    el("h3", "", "Malicious specifications or models"),
    para("Vehicle and Marabou read the files you give them. If a file came from someone else, the container is the wall:"),
    list([
      "No folders from your machine are mounted. Files are sent to the runner, kept in a temporary folder, and deleted after each run.",
      "The runner runs as an unprivileged user, on a read-only filesystem, with all Linux privileges dropped and resources capped.",
      "Vehicle itself refuses ONNX files that point to data in other files, and accepts datasets only in the IDX format, so a model cannot read files and a dataset cannot run code.",
      "Commands are fixed. The runner builds the Vehicle command itself, never through a shell; the solver is chosen from a fixed list; no extra solver options are accepted; names must be plain identifiers; and the runner picks every file name, so none can point outside the temporary folder.",
      "One run at a time, a 200 MB upload limit and a time limit per run.",
    ]),
    el("h3", "", "This page"),
    list([
      "The runner's output is shown as plain text, never as HTML, so a crafted file cannot run script on this site.",
      "The secret is kept only for this browser tab (sessionStorage), not for the whole site: pages in other tabs cannot read it, and a new tab gets a new secret.",
      "Scripts from CDNs are pinned to exact versions, and those loaded directly by pages carry integrity hashes, so the browser refuses a modified copy.",
    ]),
    el("h3", "", "Known limits"),
    list([
      [
        el("strong", "", "Shared site"),
        ": everything under ",
        code("ckessler2.github.io"),
        " shares one browser origin. A script running on this page, or on another page of the site that opened this tab, could read the secret while the tab is open. easyNNV will move to its own site later, which removes this; it stays here for now to keep testing simple.",
      ],
      [
        el("strong", "", "Internet access"),
        ": the container can make outbound connections. Docker cannot block them while still letting the page reach the runner without extra setup. Nothing in the runner uses the network, so only compromised Vehicle or Marabou code could. Blocking it would need a longer start command with extra steps, so this is accepted for now.",
      ],
      [
        el("strong", "", "New releases"),
        ": the image takes new releases of Vehicle and Marabou within a day, with only an automated test in between. To reduce this, the image installs nothing else: no other package's releases reach your machine. Waiting a few days before using a new release would catch most malicious ones, but would delay new versions, so it is not done for now.",
      ],
      "The library loaded by rapidNNV's background worker (TensorFlow.js, ONNX Runtime) cannot carry integrity hashes, because it is imported by code; that worker cannot read the secret.",
    ]),

    el("h2", "", "Runner interface"),
    list([
      [code("GET /status"), ": versions, available solvers, and whether a run is in progress. Each tab calls it regularly, which keeps the runner alive."],
      [
        code("POST /verify"),
        ": the specification, networks (ONNX), datasets, parameters, property names, solver and time limit, as JSON. The reply streams Vehicle's output line by line, then the outcome (finished, timed out or cancelled).",
      ],
      [code("POST /shutdown"), ": a tab is closing (its secret and tab id are the body, since the browser cannot add headers to this message)."],
    ]),
    para(
      "The solver is named in each request, so more can be added without changing the interface.",
    ),

    el("h2", "", "The Run tab"),
    list([
      "The page contacts the runner only when you press Connect, so opening the tab never triggers a browser prompt. After that it checks in every 30 seconds, and reconnects by itself after a reload.",
      [
        "A plain text box for the ",
        code(".vcl"),
        " specification, preloaded with a small example (one property that holds, one that does not) and its network.",
      ],
      [
        "The networks, datasets and parameters the specification declares (",
        code("@network"),
        ", ",
        code("@dataset"),
        ", ",
        code("@parameter"),
        ") each get an input; inferred parameters are left to Vehicle.",
      ],
      "Verify and Cancel, a time limit, and Vehicle's output as plain text as it arrives. Cancel closes the connection, and the runner stops the verification within a few seconds.",
    ]),

    el("h2", "", "Steps"),
    numbered([
      [el("strong", "", "Done"), ": the runner, its image and the daily build, tested end to end on an example (one property proved, one refuted)."],
      [el("strong", "", "Done"), ": the Run tab's first version, as above."],
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
      "Marabou cannot express strict inequalities (x < y), so Vehicle relaxes them to x ≤ y and warns. Counterexamples can then sit exactly on a boundary; the Run tab points this out when it happens.",
    ]),
  );

  return card;
}
