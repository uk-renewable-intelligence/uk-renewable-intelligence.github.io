import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const output = resolve(root, "dist-static");
const [html, notFound, summary, projectIndex, projectDetails, sitemap, robots, verification, forecasting, forecastData, dataPage, datasetCsv, about, directory, challenger, driverRegistry] = await Promise.all([
  readFile(resolve(output, "index.html"), "utf8"),
  readFile(resolve(output, "404.html"), "utf8"),
  readFile(resolve(output, "dashboard-summary.json"), "utf8").then(JSON.parse),
  readFile(resolve(output, "projects-index.json"), "utf8").then(JSON.parse),
  readFile(resolve(output, "project-details.json"), "utf8").then(JSON.parse),
  readFile(resolve(output, "sitemap.xml"), "utf8"),
  readFile(resolve(output, "robots.txt"), "utf8"),
  readFile(resolve(output, "google66671dc9a2a42b9c.html"), "utf8"),
  readFile(resolve(output, "forecasting/index.html"), "utf8"),
  readFile(resolve(output, "forecast-data.json"), "utf8").then(JSON.parse),
  readFile(resolve(output, "data/index.html"), "utf8"),
  readFile(resolve(output, "uk-renewable-energy-projects.csv"), "utf8"),
  readFile(resolve(output, "about/index.html"), "utf8"),
  readFile(resolve(output, "projects/index.html"), "utf8"),
  readFile(resolve(output, "forecast-challenger.json"), "utf8").then(JSON.parse),
  readFile(resolve(output, "external-driver-registry.json"), "utf8").then(JSON.parse),
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

assert.match(html, /UK Renewable Energy Project Intelligence/);
assert.match(html, /<title>UK Renewable Energy Project Database &amp; Forecasting<\/title>/);
assert.match(html, /name="robots" content="index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1"/);
assert.match(html, /hreflang="en-GB"/);
assert.match(html, /property="og:site_name" content="UK Renewable Intelligence"/);
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
assert.match(html, /class="site-header-inner"/);
assert.match(html, /class="site-nav"/);
assert.match(html, /--page-width: min\(1560px, 95vw\)/);
assert.match(html, /\.site-header-inner \{[\s\S]*?gap: 24px;/);
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
assert.equal(summary.model.publicRelease.status, "ranking_only");
assert.equal(summary.model.publicRelease.version, "2.2");
assert.equal(summary.model.publicRelease.primaryModel, "empirical survival rank with AI tie-breaker");
assert.equal(summary.model.publicRelease.probabilityRelease, "withheld");
assert.ok(Math.abs(summary.model.rollingAudit.horizons["2"].rocAuc - 0.7911550869) < 1e-9);
assert.ok(challenger.horizons["2"].ranking_promotion_passed);
assert.ok(challenger.horizons["2"].latest_cohort.enriched_tiebreak.roc_auc > challenger.horizons["2"].latest_cohort.empirical_survival.roc_auc);
assert.ok(challenger.horizons["2"].latest_cohort.enriched_tiebreak.average_precision > challenger.horizons["2"].latest_cohort.empirical_survival.average_precision);
assert.ok(driverRegistry.drivers.length >= 12);
assert.equal(summary.model.rollingAudit.horizons["2"].promotionDecision, "ranking signal only");
assert.equal(summary.model.rollingAudit.horizons["5"].promotionDecision, "withheld");
assert.ok(summary.kpis.strongerSignalProjects > 0);
assert.ok(summary.groups.deliveryTechnology.length > 5);
const forecastIndex = projectIndex.filter((project) => project.has_forecast);
assert.equal(forecastIndex.length, 6_189);
assert.ok(forecastIndex.every((project) => Number.isFinite(Number(project.delivery_signal_score))));
assert.ok(new Set(forecastIndex.map((project) => project.delivery_signal_score)).size >= 95);
const coarseBuckets = new Map();
forecastIndex.forEach((project) => {
  const key = Number(project.prob_operational_2y);
  if (!coarseBuckets.has(key)) coarseBuckets.set(key, []);
  coarseBuckets.get(key).push(project.delivery_signal_score);
});
assert.ok([...coarseBuckets.values()].some((scores) => new Set(scores).size > 1), "AI tie-breaker should resolve at least one empirical-score tie");

for (let index = 0; index < sourceData.projects.length; index += 1) {
  const sourceProject = sourceData.projects[index];
  const rebuiltProject = { ...projectIndex[index], ...projectDetails[String(sourceProject.ref_id)] };
  assert.deepEqual(rebuiltProject, sourceProject, `Split data changed REPD ${sourceProject.ref_id}`);
}

const forecastProject = sourceData.projects.find((project) => project.has_forecast);
const permanentProject = await readFile(resolve(output, "projects", String(forecastProject.ref_id), "index.html"), "utf8");
assert.match(permanentProject, new RegExp(forecastProject.site_name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
assert.match(permanentProject, /Ranking signal only/);
assert.match(permanentProject, /official DESNZ Renewable Energy Planning Database/);
assert.match(permanentProject, /Project Evidence/);
assert.match(permanentProject, /Planning Timeline/);
assert.match(permanentProject, /Delivery Signal/);
assert.match(permanentProject, /Five-year output/);
assert.match(permanentProject, /Withheld/);
assert.doesNotMatch(permanentProject, /Within 5 years/);
assert.match(permanentProject, /On this page/);
assert.match(permanentProject, /class="page-hero"/);
assert.match(forecasting, /0\.791/);
assert.match(forecasting, /UK Renewable Delivery Outlook/);
assert.match(forecasting, /Project Delivery Rankings/);
assert.match(forecasting, /Delivery Scenario Lab/);
assert.match(forecasting, /Forecast Project Map/);
assert.match(forecasting, /Forecast Model Evidence/);
assert.match(forecasting, /External Driver Register/);
assert.match(forecasting, /Elexon Insights market-index price API/);
assert.match(forecasting, /Open forecast explorer/);
assert.match(forecasting, /Horizon Release Matrix/);
assert.match(forecasting, /Ranking &amp; Reliability Evidence/);
assert.match(forecasting, /Delivery-Signal Usage/);
assert.match(forecasting, /Temporal Validation Controls/);
assert.match(forecasting, /Macroeconomic &amp; Policy Scenarios/);
assert.doesNotMatch(forecasting, /Probability of what gets built/);
assert.match(forecasting, /class="page-hero"/);
assert.match(forecasting, /<title>UK Renewable Energy Forecasting &amp; Project Rankings<\/title>/);
assert.match(forecasting, /forecast-data\.json/);
assert.match(forecasting, /forecasting\.[a-f0-9]{10}\.js/);
assert.match(forecasting, /forecasting\.[a-f0-9]{10}\.css/);
assert.equal(forecastData.projects.length, 6_189);
assert.ok(forecastData.projects.every((project) => Number.isFinite(project.signal)));
assert.ok(forecastData.projects.every((project) => Number.isFinite(project.p2) && Number.isFinite(project.p3)));
assert.doesNotMatch(html, /Capacity × probability/);
assert.doesNotMatch(html, /risk-adjusted capacity expected/);
assert.match(html, /Probability release withheld/);
assert.match(html, /Portfolio delivery-conditions index/);
assert.match(html, /Electricity-price outlook/);
assert.match(html, /Construction &amp; materials shock/);
assert.match(html, /Developer market stress/);
assert.match(html, /scenario-drivers/);
assert.match(about, /Engineering portfolio case study/);
assert.match(about, /UK Renewable Intelligence Platform/);
assert.match(about, /Engineering Capabilities/);
assert.match(about, /Formula Student EV Test-Data Debrief/);
assert.match(about, /From test data to next investigation/);
assert.match(about, /https:\/\/imperial-fs-telemetry\.streamlit\.app\//);
assert.match(about, /class="page-hero"/);
assert.match(directory, /13,009 source-backed planning records/);
assert.match(directory, /<title>UK Renewable Energy Project Database \| Renewable Intelligence<\/title>/);
assert.match(directory, /class="page-hero"/);
assert.equal((directory.match(/class="pagination(?: pagination-top)?"/g) || []).length, 2);
assert.equal((directory.match(/aria-label="Project directory page 27"/g) || []).length, 2);
const contentAssetMatch = forecasting.match(/href="\/assets\/(content\.[a-f0-9]{10}\.css)"/);
assert.ok(contentAssetMatch, "Generated content pages should reference a fingerprinted stylesheet");
const contentStyles = await readFile(resolve(output, "assets", contentAssetMatch[1]), "utf8");
assert.match(contentStyles, /--page-width: min\(1560px, 95vw\)/);
assert.match(contentStyles, /\.status-pill \{[^}]*font-size: 11px;/);
assert.match(contentStyles, /@media \(max-width: 1050px\)[\s\S]*?\.status-pill \{ display: none; \}/);
assert.match(contentStyles, /@media \(max-width: 590px\)[\s\S]*?\.site-nav a \{ padding: 3px 9px 0; font-size: 10px;/);
assert.doesNotMatch(contentStyles, /min\(1120px, 92vw\)/);
assert.match(dataPage, /<h1>UK Renewable Energy Project Database<\/h1>/);
assert.match(dataPage, /class="active" aria-current="page" href="\/data\/">Data<\/a>/);
assert.match(dataPage, /Download project data \(CSV\)/);
assert.match(dataPage, /"@type":"Dataset"/);
assert.match(dataPage, /uk-renewable-energy-projects\.csv/);
assert.equal(datasetCsv.trim().split("\n").length, 13_010);
assert.match(datasetCsv.split("\n")[0], /"ref_id","site_name","operator","technology"/);
assert.equal((sitemap.match(/<url>/g) || []).length, 13_040);
assert.match(sitemap, /<loc>https:\/\/uk-renewable-intelligence\.github\.io\/data\/<\/loc><lastmod>2026-09-12<\/lastmod>/);
assert.match(sitemap, new RegExp(`<loc>https://uk-renewable-intelligence.github.io/projects/${forecastProject.ref_id}/</loc>`));
assert.match(robots, /Sitemap: https:\/\/uk-renewable-intelligence\.github\.io\/sitemap\.xml/);
assert.equal(verification.trim(), "google-site-verification: google66671dc9a2a42b9c.html");
assert.doesNotMatch(forecasting, /\/Users\/|wenpc/);

const [summarySize, indexSize, detailsSize, forecastSize] = await Promise.all([
  stat(resolve(output, "dashboard-summary.json")),
  stat(resolve(output, "projects-index.json")),
  stat(resolve(output, "project-details.json")),
  stat(resolve(output, "forecast-data.json")),
]);
assert.ok(summarySize.size < 500_000, "Overview payload should stay below 500 KB");
assert.ok(indexSize.size < 8_000_000, "Explorer payload should stay below 8 MB");
assert.ok(detailsSize.size < 4_000_000, "Lazy evidence payload should stay below 4 MB");
assert.ok(forecastSize.size < 5_000_000, "Forecast workbench payload should stay below 5 MB");

console.log(`Static dashboard smoke test passed: ${projectIndex.length.toLocaleString()} projects, all source fields retained`);
