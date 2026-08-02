import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const output = resolve(process.env.STATIC_OUT || resolve(root, "dist-static"));
const publicOrigin = "https://uk-renewable-intelligence.github.io";
const repdSource = "https://www.gov.uk/government/publications/renewable-energy-planning-database-quarterly-extract";
const githubSource = "https://github.com/uk-renewable-intelligence/uk-renewable-intelligence.github.io";

const [template, styles, app, contentStyles, forecastAudit] = await Promise.all([
  readFile(resolve(root, "src/index.html"), "utf8"),
  readFile(resolve(root, "src/styles.css"), "utf8"),
  readFile(resolve(root, "src/app.js"), "utf8"),
  readFile(resolve(root, "src/content.css"), "utf8"),
  readFile(resolve(root, "analysis/forecast-audit.json"), "utf8").then(JSON.parse),
]);
const contentAssetName = `content.${createHash("sha256").update(contentStyles).digest("hex").slice(0, 10)}.css`;

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

const { projects, ...sourceSummary } = sourceData;
const summary = {
  ...sourceSummary,
  model: {
    ...sourceSummary.model,
    rollingAudit: {
      overallDecision: forecastAudit.overall_decision,
      promotionRule: forecastAudit.promotion_rule,
      latestSnapshot: forecastAudit.latest_snapshot,
      horizons: Object.fromEntries(Object.entries(forecastAudit.horizons).map(([horizon, result]) => [
        horizon,
        {
          testCohort: result.test_cohort,
          testRows: result.uncalibrated.rows,
          events: result.uncalibrated.events,
          rocAuc: result.uncalibrated.roc_auc,
          rawBrier: result.uncalibrated.brier_score,
          calibratedBrier: result.platt_calibrated.brier_score,
          baseRateBrier: result.historical_base_rate.brier_score,
          brierSkillVsBaseRate: result.brier_skill_vs_base_rate,
          promotionDecision: result.promotion_decision,
        },
      ])),
    },
  },
};

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

const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;",
}[character]));
const escapeXml = (value) => escapeHtml(value);
const safeValue = (value, fallback = "Not reported") => (
  value === null || value === undefined || String(value).trim() === "" ? fallback : String(value)
);
const formatNumber = (value, maximumFractionDigits = 0) => new Intl.NumberFormat("en-GB", { maximumFractionDigits }).format(Number(value) || 0);
const formatMw = (value) => `${formatNumber(value, 1)} MW`;
const formatPercent = (value) => Number.isFinite(Number(value)) ? `${(100 * Number(value)).toFixed(1)}%` : "Not modelled";
const formatDate = (value) => {
  if (!value) return "Not reported";
  const parts = String(value).split("/");
  const date = parts.length === 3
    ? new Date(`${parts[2]}-${parts[1]}-${parts[0]}T12:00:00Z`)
    : new Date(/^\d{4}-\d{2}-\d{2}$/.test(String(value)) ? `${value}T12:00:00Z` : value);
  return Number.isNaN(date.valueOf())
    ? String(value)
    : date.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
};
const jsonLd = (value) => JSON.stringify(value).replaceAll("<", "\\u003c");
const projectPath = (project) => `/projects/${encodeURIComponent(String(project.ref_id))}/`;
const projectUrl = (project) => `${publicOrigin}${projectPath(project)}`;
const splitFactors = (value) => safeValue(value, "").split(/\s*·\s*|[;|]/).map((item) => item.trim()).filter(Boolean);

const headerMarkup = (canonicalPath) => {
  const activePage = canonicalPath.startsWith("/projects/")
    ? "projects"
    : canonicalPath.startsWith("/forecasting/")
      ? "forecasting"
      : canonicalPath.startsWith("/about/")
        ? "about"
        : "dashboard";
  const navItem = (key, href, label) => `<a${activePage === key ? ' class="active" aria-current="page"' : ""} href="${href}">${label}</a>`;
  return `
  <header class="site-header">
    <div class="site-header-inner">
      <a class="brand" href="/" aria-label="UK Renewable Infrastructure Intelligence home"><span class="brand-mark">UK</span><span>Renewable Intelligence</span></a>
      <nav class="site-nav" aria-label="Primary navigation">${navItem("dashboard", "/", "Dashboard")}${navItem("projects", "/projects/", "Projects")}${navItem("forecasting", "/forecasting/", "Forecasting")}${navItem("about", "/about/", "About")}</nav>
      <span class="status-pill"><span></span>Public beta · Model v2.0</span>
    </div>
  </header>`;
};
const footer = `
  <footer class="site-footer">
    <div class="footer-grid">
      <div class="footer-brand"><a class="brand" href="/"><span class="brand-mark">UK</span><span>Renewable Intelligence</span></a><p>Open UK renewable-project intelligence for planning evidence, screening and delivery research.</p></div>
      <nav class="footer-column" aria-label="Platform links"><strong>Platform</strong><a href="/">Dashboard</a><a href="/#projects">Project Explorer</a><a href="/#workbench">Screening Workbench</a><a href="/#scenario">Scenario Analysis</a></nav>
      <nav class="footer-column" aria-label="Research links"><strong>Research</strong><a href="/forecasting/">Forecasting</a><a href="/projects/">Project Directory</a><a href="/about/">About</a><a href="${repdSource}">Official REPD Source ↗</a></nav>
      <nav class="footer-column" aria-label="Development links"><strong>Development</strong><a href="${githubSource}">Source Code ↗</a><a href="https://uk-renewable-project-screening.streamlit.app/">Modelling Workspace ↗</a></nav>
    </div>
    <div class="footer-bottom"><span>Designed and engineered by HJ Nakamura · Mechanical Engineering, Imperial College London</span><span>Model v2.0 · Research only · Not investment advice</span></div>
  </footer>`;

function pageShell({ title, description, canonicalPath, body, structuredData }) {
  const canonical = `${publicOrigin}${canonicalPath}`;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link rel="stylesheet" href="/assets/${contentAssetName}">
  <link rel="canonical" href="${canonical}">
  <meta name="description" content="${escapeHtml(description)}">
  <meta name="theme-color" content="#102633">
  <meta property="og:title" content="${escapeHtml(title)}">
  <meta property="og:description" content="${escapeHtml(description)}">
  <meta property="og:url" content="${canonical}">
  <meta property="og:image" content="${publicOrigin}/og.png">
  <meta name="twitter:card" content="summary_large_image">
  <title>${escapeHtml(title)}</title>
  <script type="application/ld+json">${jsonLd(structuredData)}</script>
</head>
<body>${headerMarkup(canonicalPath)}<main class="content-shell">${body}</main>${footer}</body>
</html>`;
}

const homeStructuredData = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "WebSite",
      "@id": `${publicOrigin}/#website`,
      name: "UK Renewable Infrastructure Intelligence",
      url: `${publicOrigin}/`,
      description: "Searchable UK renewable project intelligence with planning evidence, screening tools and research forecasts.",
      inLanguage: "en-GB",
    },
    {
      "@type": "Dataset",
      "@id": `${publicOrigin}/#dataset`,
      name: "UK Renewable Infrastructure Intelligence project snapshot",
      description: "A searchable snapshot of UK renewable infrastructure planning records, enriched with screening scores and research time-to-operation forecasts.",
      url: `${publicOrigin}/`,
      isBasedOn: repdSource,
      isAccessibleForFree: true,
      temporalCoverage: `2019-09-25/${summary.latestSnapshot}`,
      spatialCoverage: "United Kingdom",
      version: summary.latestSnapshot,
      keywords: "UK renewable energy projects, REPD, planning pipeline, offshore wind, solar, battery storage, project forecasting",
      variableMeasured: ["Installed capacity", "Planning stage", "Technology", "Location", "Time-to-operation probability"],
      distribution: {
        "@type": "DataDownload",
        contentUrl: `${publicOrigin}/projects-index.json`,
        encodingFormat: "application/json",
      },
    },
  ],
};

const html = template
  .replace("/*__STYLES__*/", styles)
  .replace("/*__DATA__*/", "window.DASHBOARD_SUMMARY=null;")
  .replace("/*__APP__*/", app)
  .replace("__STRUCTURED_DATA__", jsonLd(homeStructuredData))
  .replaceAll("__ORIGIN__", publicOrigin);

function projectStructuredData(project) {
  const properties = [
    ["Technology", project.technology],
    ["Capacity", Number.isFinite(Number(project.capacity_mw)) ? formatMw(project.capacity_mw) : null],
    ["Development stage", project.stage],
    ["Operator or applicant", project.operator],
    ["Planning authority", project.planning_authority],
    ["Planning reference", project.planning_reference],
  ].filter(([, value]) => value && value !== "Not reported").map(([name, value]) => ({ "@type": "PropertyValue", name, value }));
  const entity = {
    "@type": "Thing",
    name: safeValue(project.site_name, "Unnamed renewable project"),
    identifier: `REPD ${String(project.ref_id).padStart(5, "0")}`,
    additionalProperty: properties,
  };
  if (Number.isFinite(Number(project.latitude)) && Number.isFinite(Number(project.longitude))) {
    entity.geo = { "@type": "GeoCoordinates", latitude: Number(project.latitude), longitude: Number(project.longitude) };
  }
  return {
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "WebPage", "@id": `${projectUrl(project)}#page`, url: projectUrl(project), name: safeValue(project.site_name), about: entity, isPartOf: { "@id": `${publicOrigin}/#website` } },
      { "@type": "BreadcrumbList", itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: `${publicOrigin}/` },
        { "@type": "ListItem", position: 2, name: "Projects", item: `${publicOrigin}/projects/` },
        { "@type": "ListItem", position: 3, name: safeValue(project.site_name), item: projectUrl(project) },
      ] },
    ],
  };
}

function timelineMarkup(project) {
  const milestones = [
    ["Planning submitted", project.planning_submitted],
    ["Planning granted", project.planning_granted],
    ["Construction started", project.under_construction],
    ["Became operational", project.operational],
    ["Latest public record", project.record_updated],
  ].filter(([, date]) => date);
  return milestones.length
    ? `<ul class="timeline">${milestones.map(([label, date]) => `<li><strong>${escapeHtml(label)}</strong><time>${escapeHtml(formatDate(date))}</time></li>`).join("")}</ul>`
    : `<p class="note">No dated planning milestones are reported for this record.</p>`;
}

function factorMarkup(value, fallback) {
  const factors = splitFactors(value);
  return factors.length
    ? `<ul class="factor-list">${factors.map((factor) => `<li>${escapeHtml(factor)}</li>`).join("")}</ul>`
    : `<p class="note">${escapeHtml(fallback)}</p>`;
}

function projectPage(project) {
  const name = safeValue(project.site_name, "Unnamed renewable project");
  const description = `${name}: ${formatMw(project.capacity_mw)} ${safeValue(project.technology, "renewable energy")} project in ${safeValue(project.region, "the UK")}. Planning evidence, status and research forecast.`;
  const forecast = project.has_forecast ? `
    <div class="forecast-strip">
      <div><span>Within 2 years</span><strong>${formatPercent(project.prob_operational_2y)}</strong></div>
      <div><span>Within 3 years</span><strong>${formatPercent(project.prob_operational_3y)}</strong></div>
      <div><span>Within 5 years</span><strong>${formatPercent(project.prob_operational_5y)}</strong></div>
    </div>
    <span class="status watch">Research-only estimate · ${escapeHtml(safeValue(project.forecast_confidence, "Limited"))} public-data coverage</span>
    <p class="note">Probabilities come from the published empirical survival baseline. They are screening estimates, not investment advice. Horizon-specific validation is available on the forecasting page.</p>`
    : `<p class="note">This planning record is outside the current active forecast universe. Its public project evidence remains searchable and comparable.</p>`;

  const body = `
    <nav class="breadcrumb" aria-label="Breadcrumb"><a href="/">Home</a> / <a href="/projects/">Projects</a> / REPD ${escapeHtml(String(project.ref_id).padStart(5, "0"))}</nav>
    <p class="eyebrow">UK renewable project intelligence · REPD ${escapeHtml(String(project.ref_id).padStart(5, "0"))}</p>
    <h1>${escapeHtml(name)}</h1>
    <p class="lede">${escapeHtml(safeValue(project.operator, "Developer not reported"))} · ${escapeHtml(safeValue(project.technology))} · ${escapeHtml(safeValue(project.region))}</p>
    <div class="actions"><a class="button primary" href="/?project=${encodeURIComponent(String(project.ref_id))}#projects">Open in interactive explorer</a><a class="button secondary" href="/forecasting/">How forecasting works</a></div>
    <nav class="page-jump" aria-label="Project page sections"><span>On this page</span><a href="#project-evidence">Evidence</a><a href="#planning-timeline">Timeline</a><a href="#delivery-forecast">Forecast</a><a href="#project-signals">Signals</a></nav>
    <div class="grid" aria-label="Project summary">
      <article class="card metric-card span-4"><span>Reported capacity</span><strong>${formatMw(project.capacity_mw)}</strong><small>Installed Capacity (MWelec) in the public REPD record</small></article>
      <article class="card metric-card span-4"><span>Development stage</span><strong>${escapeHtml(safeValue(project.stage))}</strong><small>Current short status in the latest source snapshot</small></article>
      <article class="card metric-card span-4"><span>Screening score</span><strong>${formatNumber(project.screening_score)}/100</strong><small>${escapeHtml(safeValue(project.screening_risk, "Unknown"))} heuristic screening risk</small></article>
    </div>
    <section class="section" id="project-evidence"><div class="section-heading"><div><p class="eyebrow">Planning record</p><h2>Project Evidence</h2></div><p>Source fields are retained from the latest UK Renewable Energy Planning Database snapshot.</p></div>
      <div class="fact-grid">
        <div><span>Technology</span><strong>${escapeHtml(safeValue(project.technology))}</strong></div>
        <div><span>Operator or applicant</span><strong>${escapeHtml(safeValue(project.operator))}</strong></div>
        <div><span>Region</span><strong>${escapeHtml(safeValue(project.region))}</strong></div>
        <div><span>County</span><strong>${escapeHtml(safeValue(project.county))}</strong></div>
        <div><span>Country</span><strong>${escapeHtml(safeValue(project.country))}</strong></div>
        <div><span>Planning authority</span><strong>${escapeHtml(safeValue(project.planning_authority))}</strong></div>
        <div><span>Planning reference</span><strong>${escapeHtml(safeValue(project.planning_reference))}</strong></div>
        <div><span>CfD allocation round</span><strong>${escapeHtml(safeValue(project.cfd_round))}</strong></div>
      </div>
    </section>
    <section class="section" id="planning-timeline"><div class="section-heading"><div><p class="eyebrow">Planning history</p><h2>Planning Timeline</h2></div></div><article class="card">${timelineMarkup(project)}</article></section>
    <section class="section" id="delivery-forecast"><div class="section-heading"><div><p class="eyebrow">Time to operation</p><h2>Delivery Forecast</h2></div><p>Probability-weighted screening, validated on later time cohorts and kept explicitly separate from scenario assumptions.</p></div><article class="card">${forecast}</article></section>
    <section class="section" id="project-signals"><div class="grid"><article class="card span-6"><p class="eyebrow">Positive public evidence</p>${factorMarkup(project.positive_factors, "No additional positive signal is recorded.")}</article><article class="card span-6"><p class="eyebrow">Risks and missing evidence</p>${factorMarkup(project.risk_factors, "No additional public-data warning is recorded.")}</article></div></section>
    <section class="section source-box"><strong>Source and scope.</strong> Project facts derive from the <a href="${repdSource}">official DESNZ Renewable Energy Planning Database quarterly extract</a>. Forecasts and screening scores are research enrichments by this platform; public data does not reveal private finance, land, supply-chain or contract terms.</section>`;

  return pageShell({
    title: `${name} renewable project | UK Renewable Intelligence`,
    description,
    canonicalPath: projectPath(project),
    body,
    structuredData: projectStructuredData(project),
  });
}

const directoryProjects = [...projects].sort((a, b) => safeValue(a.site_name).localeCompare(safeValue(b.site_name), "en-GB"));
const directoryPageSize = 500;
const directoryPageCount = Math.ceil(directoryProjects.length / directoryPageSize);

function directoryPath(page) {
  return page === 1 ? "/projects/" : `/projects/page/${page}/`;
}

function directoryPage(page) {
  const start = (page - 1) * directoryPageSize;
  const pageProjects = directoryProjects.slice(start, start + directoryPageSize);
  const path = directoryPath(page);
  const body = `
    <nav class="breadcrumb" aria-label="Breadcrumb"><a href="/">Home</a> / Projects${page > 1 ? ` / Page ${page}` : ""}</nav>
    <p class="eyebrow">Permanent project directory · Page ${page} of ${directoryPageCount}</p>
    <h1>UK Renewable Project Directory</h1>
    <p class="lede">Browse ${formatNumber(projects.length)} source-backed planning records. Every project has a permanent, indexable page with its latest public status, capacity, planning authority and available research forecast.</p>
    <div class="actions"><a class="button primary" href="/#projects">Search and filter interactively</a><a class="button secondary" href="/forecasting/">Review forecast evidence</a></div>
    <section class="section"><ul class="directory-list">${pageProjects.map((project) => `
      <li><a href="${projectPath(project)}"><div><strong>${escapeHtml(safeValue(project.site_name, "Unnamed project"))}</strong><small>${escapeHtml(safeValue(project.technology))} · ${escapeHtml(safeValue(project.stage))} · ${formatMw(project.capacity_mw)}</small></div><span>View →</span></a></li>`).join("")}</ul>
      <nav class="pagination" aria-label="Project directory pages">${Array.from({ length: directoryPageCount }, (_, index) => index + 1).map((number) => number === page ? `<span aria-current="page">${number}</span>` : `<a href="${directoryPath(number)}" aria-label="Project directory page ${number}">${number}</a>`).join("")}</nav>
    </section>`;
  return pageShell({
    title: `UK renewable project directory${page > 1 ? ` – page ${page}` : ""} | UK Renewable Intelligence`,
    description: `Browse UK renewable energy planning projects, capacities, technologies, development stages and time-to-operation research forecasts. Page ${page} of ${directoryPageCount}.`,
    canonicalPath: path,
    body,
    structuredData: {
      "@context": "https://schema.org",
      "@type": "CollectionPage",
      name: "UK renewable project directory",
      url: `${publicOrigin}${path}`,
      isPartOf: { "@id": `${publicOrigin}/#website` },
      mainEntity: { "@type": "ItemList", itemListElement: pageProjects.map((project, index) => ({ "@type": "ListItem", position: start + index + 1, url: projectUrl(project), name: safeValue(project.site_name) })) },
    },
  });
}

const auditRows = Object.entries(forecastAudit.horizons).map(([horizon, result]) => `
  <tr><td>${horizon} years</td><td>${formatNumber(result.uncalibrated.rows)}</td><td>${formatNumber(result.uncalibrated.events)}</td><td class="numeric">${Number(result.uncalibrated.roc_auc).toFixed(3)}</td><td class="numeric">${Number(result.uncalibrated.brier_score).toFixed(4)}</td><td class="numeric">${Number(result.platt_calibrated.brier_score).toFixed(4)}</td><td class="numeric">${Number(result.historical_base_rate.brier_score).toFixed(4)}</td><td>${escapeHtml(result.promotion_decision)}</td></tr>`).join("");

const forecastingPage = pageShell({
  title: "Renewable Project Delivery Forecasting | UK Renewable Intelligence",
  description: "Leakage-aware, rolling-origin validation for UK renewable project time-to-operation forecasts, with calibration, Brier score and horizon-specific limitations.",
  canonicalPath: "/forecasting/",
  body: `
    <nav class="breadcrumb" aria-label="Breadcrumb"><a href="/">Home</a> / Forecasting</nav>
    <p class="eyebrow">Forecast methodology · Snapshot ${escapeHtml(formatDate(forecastAudit.latest_snapshot))}</p>
    <h1>Renewable Project Delivery Forecasting</h1>
    <p class="lede">The platform estimates whether a non-operational UK renewable project will reach operation within two, three or five years. Complex models receive no automatic advantage: every challenger must beat transparent baselines on later, fully observed time cohorts.</p>
    <div class="actions"><a class="button primary" href="/#projects">Explore project forecasts</a><a class="button secondary" href="${githubSource}/blob/main/analysis/forecast_audit.py">Inspect the audit code</a></div>
    <nav class="page-jump" aria-label="Forecasting page sections"><span>On this page</span><a href="#forecast-performance">Performance</a><a href="#validation-controls">Validation</a><a href="#external-scenarios">Scenarios</a><a href="#audit-decision">Decision</a></nav>
    <div class="grid">
      <article class="card metric-card span-4"><span>Historical panel</span><strong>${formatNumber(forecastAudit.panel_rows)}</strong><small>project-snapshot observations at one project × source date grain</small></article>
      <article class="card metric-card span-4"><span>Independent snapshots</span><strong>${formatNumber(forecastAudit.snapshots)}</strong><small>September 2019 to May 2026; the binding evidence constraint</small></article>
      <article class="card metric-card span-4"><span>Current decision</span><strong>Retain baseline</strong><small>No calibration challenger cleared the declared promotion threshold</small></article>
    </div>
    <section class="section" id="forecast-performance"><div class="section-heading"><div><p class="eyebrow">Latest rolling-origin audit</p><h2>Forecast-Horizon Performance</h2></div><p>ROC-AUC measures ranking (0.5 is random). Brier score measures probability error and is better when lower.</p></div>
      <article class="card table-scroll"><table class="audit-table"><thead><tr><th>Horizon</th><th>Test rows</th><th>Events</th><th>Raw AUC</th><th>Raw Brier</th><th>Calibrated</th><th>Base rate</th><th>Decision</th></tr></thead><tbody>${auditRows}</tbody></table></article>
      <p class="note">The two-year model shows useful discrimination on the latest fully observed cohort, but its calibrated Brier improvement over the constant historical base rate is only ${formatPercent(forecastAudit.horizons["2"].brier_skill_vs_base_rate)} of the base score—below the pre-declared 2% promotion requirement. Three- and five-year estimates remain more uncertain.</p>
    </section>
    <section class="section" id="validation-controls"><div class="section-heading"><div><p class="eyebrow">Leakage controls</p><h2>Temporal Validation Controls</h2></div></div><div class="grid">
      <article class="card span-6"><h3>Fully Observed Outcomes</h3><p class="note">An origin is evaluated only when the entire forecast horizon has elapsed. Unresolved recent projects are censored rather than labelled as failures.</p></article>
      <article class="card span-6"><h3>Project-Purged Temporal Splits</h3><p class="note">Test projects are removed from survival-training rows. Features such as developer track record count only information dated before the forecast origin.</p></article>
      <article class="card span-6"><h3>Calibration Governance</h3><p class="note">Log-odds, Platt and isotonic calibration are fitted on earlier out-of-time cohorts and tested on the latest complete cohort. They are not promoted using in-sample fit.</p></article>
      <article class="card span-6"><h3>Model Promotion Gate</h3><p class="note">CatBoost, logistic survival and calibration variants remain diagnostic challengers unless they improve temporal-holdout reliability by the published threshold.</p></article>
    </div></section>
    <section class="section" id="external-scenarios"><div class="section-heading"><div><p class="eyebrow">Politics, inflation and external conditions</p><h2>Macroeconomic &amp; Policy Scenarios</h2></div></div><article class="card"><p class="note">Bank Rate, construction-cost inflation, grid delay, policy support and CfD assumptions can materially change project delivery. However, ${formatNumber(forecastAudit.snapshots)} independent REPD dates are not enough to estimate credible political or macroeconomic coefficients. The dashboard therefore exposes these as bounded, editable stress assumptions in the <a href="/#scenario">Scenario Lab</a>, separate from the trained forecast. This avoids treating thousands of projects observed on the same date as thousands of independent macro observations.</p></article></section>
    <section class="section source-box" id="audit-decision"><strong>Audit decision.</strong> ${escapeHtml(forecastAudit.overall_decision)} The exact saved evidence is available in <a href="/forecast-audit.json">forecast-audit.json</a> and the reproducible Python companion in the public repository.</section>`,
  structuredData: {
    "@context": "https://schema.org",
    "@type": "TechArticle",
    headline: "UK renewable project forecasting methodology and validation",
    description: "Rolling-origin validation of research time-to-operation forecasts for UK renewable projects.",
    url: `${publicOrigin}/forecasting/`,
    dateModified: forecastAudit.latest_snapshot,
    isPartOf: { "@id": `${publicOrigin}/#website` },
  },
});

const aboutPage = pageShell({
  title: "About UK Renewable Infrastructure Intelligence",
  description: "An open engineering portfolio project that turns the UK Renewable Energy Planning Database into searchable project intelligence, mapping and leakage-aware forecasts.",
  canonicalPath: "/about/",
  body: `
    <nav class="breadcrumb" aria-label="Breadcrumb"><a href="/">Home</a> / About</nav>
    <p class="eyebrow">Engineering portfolio case study</p>
    <h1>UK Renewable Intelligence Platform</h1>
    <p class="lede">UK Renewable Infrastructure Intelligence is an open, public-data decision-support platform developed by HJ Nakamura, a Mechanical Engineering student at Imperial College London. It combines data engineering, geospatial analysis, probabilistic modelling and product design in one deployable system.</p>
    <div class="actions"><a class="button primary" href="${githubSource}">View source code</a><a class="button secondary" href="/#workbench">Open the engineering tools</a></div>
    <nav class="page-jump" aria-label="About page sections"><span>On this page</span><a href="#platform-purpose">Purpose</a><a href="#engineering-capabilities">Capabilities</a><a href="#responsible-use">Responsible Use</a></nav>
    <section class="section" id="platform-purpose"><div class="section-heading"><div><p class="eyebrow">Product thesis</p><h2>Platform Purpose</h2></div><p>The official REPD is the source of truth for public planning records. This platform adds the layer needed for screening: search, permanent evidence pages, comparable risk signals, maps, portfolios and research forecasts.</p></div><div class="grid">
      <article class="card metric-card span-4"><span>Planning records</span><strong>${formatNumber(summary.kpis.datasetProjects)}</strong><small>Complete current explorer snapshot</small></article>
      <article class="card metric-card span-4"><span>Linked forecasts</span><strong>${formatNumber(summary.kpis.forecastCoverage)}</strong><small>Active projects joined to the research forecast universe</small></article>
      <article class="card metric-card span-4"><span>Mapped records</span><strong>${formatNumber(projects.filter((project) => Number.isFinite(Number(project.latitude)) && Number.isFinite(Number(project.longitude))).length)}</strong><small>Valid coordinates in the public map workbench</small></article>
    </div></section>
    <section class="section" id="engineering-capabilities"><div class="section-heading"><div><p class="eyebrow">Engineering scope</p><h2>Engineering Capabilities</h2></div></div><div class="grid">
      <article class="card span-6"><h3>Data Engineering</h3><p class="note">Normalises irregular REPD releases into a project × snapshot panel, documents fallback entity keys, preserves source fields and validates duplicates, ranges and freshness.</p></article>
      <article class="card span-6"><h3>Forecast Governance</h3><p class="note">Uses right-censored survival targets, project-purged temporal holdouts, probability calibration challengers and explicit release gates instead of selecting the most impressive-looking model.</p></article>
      <article class="card span-6"><h3>Mechanical Engineering Context</h3><p class="note">Includes an offshore wind quick calculator for capacity factor, turbine count, CAPEX, revenue and displaced carbon, with visible techno-economic assumptions.</p></article>
      <article class="card span-6"><h3>Public Product Delivery</h3><p class="note">Runs as a static, accessible site with no account, no sleeping server, lazy project data, shareable explorer state, permanent project pages and automated integrity checks.</p></article>
    </div></section>
    <section class="section source-box" id="responsible-use"><strong>Responsible use.</strong> This is a research and early-stage screening tool, not investment advice. Public planning data cannot reveal private financing, land, supply-chain or contract terms. Methodology, limitations and code remain public so claims can be inspected.</section>`,
  structuredData: {
    "@context": "https://schema.org",
    "@type": "AboutPage",
    name: "About UK Renewable Infrastructure Intelligence",
    url: `${publicOrigin}/about/`,
    isPartOf: { "@id": `${publicOrigin}/#website` },
    about: { "@type": "SoftwareApplication", name: "UK Renewable Infrastructure Intelligence", applicationCategory: "BusinessApplication", operatingSystem: "Web", isAccessibleForFree: true },
  },
});

const staticUrls = ["/", "/projects/", "/forecasting/", "/about/", ...Array.from({ length: directoryPageCount - 1 }, (_, index) => directoryPath(index + 2))];
const sitemapUrls = [...staticUrls, ...projects.map(projectPath)];
const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${sitemapUrls.map((path) => `  <url><loc>${escapeXml(`${publicOrigin}${path}`)}</loc><lastmod>${escapeXml(summary.latestSnapshot)}</lastmod></url>`).join("\n")}\n</urlset>\n`;
const robots = `User-agent: *\nAllow: /\n\nSitemap: ${publicOrigin}/sitemap.xml\n`;

const copyAsset = async (sourcePath, publishedPath, destination) => {
  try {
    await copyFile(resolve(root, sourcePath), destination);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    await copyFile(resolve(root, publishedPath), destination);
  }
};

async function writeBatched(tasks, batchSize = 200) {
  for (let index = 0; index < tasks.length; index += batchSize) {
    await Promise.all(tasks.slice(index, index + batchSize).map((task) => task()));
  }
}

await rm(output, { recursive: true, force: true });
await mkdir(resolve(output, "assets"), { recursive: true });
await Promise.all([
  writeFile(resolve(output, "index.html"), html),
  writeFile(resolve(output, "404.html"), html),
  writeFile(resolve(output, "dashboard-summary.json"), JSON.stringify(summary)),
  writeFile(resolve(output, "projects-index.json"), JSON.stringify(projectIndex)),
  writeFile(resolve(output, "project-details.json"), JSON.stringify(projectDetails)),
  writeFile(resolve(output, "forecast-audit.json"), JSON.stringify(forecastAudit)),
  writeFile(resolve(output, "assets", contentAssetName), contentStyles),
  writeFile(resolve(output, "sitemap.xml"), sitemap),
  writeFile(resolve(output, "robots.txt"), robots),
  writeFile(resolve(output, ".nojekyll"), ""),
  copyAsset("public/og-v3.png", "og.png", resolve(output, "og.png")),
  copyAsset("public/favicon.svg", "favicon.svg", resolve(output, "favicon.svg")),
]);

await Promise.all([
  mkdir(resolve(output, "forecasting"), { recursive: true }).then(() => writeFile(resolve(output, "forecasting/index.html"), forecastingPage)),
  mkdir(resolve(output, "about"), { recursive: true }).then(() => writeFile(resolve(output, "about/index.html"), aboutPage)),
]);

await writeBatched(Array.from({ length: directoryPageCount }, (_, index) => () => {
  const page = index + 1;
  const directory = page === 1 ? resolve(output, "projects") : resolve(output, "projects/page", String(page));
  return mkdir(directory, { recursive: true }).then(() => writeFile(resolve(directory, "index.html"), directoryPage(page)));
}));

await writeBatched(projects.map((project) => () => {
  const directory = resolve(output, "projects", String(project.ref_id));
  return mkdir(directory, { recursive: true }).then(() => writeFile(resolve(directory, "index.html"), projectPage(project)));
}));

console.log(`Built static dashboard with ${projects.length.toLocaleString()} permanent project pages at ${output}`);
