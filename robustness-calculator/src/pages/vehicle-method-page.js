import { el, code, link } from "../components/prose.js";
import { info } from "../components/ui.js";
import { docsPage, pageTitle, inShort, cards, defs, bullets, subhead, callout, p } from "../components/docs-layout.js";

// Verify Method tab: get started, how it works, security, reference.
// The roadmap and open questions live in README.md (Verify, "Roadmap").
// The command shown here is a template; the Run tab fills in the token.

const START_COMMAND =
  "docker run --rm --init --pull=always -p 127.0.0.1:8765:8765 --read-only --tmpfs /tmp:size=2g " +
  "--cap-drop=ALL --security-opt=no-new-privileges --memory=4g --cpus=2 --pids-limit=256 " +
  "-e EASYNNV_TOKEN_SHA256=<from the Run tab> ghcr.io/ckessler2/easynnv-runner";

const decision = (text) => callout([el("strong", "", "Decision: "), text], "decision");

export function renderVehicleMethodPage() {
  const header = [
    pageTitle("How Verify works", "Complete verification of Vehicle specifications, run on your own machine from this page."),
    inShort(
      cards([
        {
          title: "What it is",
          text: [
            "Complete verification: you write a ",
            link("https://vehicle-lang.readthedocs.io/", "Vehicle"),
            " specification and ",
            link("https://github.com/NeuralNetworkVerification/Marabou", "Marabou"),
            " proves or refutes each property, unless it runs out of time.",
          ],
        },
        { title: "What you need", text: "Docker and one command, copied from the Run tab. No Python, Vehicle or Marabou to install." },
        { title: "Where it runs", text: "In a Docker container on your machine. Models and specifications never leave it." },
        { title: "A wrapper", text: "Vehicle and Marabou do all the work, unchanged; this page only makes them easier to run." },
      ]),
      p(
        "Estimate is fast but incomplete: some points and properties stay unknown. Verify decides them, at the cost of a local setup and longer runs.",
      ),
    ),
  ];

  const sections = [
    {
      id: "start",
      title: "Get started",
      summary: "Start the runner with one command, connect, and verify a specification.",
      body: [
        bullets(
          [
            ["Install ", link("https://docs.docker.com/get-docker/", "Docker"), " (Docker Desktop on macOS and Windows)."],
            [
              "On the ",
              link("#/verify", "Run tab"),
              ", copy the start command (it holds a fingerprint of a secret made for this tab) and run it in a terminal. The first start downloads the image (about 650 MB).",
            ],
            "Press Connect runner. The page contacts the runner only then, so opening the tab never triggers a browser prompt; it reconnects by itself after a reload. If your browser blocks the connection (Safari, Brave, or a declined “local network” prompt in Chrome), the page says so after a few seconds and offers the same page served by the runner itself at http://127.0.0.1:8765, which needs no permission.",
            [
              "Write a ",
              code(".vcl"),
              " specification, or pick an example under Open: the built-in tiny network, or one of 14 from the Vehicle tutorial (ACAS Xu, Iris, MNIST and Fashion-MNIST robustness, networks before and after property-driven training, and the wind controller), fetched from its GitHub repository when you choose them.",
            ],
            [
              "Give each network, dataset and parameter the specification declares (",
              code("@network"),
              ", ",
              code("@dataset"),
              ", ",
              code("@parameter"),
              ") its input under Networks (or Inputs) in the toolbar; inferred parameters are left to Vehicle.",
            ],
            "Under Properties, untick any you don't want to check (all are ticked by default). Set a time limit and press Verify. Results fill in as Vehicle reports them (see Reading the results). Cancel closes the connection, and the runner stops within a few seconds.",
          ],
          { ordered: true, className: "docs-steps" },
        ),
        callout("To stop the runner yourself, open the status at the top right and press Disconnect. Reloading or closing the page cancels a running verification, and the runner stops by itself once the page is gone. If the runner stops (its terminal is closed, or Docker quits), the page notices within seconds and shows the setup steps again.", "note"),
      ],
    },
    {
      id: "results",
      title: "Reading the results",
      summary: "The headline counts how many properties hold; below it is one row per property, and Vehicle's own output is kept under Full output.",
      body: [
        defs([
          ["✓ proved", "Marabou proved that no counterexample exists: the property holds for every input it quantifies over."],
          ["✗ counterexample", "Marabou found inputs that break the property. Open the row to see their values, e.g. x = [0.75, 0.75]."],
          ["⏱ timeout", "The time limit ran out before Marabou decided. Raise the limit under Time limit, or simplify the property."],
          ["○ pending", "Before a run, or while it runs: the property has not been reported yet."],
          ["– cancelled / not checked", "The run was cancelled, or stopped with an error, before this property was reached."],
          ["? not reported", "The run finished, but Vehicle's output did not mention this property; check Full output."],
        ]),
        subhead("The ≤ badge"),
        p(
          "Marabou cannot express strict inequalities (x < y), so Vehicle relaxes them to x ≤ y and warns. Rows marked ≤ are affected: their verdicts are exact up to the solver's tiny tolerance, but a counterexample may lie exactly on the boundary of the property (for example an output of exactly 1.5 for “below 1.5”). The warning is shown once above the rows instead of once per property.",
        ),
        subhead("Properties over many elements"),
        p(
          "A property declared over a vector or a dataset (for example one per test image) is checked element by element. Its elements are grouped into one row, such as “robust — 41 proved · 2 counterexamples”; open it to see the elements that did not hold.",
        ),
        subhead("Errors and the full output"),
        p(
          "If Vehicle stops with an error (for example a syntax error in the specification), its message is shown instead of the rows, with a button that selects the line it refers to in the editor. Vehicle's complete output, including every warning, is always available under Full output, with Copy and Download.",
        ),
        subhead("Counterexamples as images"),
        p(
          "When a counterexample is a matrix (for example the perturbation of an MNIST image), it is drawn: the dataset image, the perturbation (red positive, blue negative), and, after Check with the network, the perturbed image. That check runs the network on the perturbed image in your browser with onnxruntime and says whether its answer really changes.",
        ),
        subhead("Run record"),
        p(
          "Run record (under Full output) downloads a JSON file with the specification, the SHA-256 of every network and dataset, the parameters, the runner's image revision and every package version, the limits, the verdicts, and a docker command that repeats the run with exactly the same image.",
        ),
        callout("After you edit the specification or its inputs, the previous result is dimmed until you verify again, so a result always matches what it was run on.", "note"),
      ],
    },
    {
      id: "how",
      title: "How it works",
      summary: "The page talks to a local runner: a Docker container with Vehicle, Marabou and a small web server, which lives only as long as the page.",
      body: [
        subhead("Why a local runner"),
        p(
          "Complete verifiers are native programs that can run for minutes or hours, too heavy for a browser tab. The runner holds them and listens at ",
          code("http://127.0.0.1:8765"),
          ". Verifiers run natively, at full speed, and nothing leaves your machine.",
        ),

        subhead("The runner lives and dies with this page"),
        p("Nothing is left running after you close the page, even if the browser crashes."),
        defs([
          ["During a run", "The runner checks every 2 seconds whether the tab is still connected, and stops the verification within a few seconds if it is not."],
          ["Disconnect", "The tab tells the runner it is done, as when it closes; the runner stops within 10 seconds unless another tab still uses it."],
          ["While idle", "Each open tab checks in every 5 seconds. When no tab has checked in for 2 minutes, the runner stops and Docker deletes the container."],
          ["Closing a tab", "The tab tells the runner. Once the last tab has closed, the runner stops within 10 seconds (the delay lets a reloaded page reconnect). Closing one tab never stops another tab's run."],
          ["After every run", "The runner kills every process the run started (including any that tried to detach) and empties its temporary space. Every run also has a time limit."],
        ]),

        subhead("Always the newest versions"),
        p(
          "No versions are pinned. A GitHub Action rebuilds the image every day with the newest Vehicle, Marabou and base image, checks that the newest releases were really installed, runs an example verification, the security checks and this page's reading of Vehicle's output, and publishes it only if they pass and something changed (a failed daily build opens an issue). ",
          code("--pull=always"),
          " gives you the newest image at each start; the page shows the versions that ran. Each published image is also tagged with its revision (for example ",
          code("2026-11-19-abc1234"),
          "), which the run record names, so a result can be repeated with exactly the same tools.",
        ),
        bullets([
          "The image is about 650 MB, downloaded in full the first time and again only when something in it changes.",
          "Marabou publishes builds for x86 only (Vehicle also has ARM builds), so the image is x86, and on Apple Silicon Macs it runs under emulation: it works, but several times more slowly.",
          "The runner has 4 GB of memory by default; choose 8 or 16 GB next to the start command for larger datasets (Docker Desktop must have that much, under Settings → Resources).",
          "Marabou's newest packaged release is 2.0.0 (April 2024), built for Python 3.8–3.11. Vehicle needs 3.10 or later, so the image uses Python 3.11.",
          "Docker itself is updated by Docker Desktop, or by your system's package manager on Linux.",
        ]),
      ],
    },
    {
      id: "security",
      title: "Security",
      summary: "The runner runs programs on your machine at a web page's request, so it accepts only requests clearly from this page and limits what any request can do.",
      body: [
        subhead(
          "Other websites",
          info("While the runner is up, any page open in your browser can send it requests. CORS does not stop a request from running, only another site reading the reply. So every request is checked before any work is done."),
        ),
        defs([
          ["Origin", "Must be this site. Requests with no Origin are refused."],
          [
            "Host",
            [
              "Must be ",
              code("127.0.0.1:8765"),
              " or ",
              code("localhost:8765"),
              ". This defeats DNS rebinding, where another site's domain is switched to point at your machine.",
            ],
          ],
          ["Token", "The tab's secret, sent in a custom header (which also forces the browser to check with the runner before sending)."],
          ["Content type", "Jobs must be JSON; form-style posts are refused."],
          ["Headers", "Each of these must appear exactly once. A refused request closes its connection, so nothing sent after it can be read as a second request."],
          ["Connections", "At most 32 at once, each closed after 20 seconds without progress, so stalled connections cannot block the runner for long."],
        ]),

        subhead("Malicious specifications or models", info("Vehicle and Marabou read the files you give them. If a file came from someone else, the container is the wall.")),
        defs([
          ["No mounts", "No folders from your machine are mounted. Files are sent to the runner, kept in a temporary folder, and deleted after each run."],
          ["Locked down", "An unprivileged user, a read-only filesystem, all Linux privileges dropped, resources capped."],
          ["Safe formats", "Vehicle refuses ONNX files that point to data in other files, and accepts datasets only in the IDX format, so a model cannot read files and a dataset cannot run code."],
          [
            "Fixed commands",
            "The runner builds the Vehicle command itself, never through a shell; the solver comes from a fixed list; no extra solver options are accepted; names must be plain identifiers; and the runner picks every file name, so none can point outside the temporary folder.",
          ],
          ["Limits", "One run at a time, a 200 MB upload limit and a time limit per run."],
        ]),

        subhead("This page"),
        defs([
          ["Plain-text output", "The runner's output is shown as plain text, never as HTML, so a crafted file cannot run script on this site."],
          ["Per-tab secret", "Kept only for this browser tab (sessionStorage), not for the whole site: other tabs cannot read it, and a new tab gets a new secret."],
          ["Pinned scripts", "Scripts from CDNs are pinned to exact versions, and those loaded directly by pages carry integrity hashes, so the browser refuses a modified copy."],
        ]),

        subhead("Known limits"),
        p("These are known, and accepted for now."),
        defs([
          [
            "Shared site",
            [
              "Everything under ",
              code("ckessler2.github.io"),
              " shares one browser origin. A script on this page, or on another page of the site that opened this tab, could read the secret while the tab is open.",
              decision("accepted until easyNNV moves to its own site, which removes this; it stays here for now to keep testing simple."),
            ],
          ],
          [
            "Internet access",
            [
              "The container can make outbound connections: Docker cannot block them while still letting the page reach the runner without extra setup. Nothing in the runner uses the network, so only compromised Vehicle or Marabou code could.",
              decision("accepted; blocking it would need a longer start command with extra steps."),
            ],
          ],
          [
            "New releases",
            [
              "The image takes new Vehicle and Marabou releases within a day, with only an automated test in between. It installs nothing else, so no other package's releases reach your machine.",
              decision("no waiting period. Waiting a few days would catch most malicious releases but delay new versions."),
            ],
          ],
          [
            "Worker libraries",
            "The libraries loaded by Estimate's background worker (TensorFlow.js, ONNX Runtime) cannot carry integrity hashes, because code imports them; that worker cannot read the secret.",
          ],
        ]),
      ],
    },
    {
      id: "reference",
      title: "Reference",
      summary: "The start command's flags and the runner's three endpoints.",
      body: [
        subhead("Start command"),
        p("The Run tab shows this command with your token filled in, and a copy button:"),
        el("pre", "mono docs-code", START_COMMAND),
        defs(
          [
            [code("--pull=always"), "Fetches the newest runner image each time."],
            [[code("--init"), " ", code("--rm")], "Processes are cleaned up and the container is deleted when it stops."],
            [code("-p 127.0.0.1:8765:8765"), "Only your own machine can connect, not your network."],
            [
              [code("--read-only"), " ", code("--tmpfs …"), " ", code("--cap-drop=ALL"), " ", code("--security-opt=no-new-privileges")],
              "The container cannot change its own files or gain privileges.",
            ],
            [[code("--memory"), " ", code("--cpus"), " ", code("--pids-limit")], "Caps on the resources it can use (adjustable)."],
            [
              code("EASYNNV_TOKEN_SHA256"),
              "The fingerprint (SHA-256) of a random secret the page makes for this tab. The page sends the secret with every request and the runner checks it against the fingerprint. The secret itself never appears in the command, your shell history, the process list or the container.",
            ],
          ],
          "docs-defs-code",
        ),

        subhead("Runner interface"),
        defs(
          [
            [code("GET /status"), "Versions, available solvers, and whether a run is in progress. Each tab calls it regularly, which keeps the runner alive."],
            [
              code("POST /verify"),
              "The specification, networks (ONNX), datasets, parameters, property names, solver and time limit, as JSON. The reply streams Vehicle's output line by line, then the outcome (finished, timed out or cancelled).",
            ],
            [code("POST /shutdown"), "A tab is closing. Its secret and tab id are the body, since the browser cannot add headers to this message."],
          ],
          "docs-defs-code",
        ),
        p("The solver is named in each request, so more can be added without changing the interface."),
      ],
    },
  ];

  return docsPage({ header, sections, className: "docs-method docs-vehicle", tocDepth: 2 });
}
