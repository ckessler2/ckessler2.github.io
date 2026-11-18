// Example specifications for Verify. Except for the tiny built-in one, the files are fetched on
// demand from Vehicle's own examples on GitHub, at a pinned commit; none are hosted here.

export const VEHICLE_REPO = "https://github.com/vehicle-lang/vehicle";
export const VEHICLE_COMMIT = "efd705dbdef17989a6cfee81346f14f9964a4a61";
const RAW = `https://raw.githubusercontent.com/vehicle-lang/vehicle/${VEHICLE_COMMIT}/examples/`;

/**
 * Each example: spec (path), networks {name: path}, datasets {name: path}, parameters {name: value},
 * properties (names to verify; default all). `local` examples come from this site.
 * Times are on a laptop-class machine with the runner image.
 */
export const EXAMPLES = [
  {
    id: "tiny",
    title: "Tiny ReLU network",
    detail: "Built in · 2 properties, 1 holds · about 1 s",
    local: true,
    spec: "./runner/example/spec.vcl",
    networks: { f: "./runner/example/model.onnx" },
  },
  {
    id: "wind",
    title: "Wind controller",
    detail: "Vehicle example · a controller stays safe · proved in seconds",
    folder: "windController",
    spec: "windController/windController.vcl",
    networks: { controller: "windController/controller.onnx" },
  },
  {
    id: "acas",
    title: "ACAS Xu, network 1_7",
    detail: "Vehicle example · property 3 has a counterexample (it is not meant for this network) · seconds; all 10 properties take many minutes",
    folder: "acasXu",
    spec: "acasXu/acasXu.vcl",
    networks: { acasXu: "acasXu/acasXu_1_7.onnx" },
    properties: ["property3"],
  },
  {
    id: "mnist",
    title: "MNIST robustness, 2 images",
    detail: "Vehicle example · ε = 0.005, datasets and a parameter · about 40 s",
    folder: "mnist-robustness",
    spec: "mnist-robustness/mnist-robustness.vcl",
    networks: { classifier: "mnist-robustness/mnist-classifier.onnx" },
    datasets: { trainingImages: "mnist-robustness/t2-images.idx", trainingLabels: "mnist-robustness/t2-labels.idx" },
    parameters: { epsilon: "0.005" },
  },
];

const urlOf = (example, path) => (example.local ? path : RAW + path);
export const sourceUrl = (example) =>
  example.local ? null : `${VEHICLE_REPO}/tree/${VEHICLE_COMMIT}/examples/${example.folder}`;

async function fetchOk(url, kind) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} ${response.statusText} for ${url}`);
  return kind === "text" ? response.text() : new Uint8Array(await response.arrayBuffer());
}

const fileName = (path) => path.split("/").pop();

/** Fetch every file of an example. Returns { specification, networks, datasets, parameters, properties }. */
export async function fetchExample(example) {
  const entries = (obj) => Object.entries(obj ?? {});
  const [specification, networks, datasets] = await Promise.all([
    fetchOk(urlOf(example, example.spec), "text"),
    Promise.all(
      entries(example.networks).map(async ([name, path]) => [
        name,
        { fileName: `${fileName(path)} (example)`, bytes: await fetchOk(urlOf(example, path), "bytes") },
      ]),
    ),
    Promise.all(
      entries(example.datasets).map(async ([name, path]) => [
        name,
        {
          fileName: `${fileName(path)} (example)`,
          bytes: await fetchOk(urlOf(example, path), "bytes"),
          extension: path.split(".").pop().toLowerCase(),
        },
      ]),
    ),
  ]);
  return {
    specification,
    networks: Object.fromEntries(networks),
    datasets: Object.fromEntries(datasets),
    parameters: { ...(example.parameters ?? {}) },
    properties: example.properties ?? null,
  };
}
