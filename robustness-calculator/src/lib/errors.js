// Plain-language versions of the low-level errors users actually hit: a file
// that is not an ONNX model, and libraries blocked on their way from the CDN.

const LIBRARIES = [
  [/tfjs|tensorflow/i, "TensorFlow.js"],
  [/onnxruntime|ort[.-]/i, "onnxruntime"],
];

/**
 * { text, raw }: `text` is what to show; `raw` is the original message when
 * `text` replaces it (keep it available for bug reports), otherwise null.
 */
export function friendlyError(message) {
  const raw = String(message ?? "");
  if (/protobuf|Not an ONNX model/i.test(raw)) {
    return { text: "This doesn't look like an ONNX model file.", raw };
  }
  // Chrome: "Failed to fetch dynamically imported module: URL"; Firefox:
  // "error loading dynamically imported module: URL"; Safari: "Importing a module script failed."
  if (/dynamically imported module|Importing a module script failed/i.test(raw)) {
    const url = /https?:\/\/[^\s"')]+/.exec(raw)?.[0] ?? "";
    const lib = LIBRARIES.find(([re]) => re.test(url))?.[1] ?? "TensorFlow.js or onnxruntime";
    let host = "cdn.jsdelivr.net";
    try {
      if (url) host = new URL(url).host;
    } catch {
      /* keep the default */
    }
    return { text: `Couldn't load ${lib} from ${host} — check your network or ad-blocker.`, raw };
  }
  return { text: raw, raw: null };
}
