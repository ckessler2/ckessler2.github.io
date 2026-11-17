// File picker that reads the chosen file as bytes. Files ending in .gz
// (VNN-COMP ships its benchmarks gzipped) are decompressed in the browser.

export async function readFileBytes(file) {
  const buffer = await file.arrayBuffer();
  let bytes = new Uint8Array(buffer);
  if (file.name.toLowerCase().endsWith(".gz")) {
    bytes = await gunzip(bytes);
  }
  return bytes;
}

export async function gunzip(bytes) {
  if (typeof DecompressionStream === "undefined") {
    throw new Error("This browser cannot decompress .gz files; please decompress it first.");
  }
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export function stripGz(name) {
  return name.replace(/\.gz$/i, "");
}

/** onFile(file), or onFile(files[]) when `multiple` is set. */
export function createFileInput({ accept, label, onFile, multiple = false }) {
  const row = document.createElement("div");
  row.className = "file-row";

  const input = document.createElement("input");
  input.type = "file";
  input.accept = accept;
  input.multiple = multiple;
  input.setAttribute("aria-label", label);
  input.addEventListener("change", async () => {
    const files = Array.from(input.files ?? []);
    if (!files.length) return;
    await onFile(multiple ? files : files[0]);
  });

  const heading = document.createElement("strong");
  heading.className = "file-row-label";
  heading.textContent = label;

  row.append(heading, input);
  return row;
}
