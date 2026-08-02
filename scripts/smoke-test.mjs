import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const output = resolve(root, "dist-static");
const [html, notFound, summary, projectIndex, projectDetails, sitemap, robots, forecasting, about, directory] = await Promise.all([
  readFile(resolve(output, "index.html"), "utf8"),
  readFile(resolve(output, "404.html"), "utf8"),
  readFile(resolve(output, "dashboard-summary.json"), "utf8").then(JSON.parse),
  readFile(resolve(output, "projects-index.json"), "utf8").then(JSON.parse),
  readFile(resolve(output, "project-details.json"), "utf8").then(JSON.parse),
  readFile(resolve(output, "sitemap.xml"), "utf8"),
  readFile(resolve(output, "robots.txt"), "utf8"),
  readFile(resolve(output, "forecasting/index.html"), "utf8"),
  readFile(resolve(output, "about/index.html"), "utf8"),
  readFile(resolve(output, "projects/index.html"), "utf8"),
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
assert.match(html, /application\/ld\+json/);
assert.match(html, /Browse the permanent project directory/);
assert.match(html, /Open permanent page/);
assert.match(html, /Renewable Intelligence Workflow/);
assert.match(html, /Primary navigation/);
assert.match(html, /class="topbar-inner"/);
assert.match(html, /--page-width: min\(1560px, 95vw\)/);
assert.match(html, /\.topbar-inner \{[\s\S]*?gap: 24px;/);
assert.match(html, /\.status-pill \{[^}]*font-size: 11px;/);
assert.match(html, /Screening Workbench/);
assert.match(html, /footer-grid/);
assert.match(html, /projects-index\.json/);
assert.match(html, /project-details\.json/);
assert.doesNotMatch(html, /dashboard-data\.json/);
assert.doesNotMatch(html, /__STRUCTURED_DATA__/);
assert.equal(notFound, html);

assert.equal(summary.kpis.datasetProjects, 13_009);
assert.equal(summary.kpis.forecastCoverage, 6_189);
assert.equal(summary.projects, undefined);
assert.equal(projectIndex.length, 13_009);
assert.equal(Object.keys(projectDetails).length, 13_009);
assert.equal(new Set(projectIndex.map((project) => String(project.ref_id))).size, 13_009);
assert.equal(summary.model.rollingAudit.horizons["2"].testRows, 4_019);
assert.equal(summary.model.rollingAudit.horizons["5"].promotionDecision, "retain published baseline");

for (let index = 0; index < sourceData.projects.length; index += 1) {
  const sourceProject = sourceData.projects[index];
  const rebuiltProject = { ...projectIndex[index], ...projectDetails[String(sourceProject.ref_id)] };
  assert.deepEqual(rebuiltProject, sourceProject, `Split data changed REPD ${sourceProject.ref_id}`);
}

const forecastProject = sourceData.projects.find((project) => project.has_forecast);
const permanentProject = await readFile(resolve(output, "projects", String(forecastProject.ref_id), "index.html"), "utf8");
assert.match(permanentProject, new RegExp(forecastProject.site_name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
assert.match(permanentProject, /Research-only estimate/);
assert.match(permanentProject, /official DESNZ Renewable Energy Planning Database/);
assert.match(permanentProject, /Project Evidence/);
assert.match(permanentProject, /Planning Timeline/);
assert.match(permanentProject, /Delivery Forecast/);
assert.match(permanentProject, /On this page/);
assert.match(forecasting, /Latest rolling-origin audit/);
assert.match(forecasting, /0\.767/);
assert.match(forecasting, /Renewable Project Delivery Forecasting/);
assert.match(forecasting, /Forecast-Horizon Performance/);
assert.match(forecasting, /Temporal Validation Controls/);
assert.match(forecasting, /Macroeconomic &amp; Policy Scenarios/);
assert.doesNotMatch(forecasting, /Probability of what gets built/);
assert.match(about, /Engineering portfolio case study/);
assert.match(about, /UK Renewable Intelligence Platform/);
assert.match(about, /Engineering Capabilities/);
assert.match(directory, /13,009 source-backed planning records/);
const contentAssetMatch = forecasting.match(/href="\/assets\/(content\.[a-f0-9]{10}\.css)"/);
assert.ok(contentAssetMatch, "Generated content pages should reference a fingerprinted stylesheet");
const contentStyles = await readFile(resolve(output, "assets", contentAssetMatch[1]), "utf8");
assert.match(contentStyles, /--page-width: min\(1560px, 95vw\)/);
assert.match(contentStyles, /\.status-pill \{[^}]*font-size: 11px;/);
assert.match(contentStyles, /@media \(max-width: 1050px\)[\s\S]*?\.status-pill \{ display: none; \}/);
assert.doesNotMatch(contentStyles, /min\(1120px, 92vw\)/);
assert.equal((sitemap.match(/<url>/g) || []).length, 13_039);
assert.match(sitemap, new RegExp(`<loc>https://uk-renewable-intelligence.github.io/projects/${forecastProject.ref_id}/</loc>`));
assert.match(robots, /Sitemap: https:\/\/uk-renewable-intelligence\.github\.io\/sitemap\.xml/);
assert.doesNotMatch(forecasting, /\/Users\/|wenpc/);

const [summarySize, indexSize, detailsSize] = await Promise.all([
  stat(resolve(output, "dashboard-summary.json")),
  stat(resolve(output, "projects-index.json")),
  stat(resolve(output, "project-details.json")),
]);
assert.ok(summarySize.size < 500_000, "Overview payload should stay below 500 KB");
assert.ok(indexSize.size < 8_000_000, "Explorer payload should stay below 8 MB");
assert.ok(detailsSize.size < 4_000_000, "Lazy evidence payload should stay below 4 MB");

console.log(`Static dashboard smoke test passed: ${projectIndex.length.toLocaleString()} projects, all source fields retained`);
