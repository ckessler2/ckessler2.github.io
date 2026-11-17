import { el, para, code, link, list } from "../components/prose.js";

// VehicleWrapper: proposed design only. Nothing on this tab runs yet.

function numbered(items) {
  const ol = el("ol", "bullet-list");
  for (const item of items) ol.append(el("li", "", item));
  return ol;
}

export function renderVehiclePage() {
  const card = el("article", "page-card prose");

  card.append(
    el(
      "p",
      "warning-box",
      "Planned, not yet implemented. This tab describes the proposed design. The working tool is the rapidNNV tab.",
    ),

    el("h2", "", "Aim"),
    para(
      "rapidNNV is fast but incomplete: some points and properties stay unknown. VehicleWrapper will add complete verification behind the same browser interface. You write a specification in the ",
      link("https://vehicle-lang.readthedocs.io/", "Vehicle"),
      " language, choose a verifier, and get a verdict for every query that finishes within its time limit, with a counterexample when the specification is violated. The page stays the only interface, and you never need to touch Python.",
    ),

    el("h2", "", "Where the computation runs"),
    para(
      "Complete verifiers such as Marabou are native programs that can run for minutes or hours, which is too heavy for JavaScript in a browser tab. They will run in a local runner instead: a container (Docker) on your own machine, holding Vehicle, Marabou and a small web server. The page talks to it at ",
      code("http://localhost"),
      ".",
    ),
    list([
      "Installing it is a one-time step (Docker, plus one command to start the runner). No Python is needed on the host.",
      "Models and specifications never leave your machine.",
      "Verifiers run natively, at full speed, and long jobs survive a closed tab.",
      "The same container could later run on a hosted server without changes to the page.",
    ]),

    el("h2", "", "Workflow"),
    list([
      [el("strong", "", "Network"), ": load an ONNX model, as on the rapidNNV tab."],
      [
        el("strong", "", "Specification"),
        ": write or choose a ",
        code(".vcl"),
        " file in an editor with syntax highlighting and examples. Network, dataset and parameter declarations are linked to the loaded files.",
      ],
      [el("strong", "", "Verifier"), ": choose from a menu. Marabou is the default; other verifiers that Vehicle supports will be added later."],
      [
        el("strong", "", "Run"),
        ": the runner compiles the specification with Vehicle into verifier queries, runs the verifier, and streams progress back. The page shows a verdict for each property, the counterexample if there is one, and the logs.",
      ],
    ]),

    el("h2", "", "Runner interface"),
    para("A small HTTP API, kept independent of the verifier so that more verifiers can be added:"),
    list([
      [code("GET /status"), ": the runner's version and the verifiers available."],
      [code("POST /verify"), ": the ONNX model, the specification, the verifier, a timeout and options; returns a job id."],
      [code("GET /jobs/{id}"), ": progress, verdicts, counterexamples and logs."],
      [code("DELETE /jobs/{id}"), ": cancel a job."],
    ]),
    para("If no runner is found, the page says how to start one and offers the rapidNNV tab instead."),

    el("h2", "", "Combining it with rapidNNV"),
    para(
      "In a later step, rapidNNV's in-browser certification and attack can run first, within seconds, and only the queries left unknown go to the complete verifier. Most easy cases are then decided at once, and the expensive verifier is spent on the hard ones.",
    ),

    el("h2", "", "Steps"),
    numbered([
      "A runner container with Vehicle, Marabou and the HTTP API, tested from end to end on one published benchmark.",
      "This tab: runner detection, model upload, a specification editor, the verifier menu, and the results display.",
      "Further verifiers in the menu.",
      "The combined mode with rapidNNV.",
    ]),

    el("h2", "", "Open questions"),
    list([
      "Browsers may ask for permission before an https page can contact a local server; the setup instructions will need to cover this.",
      "Time and memory limits per query, and how to report queries that run out of time.",
      "Whether a hosted runner is worth offering, given its cost and the need to handle users' models securely.",
    ]),
  );

  return card;
}
