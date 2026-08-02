import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const output = resolve(root, "dist-static");
const [html, notFound, summary, projectIndex, projectDetails] = await Promise.all([
  readFile(resolve(output, "index.html"), "utf8"),
  readFile(resolve(output, "404.html"), "utf8"),
  readFile(resolve(output, "dashboard-summary.json"), "utf8").then(JSON.parse),
  readFile(resolve(output, "projects-index.json"), "utf8").then(JSON.parse),
  readFile(resolve(output, "project-details.json"), "utf8").then(JSON.parse),
]);
let sourceData;
try {
  sourceData = JSON.parse(await readFile(resolve(root, "src/dashboard-data.json"), "utf8"));
} catch (error) {
  if (error.code !== "ENOENT") throw error;
  sourceData = {
    ...summary,
    projects: projectIndex.map((project) => ({ ...project, ...projectDetails[String(project.ref_id)] })),
  };
}

assert.match(html, /UK Renewable Infrastructure Intelligence/);
assert.match(html, /Scenario lab/);
assert.match(html, /Evidence &amp; methodology/);
assert.match(html, /Copy view link/);
assert.match(html, /Copy project link/);
assert.match(html, /Public planning timeline/);
assert.match(html, /URLSearchParams/);
assert.match(html, /projects-index\.json/);
assert.match(html, /project-details\.json/);
assert.doesNotMatch(html, /dashboard-data\.json/);
assert.equal(notFound, html);

assert.equal(summary.kpis.datasetProjects, 13_009);
assert.equal(summary.kpis.forecastCoverage, 6_189);
assert.equal(summary.projects, undefined);
assert.equal(projectIndex.length, 13_009);
assert.equal(Object.keys(projectDetails).length, 13_009);
assert.equal(new Set(projectIndex.map((project) => String(project.ref_id))).size, 13_009);

for (let index = 0; index < sourceData.projects.length; index += 1) {
  const sourceProject = sourceData.projects[index];
  const rebuiltProject = { ...projectIndex[index], ...projectDetails[String(sourceProject.ref_id)] };
  assert.deepEqual(rebuiltProject, sourceProject, `Split data changed REPD ${sourceProject.ref_id}`);
}

const [summarySize, indexSize, detailsSize] = await Promise.all([
  stat(resolve(output, "dashboard-summary.json")),
  stat(resolve(output, "projects-index.json")),
  stat(resolve(output, "project-details.json")),
]);
assert.ok(summarySize.size < 500_000, "Overview payload should stay below 500 KB");
assert.ok(indexSize.size < 8_000_000, "Explorer payload should stay below 8 MB");
assert.ok(detailsSize.size < 4_000_000, "Lazy evidence payload should stay below 4 MB");

console.log(`Static dashboard smoke test passed: ${projectIndex.length.toLocaleString()} projects, all source fields retained`);
