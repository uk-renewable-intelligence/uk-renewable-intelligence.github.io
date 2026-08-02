import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const output = resolve(process.env.STATIC_OUT || resolve(root, "dist-static"));
const publicOrigin = "https://uk-renewable-intelligence.github.io";

const [template, styles, app] = await Promise.all([
  readFile(resolve(root, "src/index.html"), "utf8"),
  readFile(resolve(root, "src/styles.css"), "utf8"),
  readFile(resolve(root, "src/app.js"), "utf8"),
]);

let sourceData;
try {
  sourceData = JSON.parse(await readFile(resolve(root, "src/dashboard-data.json"), "utf8"));
} catch (error) {
  if (error.code !== "ENOENT") throw error;
  const [publishedSummary, publishedIndex, publishedDetails] = await Promise.all([
    readFile(resolve(root, "dashboard-summary.json"), "utf8").then(JSON.parse),
    readFile(resolve(root, "projects-index.json"), "utf8").then(JSON.parse),
    readFile(resolve(root, "project-details.json"), "utf8").then(JSON.parse),
  ]);
  sourceData = {
    ...publishedSummary,
    projects: publishedIndex.map((project) => ({
      ...project,
      ...publishedDetails[String(project.ref_id)],
    })),
  };
}
const { projects, ...summary } = sourceData;
const detailFields = new Set([
  "planning_submitted",
  "planning_granted",
  "under_construction",
  "operational",
  "record_updated",
  "cfd_round",
  "positive_factors",
  "risk_factors",
]);
const projectIndex = projects.map((project) => Object.fromEntries(
  Object.entries(project).filter(([key]) => !detailFields.has(key))
));
const projectDetails = Object.fromEntries(projects.map((project) => [
  String(project.ref_id),
  Object.fromEntries(Object.entries(project).filter(([key]) => key === "ref_id" || detailFields.has(key))),
]));

const html = template
  .replace("/*__STYLES__*/", styles)
  .replace("/*__DATA__*/", "window.DASHBOARD_SUMMARY=null;")
  .replace("/*__APP__*/", app)
  .replaceAll("__ORIGIN__", publicOrigin);

const copyAsset = async (sourcePath, publishedPath, destination) => {
  try {
    await copyFile(resolve(root, sourcePath), destination);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    await copyFile(resolve(root, publishedPath), destination);
  }
};

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await Promise.all([
  writeFile(resolve(output, "index.html"), html),
  writeFile(resolve(output, "404.html"), html),
  writeFile(resolve(output, "dashboard-summary.json"), JSON.stringify(summary)),
  writeFile(resolve(output, "projects-index.json"), JSON.stringify(projectIndex)),
  writeFile(resolve(output, "project-details.json"), JSON.stringify(projectDetails)),
  writeFile(resolve(output, ".nojekyll"), ""),
  copyAsset("public/og-v3.png", "og.png", resolve(output, "og.png")),
  copyAsset("public/favicon.svg", "favicon.svg", resolve(output, "favicon.svg")),
]);

console.log(`Built static dashboard at ${output}`);
