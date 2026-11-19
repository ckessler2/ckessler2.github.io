// Example specifications for Verify. Except for the tiny built-in one, they come from the Vehicle
// tutorial (https://vehicle-lang.github.io/tutorial/) and are fetched on demand from its repository
// on GitHub, at a pinned commit; none are hosted here.
//
// Paths point at real files, not the tutorial's symbolic links (GitHub serves a link as its
// target's path). Results and times were measured with the runner image (2 CPUs, 4 GB).

export const TUTORIAL_REPO = "https://github.com/vehicle-lang/vehicle-tutorial";
export const TUTORIAL_COMMIT = "f19f48d583a9a27b6d8a60a7b334793478b5e9a1";
const RAW = `https://raw.githubusercontent.com/vehicle-lang/vehicle-tutorial/${TUTORIAL_COMMIT}/`;

const chapter = (n) => `${TUTORIAL_REPO}/tree/${TUTORIAL_COMMIT}/chapter-${n}`;
const R = "resources-by-dataset/";
const FMNIST = "chapter-3/exercises/FMNIST/";
const PDT = "chapter-4/chapter-code/capucci-pdt/";
const ACAS2 = "chapter-4/solutions/acas2/";
const WIND = "chapter-5/";

/**
 * Groups of examples. Each example: spec (path), networks {name: path}, datasets {name: path or
 * {path, first}} (first: keep only the first n entries of an IDX file), parameters {name: value},
 * properties (names ticked; default all), timeout (s). `local` examples come from this site.
 */
export const EXAMPLE_GROUPS = [
  {
    title: "Built in",
    examples: [
      {
        id: "tiny",
        title: "Tiny ReLU network",
        detail: "2 properties, 1 holds · about 1 s",
        local: true,
        spec: "./runner/example/spec.vcl",
        networks: { f: "./runner/example/model.onnx" },
      },
    ],
  },
  {
    title: "Tutorial chapter 2: ACAS Xu",
    href: chapter(2),
    examples: [
      {
        id: "acas-p3",
        title: "ACAS Xu, property 3",
        detail: "Network 1_7 · counterexample (the property is not meant for this network) · seconds",
        spec: "chapter-2/chapter-code/acasXu.vcl",
        networks: { acasXu: `${R}acasXu/acasXu_1_7.onnx` },
      },
      {
        id: "iris",
        title: "Iris flower classifier (exercise 4)",
        detail: "Sample answers · 1 of 6 properties holds · seconds",
        spec: `${R}iris/iris-possible-answers.vcl`,
        networks: { iris: `${R}iris/iris_model.onnx` },
        // property0 only checks that the files load, and Vehicle 0.29 cannot compile it.
        properties: ["property1", "property2", "property3", "property4", "property5", "property6"],
      },
    ],
  },
  {
    title: "Tutorial chapter 3: MNIST robustness",
    href: chapter(3),
    examples: [
      {
        id: "mnist",
        title: "MNIST robustness, 2 images",
        detail: "ε = 0.005 · both robust · about 40 s",
        spec: `${R}mnist/mnist-robustness.vcl`,
        networks: { classifier: `${R}mnist/mnist-classifier.onnx` },
        datasets: { trainingImages: `${R}mnist/t2-images.idx`, trainingLabels: `${R}mnist/t2-labels.idx` },
        parameters: { epsilon: "0.005" },
      },
      {
        id: "mnist-scr",
        title: "Strong classification robustness (exercise 4)",
        detail: "Same network and images · both robust · about 5 s",
        spec: "chapter-3/solutions/mnist-robustness-scr.vcl",
        networks: { classifier: `${R}mnist/mnist-classifier.onnx` },
        datasets: { trainingImages: `${R}mnist/t2-images.idx`, trainingLabels: `${R}mnist/t2-labels.idx` },
        parameters: { epsilon: "0.005" },
      },
      {
        id: "fmnist",
        title: "Fashion-MNIST robustness, 10 images (exercise 7)",
        detail: "ε = 0.005 · all 10 robust · about 50 s",
        spec: `${FMNIST}fashionRobustness-solution.vcl`,
        networks: { classifier: `${FMNIST}fashion1l32n.onnx` },
        datasets: {
          trainingImages: { path: `${FMNIST}idxdata/0-49Images.idx`, first: 10 },
          trainingLabels: { path: `${FMNIST}idxdata/0-49Labels.idx`, first: 10 },
        },
        parameters: { epsilon: "0.005" },
      },
      {
        id: "hyperrec",
        title: "Robustness over a box of inputs (exercise 5 sample)",
        detail: "The box around 5 inputs · counterexample · seconds",
        spec: "chapter-3/solutions/hyperrec/spec.vcl",
        networks: { classifier: "chapter-3/solutions/hyperrec/adv.onnx" },
        datasets: { inputs: "chapter-3/solutions/hyperrec/5inputs.idx" },
      },
    ],
  },
  {
    title: "Tutorial chapter 4: before and after property-driven training",
    href: chapter(4),
    examples: [
      {
        id: "acas-shipped",
        title: "ACAS Xu network 1_8, as shipped",
        detail: "Properties 1, 3, 4, 9 · 1 of 4 holds · seconds (all 10 take hours)",
        spec: `${ACAS2}acasXu-upstream.vcl`,
        networks: { acasXu: `${ACAS2}acasXu_1_8.onnx` },
        properties: ["property1", "property3", "property4", "property9"],
      },
      {
        id: "acas-trained",
        title: "ACAS Xu network 1_8, after training",
        detail: "Same properties · all 4 hold · about 20 s",
        spec: `${ACAS2}acasXu-upstream.vcl`,
        networks: { acasXu: `${ACAS2}models/acasXu_1_8_cyc3reset_e30.onnx` },
        properties: ["property1", "property3", "property4", "property9"],
      },
      {
        id: "fmnist-vanilla",
        title: "Fashion-MNIST, trained the ordinary way",
        detail: "10 images, ε = 0.02 · 6 of 10 robust · about 2 min",
        spec: `${PDT}fashionRobustness-solution.vcl`,
        networks: { classifier: `${PDT}vanilla_e100.onnx` },
        datasets: {
          trainingImages: { path: `${PDT}0-49Images.idx`, first: 10 },
          trainingLabels: { path: `${PDT}0-49Labels.idx`, first: 10 },
        },
        parameters: { epsilon: "0.02" },
      },
      {
        id: "fmnist-pdt",
        title: "Fashion-MNIST, after property-driven training",
        detail: "Same images · 8 of 10 robust · about 3 min",
        spec: `${PDT}fashionRobustness-solution.vcl`,
        networks: { classifier: `${PDT}capucci-models-v028/capucci_v028_e10.onnx` },
        datasets: {
          trainingImages: { path: `${PDT}0-49Images.idx`, first: 10 },
          trainingLabels: { path: `${PDT}0-49Labels.idx`, first: 10 },
        },
        parameters: { epsilon: "0.02" },
      },
    ],
  },
  {
    title: "Tutorial chapter 5: wind controller",
    href: chapter(5),
    examples: [
      {
        id: "wind",
        title: "Wind controller",
        detail: "The car stays safe · proved · seconds",
        spec: `${WIND}chapter-code/windController.vcl`,
        networks: { controller: `${WIND}chapter-code/controller.onnx` },
      },
      {
        id: "wind-records",
        title: "Wind controller with records (exercise 3)",
        detail: "Same property, named fields instead of indices · proved · seconds",
        spec: `${WIND}solutions/windController-records-solution.vcl`,
        networks: { controller: `${WIND}chapter-code/controller.onnx` },
      },
      {
        id: "wind-centred",
        title: "Centred stability (exercise 4)",
        detail: "Adds sensorNearCenter · both proved · seconds",
        spec: `${WIND}solutions/windController-centred-stability-solution.vcl`,
        networks: { controller: `${WIND}chapter-code/controller.onnx` },
      },
      {
        id: "wind-parameters",
        title: "Stability with parameters (challenge)",
        detail: "Proved · set maxSpeed to 0.1 for a counterexample · seconds",
        spec: `${WIND}solutions/windController-parameterised-stability-solution.vcl`,
        networks: { controller: `${WIND}chapter-code/controller.onnx` },
        parameters: { maxDistance: "0.2", maxSensorChange: "0.2", maxSpeed: "0.5" },
      },
    ],
  },
];

export const EXAMPLES = EXAMPLE_GROUPS.flatMap((group) => group.examples);

const urlOf = (example, path) => (example.local ? path : RAW + path);

async function fetchOk(url, kind) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} ${response.statusText} for ${url}`);
  return kind === "text" ? response.text() : new Uint8Array(await response.arrayBuffer());
}

const fileName = (path) => path.split("/").pop();
const IDX_BYTES = { 0x08: 1, 0x09: 1, 0x0b: 2, 0x0c: 4, 0x0d: 4, 0x0e: 8 };

/** The first n entries of an IDX file (header: 0, 0, type, number of dimensions, then the sizes). */
export function firstEntries(bytes, n) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const size = IDX_BYTES[bytes[2]];
  const dims = bytes[3];
  if (view.getUint16(0) !== 0 || !size || dims < 1) throw new Error("not an IDX file");
  const header = 4 + 4 * dims;
  let entry = size;
  for (let d = 1; d < dims; d++) entry *= view.getUint32(4 + 4 * d);
  const count = Math.min(n, view.getUint32(4));
  const out = bytes.slice(0, header + entry * count);
  new DataView(out.buffer).setUint32(4, count);
  return out;
}

/** Fetch every file of an example. Returns { specification, networks, datasets, parameters, properties, timeout }. */
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
      entries(example.datasets).map(async ([name, source]) => {
        const { path, first } = typeof source === "string" ? { path: source } : source;
        let bytes = await fetchOk(urlOf(example, path), "bytes");
        if (first) bytes = firstEntries(bytes, first);
        const label = first ? `${fileName(path)}, first ${first} (example)` : `${fileName(path)} (example)`;
        return [name, { fileName: label, bytes, extension: path.split(".").pop().toLowerCase() }];
      }),
    ),
  ]);
  return {
    specification,
    networks: Object.fromEntries(networks),
    datasets: Object.fromEntries(datasets),
    parameters: { ...(example.parameters ?? {}) },
    properties: example.properties ?? null,
    timeout: example.timeout ?? null,
  };
}
