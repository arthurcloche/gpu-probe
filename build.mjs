// build.mjs
// Produces:
//   dist/gpu-probe.js             (IIFE, readable)
//   dist/gpu-probe.min.js         (IIFE, minified)
//   dist/bookmarklet.js           (IIFE, minified, auto-runs)
//   dist/bookmarklet.url.txt      (javascript: URL ready to paste as a bookmark)
//
// Run: pnpm build           (or: pnpm dev for watch)

import * as esbuild from "esbuild";
import fs from "node:fs/promises";
import path from "node:path";

const watch = process.argv.includes("--watch");
const outdir = "dist";

const banner = `/* gpu-probe v0.2.0 — https://github.com/shopify-playground/gpu-probe */`;

await fs.mkdir(outdir, { recursive: true });

const commonLib = {
  entryPoints: ["src/index.js"],
  bundle: true,
  format: "iife",
  globalName: "__WGLA_LIB",
  target: ["es2020"],
  banner: { js: banner },
  logLevel: "info",
};

const commonBkm = {
  entryPoints: ["src/bookmarklet.js"],
  bundle: true,
  format: "iife",
  target: ["es2020"],
  logLevel: "info",
};

async function build() {
  // Library — readable
  await esbuild.build({
    ...commonLib,
    outfile: path.join(outdir, "gpu-probe.js"),
    minify: false,
  });

  // Library — minified
  await esbuild.build({
    ...commonLib,
    outfile: path.join(outdir, "gpu-probe.min.js"),
    minify: true,
  });

  // Bookmarklet — minified (self-contained, all code inlined)
  const bkmOut = path.join(outdir, "bookmarklet.js");
  await esbuild.build({
    ...commonBkm,
    outfile: bkmOut,
    minify: true,
  });

  // Build the `javascript:` URL: wrap in IIFE that injects via script tag if
  // small enough, otherwise inline. Inline is simpler and fits comfortably
  // for our size.
  const code = await fs.readFile(bkmOut, "utf8");
  // strip leading shebang/banner just in case
  const cleaned = code.replace(/^\/\*.*?\*\/\s*/s, "");
  const url =
    "javascript:" +
    encodeURIComponent(`(function(){${cleaned};void 0;})();`);
  await fs.writeFile(path.join(outdir, "bookmarklet.url.txt"), url);

  // Bookmarklet — CDN stub (tiny, fetches webgl-analyzer.min.js from jsDelivr)
  const bkmCdnOut = path.join(outdir, "bookmarklet-cdn.js");
  await esbuild.build({
    entryPoints: ["src/bookmarklet-cdn.js"],
    bundle: true,
    format: "iife",
    target: ["es2020"],
    outfile: bkmCdnOut,
    minify: true,
    logLevel: "info",
  });
  const cdnCode = (await fs.readFile(bkmCdnOut, "utf8")).replace(/^\/\*.*?\*\/\s*/s, "");
  const cdnUrl = "javascript:" + encodeURIComponent(cdnCode + ";void 0;");
  await fs.writeFile(path.join(outdir, "bookmarklet-cdn.url.txt"), cdnUrl);

  const stats = await Promise.all(
    [
      "gpu-probe.js",
      "gpu-probe.min.js",
      "bookmarklet.js",
      "bookmarklet.url.txt",
      "bookmarklet-cdn.js",
      "bookmarklet-cdn.url.txt",
    ].map(async (f) => {
      const p = path.join(outdir, f);
      const s = await fs.stat(p);
      return { f, size: s.size };
    })
  );
  console.log("\nbuild output:");
  for (const s of stats) {
    console.log(`  ${s.f.padEnd(28)} ${(s.size / 1024).toFixed(2)} kB`);
  }
}

if (watch) {
  const ctxLib = await esbuild.context({
    ...commonLib,
    outfile: path.join(outdir, "gpu-probe.js"),
  });
  const ctxBkm = await esbuild.context({
    ...commonBkm,
    outfile: path.join(outdir, "bookmarklet.js"),
    minify: true,
  });
  await ctxLib.watch();
  await ctxBkm.watch();
  console.log("watching…");
} else {
  await build();
}
