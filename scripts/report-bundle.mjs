import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { gzipSync } from "node:zlib";

const dist = path.resolve(process.argv[2] || "dist");
const manifest = JSON.parse(await readFile(path.join(dist, ".vite/manifest.json"), "utf8"));

// Follow only static dependencies. Dynamic imports are fetched on interaction,
// not on first render. Include the selected route as well as the app shell.
function dependencies(entries) {
  const visited = new Set();
  const files = new Set();
  function visit(key) {
    if (visited.has(key)) return;
    visited.add(key);
    const chunk = manifest[key];
    if (!chunk) throw new Error(`Missing build entry: ${key}`);
    files.add(chunk.file);
    for (const css of chunk.css || []) files.add(css);
    for (const dependency of chunk.imports || []) visit(dependency);
  }
  entries.forEach(visit);
  return files;
}

async function size(files) {
  let bytes = 0, gzip = 0;
  for (const file of files) {
    const body = await readFile(path.join(dist, file));
    bytes += body.length;
    gzip += gzipSync(body).length;
  }
  return { files: files.size, bytes, gzip };
}

const routes = {
  workbench: "src/features/workbench/WorkbenchPage.tsx",
  archive: "src/features/workbench/OrdersArchive.tsx",
  technician: "src/features/dispatch/DispatchPage.tsx",
  signature: "src/features/signature/CustomerSignaturePage.tsx",
  supplier: "src/features/procurement/SupplierPortalPage.tsx"
};
const report = {};
const budgets={workbench:450000,signature:225273,supplier:391483};
for (const [name, entry] of Object.entries(routes)) {
  const files = dependencies(["index.html", entry,...(name==="workbench"?[routes.archive]:[])]);
  report[name] = await size(files);
  if(budgets[name]&&report[name].gzip>budgets[name])throw new Error(`${name} gzip ${report[name].gzip} exceeds budget ${budgets[name]}`);
  if ([...files].some(file => /\/(?:PrintPreview|createPrintPdf|WorkerLoadChart|CreateVehicleReferenceButton)-/.test(file))) {
    throw new Error(`${name} eagerly loads an interaction-only feature`);
  }
}
const assets = await readdir(path.join(dist, "assets"));
if (assets.some(file => file.endsWith(".woff"))) throw new Error("Duplicate WOFF font fallback in build");
report.assets = { files: assets.length, bytes: 0 };
for (const file of assets) report.assets.bytes += (await stat(path.join(dist, "assets", file))).size;
console.log(JSON.stringify(report, null, 2));
console.log("Route sizes include the app shell and static JS/CSS dependencies; gzip is an estimate, not measured network traffic. Font downloads, APIs, images and later interactions are excluded from route sizes.");
