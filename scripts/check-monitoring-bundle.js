import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
for (const [entryFile, bundleFile] of [
  ["cdn-entry.js", "monitoring.min.js"],
  ["incident-recorder-entry.js", "incident-recorder.min.js"],
]) {
  const [buildResult, committedBundle] = await Promise.all([
    build({
      entryPoints: [path.join(projectRoot, "monitoring-sdk", entryFile)],
      bundle: true,
      minify: true,
      format: "iife",
      write: false,
    }),
    readFile(path.join(projectRoot, "public/monitoring/v1", bundleFile)),
  ]);

  if (
    buildResult.outputFiles.length !== 1 ||
    !Buffer.from(buildResult.outputFiles[0].contents).equals(committedBundle)
  ) {
    throw new Error(
      `The committed ${bundleFile} bundle is stale. Run npm run build:monitoring.`,
    );
  }
}

console.log("The committed v1 monitoring bundle matches its source.");
