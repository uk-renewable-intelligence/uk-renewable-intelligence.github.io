import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const output = resolve(process.env.STATIC_OUT || resolve(root, "dist-static"));
const publicOrigin = "https://uk-renewable-intelligence.github.io";
const repdSource = "https://www.gov.uk/government/publications/renewable-energy-planning-database-quarterly-extract";
const githubSource = "https://github.com/uk-renewable-intelligence/uk-renewable-intelligence.github.io";
const authorUrl = "https://github.com/hj-nakamura421";
const siteLastModified = "2026-09-12";
const publicDatasetCsv = "uk-renewable-energy-projects.csv";

const [template, styles, app, contentStyles, forecastingStyles, forecastingApp, forecastAudit, forecastChallenger, challengerScores, driverRegistry] = await Promise.all([
  readFile(resolve(root, "src/index.html"), "utf8"),
  readFile(resolve(root, "src/styles.css"), "utf8"),
  readFile(resolve(root, "src/app.js"), "utf8"),
  readFile(resolve(root, "src/content.css"), "utf8"),
  readFile(resolve(root, "src/forecasting.css"), "utf8"),
  readFile(resolve(root, "src/forecasting.js"), "utf8"),
  readFile(resolve(root, "analysis/forecast-audit.json"), "utf8").then(JSON.parse),
  readFile(resolve(root, "analysis/forecast-challenger.json"), "utf8").then(JSON.parse),
  readFile(resolve(root, "analysis/forecast-challenger-scores.json"), "utf8").then(JSON.parse),
  readFile(resolve(root, "analysis/external-driver-registry.json"), "utf8").then(JSON.parse),
]);
const contentAssetName = `content.${createHash("sha256").update(contentStyles).digest("hex").slice(0, 10)}.css`;
const forecastingStyleAssetName = `forecasting.${createHash("sha256").update(forecastingStyles).digest("hex").slice(0, 10)}.css`;
const forecastingAppAssetName = `forecasting.${createHash("sha256").update(forecastingApp).digest("hex").slice(0, 10)}.js`;

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

const forecastProjects = projects.filter((project) => (
  project.has_forecast && Number.isFinite(Number(project.prob_operational_2y))
));
const normaliseRefId = (value) => String(value ?? "").replace(/\.0$/, "").trim().padStart(5, "0");
const challengerScoreByRefId = new Map(challengerScores.map((row) => [
  normaliseRefId(row.ref_id),
  Number(row.richer_catboost_score),
]));
const projectsByProbability = new Map();
forecastProjects.forEach((project) => {
  const probability = Number(project.prob_operational_2y);
  if (!projectsByProbability.has(probability)) projectsByProbability.set(probability, []);
  projectsByProbability.get(probability).push(project);
});
const signalScoreByRefId = new Map();
let signalCursor = 0;
[...projectsByProbability.entries()].sort(([a], [b]) => a - b).forEach(([, group]) => {
  group.sort((a, b) => (
    (challengerScoreByRefId.get(normaliseRefId(a.ref_id)) ?? 0.5)
    - (challengerScoreByRefId.get(normaliseRefId(b.ref_id)) ?? 0.5)
  ));
  group.forEach((project, index) => {
    signalScoreByRefId.set(
      normaliseRefId(project.ref_id),
      Math.round(100 * (signalCursor + index + 1) / forecastProjects.length),
    );
  });
  signalCursor += group.length;
});
const deliverySignalScore = (project) => signalScoreByRefId.get(normaliseRefId(project.ref_id)) ?? null;
projects.forEach((project) => {
  project.delivery_signal_score = deliverySignalScore(project);
});
const deliverySignalBand = (project) => {
  const score = deliverySignalScore(project);
  if (score === null) return "Not available";
  if (score >= 75) return "Stronger";
  if (score >= 40) return "Typical";
  return "Lower";
};
const strongerSignalProjects = forecastProjects.filter((project) => deliverySignalBand(project) === "Stronger");
const deliveryTechnologyMap = new Map();
forecastProjects.forEach((project) => {
  const name = String(project.technology || "Unknown");
  if (!deliveryTechnologyMap.has(name)) {
    deliveryTechnologyMap.set(name, {
      name,
      forecast_projects: 0,
      stronger_signal_projects: 0,
      stronger_signal_capacity_mw: 0,
    });
  }
  const group = deliveryTechnologyMap.get(name);
  group.forecast_projects += 1;
  if (deliverySignalBand(project) === "Stronger") {
    group.stronger_signal_projects += 1;
    group.stronger_signal_capacity_mw += Number(project.capacity_mw) || 0;
  }
});
const deliveryTechnology = [...deliveryTechnologyMap.values()]
  .map((group) => ({
    ...group,
    stronger_signal_share: group.forecast_projects ? group.stronger_signal_projects / group.forecast_projects : 0,
  }))
  .sort((a, b) => b.stronger_signal_projects - a.stronger_signal_projects || b.forecast_projects - a.forecast_projects);

const summary = {
  ...sourceSummary,
  kpis: {
    ...sourceSummary.kpis,
    strongerSignalProjects: strongerSignalProjects.length,
    strongerSignalCapacityMw: Math.round(strongerSignalProjects.reduce(
      (sum, project) => sum + (Number(project.capacity_mw) || 0),
      0,
    )),
  },
  groups: {
    ...sourceSummary.groups,
    deliveryTechnology,
  },
  model: {
    ...sourceSummary.model,
    publicRelease: {
      version: "2.2",
      status: "ranking_only",
      primaryHorizonYears: 2,
      probabilityRelease: "withheld",
      fiveYearOutput: "withheld",
      scoreBuckets: new Set(forecastProjects.map(deliverySignalScore)).size,
      primaryModel: "empirical survival rank with AI tie-breaker",
      definition: "Percentile rank of the audited two-year empirical delivery score, with richer project evidence used only to order projects tied in the same empirical bucket.",
      challengerDecision: forecastChallenger.two_year_decision,
      challengerAuc: forecastChallenger.horizons["2"].latest_cohort.enriched_tiebreak.roc_auc,
      empiricalAuc: forecastChallenger.horizons["2"].latest_cohort.empirical_survival.roc_auc,
      challengerAveragePrecision: forecastChallenger.horizons["2"].latest_cohort.enriched_tiebreak.average_precision,
      empiricalAveragePrecision: forecastChallenger.horizons["2"].latest_cohort.empirical_survival.average_precision,
    },
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
          rocAuc: horizon === "2"
            ? forecastChallenger.horizons["2"].latest_cohort.enriched_tiebreak.roc_auc
            : result.uncalibrated.roc_auc,
          rawBrier: result.uncalibrated.brier_score,
          calibratedBrier: result.platt_calibrated.brier_score,
          baseRateBrier: result.historical_base_rate.brier_score,
          brierSkillVsBaseRate: result.brier_skill_vs_base_rate,
          predictionToObservedRatio: result.uncalibrated.mean_prediction / result.uncalibrated.event_rate,
          rawBrierPenaltyVsBaseRate: result.uncalibrated.brier_score / result.historical_base_rate.brier_score - 1,
          rollingCohorts: result.rolling_cohorts,
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
const forecastData = {
  generatedAt: summary.generatedAt,
  latestSnapshot: summary.latestSnapshot,
  modelVersion: summary.model.publicRelease.version,
  releaseStatus: summary.model.publicRelease.status,
  projects: forecastProjects.map((project) => ({
    ref_id: project.ref_id,
    site_name: project.site_name,
    operator: project.operator,
    technology: project.technology,
    region: project.region,
    stage: project.stage,
    capacity_mw: Number(project.capacity_mw) || 0,
    latitude: Number.isFinite(Number(project.latitude)) ? Number(project.latitude) : null,
    longitude: Number.isFinite(Number(project.longitude)) ? Number(project.longitude) : null,
    signal: deliverySignalScore(project),
    confidence: project.forecast_confidence,
    p2: Number(project.prob_operational_2y) || 0,
    p3: Number(project.prob_operational_3y) || 0,
  })),
};

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
const csvEscape = (value) => `"${String(value ?? "").replace(/\r?\n|\r/g, " ").replaceAll('"', '""')}"`;

const headerMarkup = (canonicalPath) => {
  const activePage = canonicalPath.startsWith("/projects/")
    ? "projects"
    : canonicalPath.startsWith("/forecasting/")
      ? "forecasting"
      : canonicalPath.startsWith("/data/")
        ? "data"
      : canonicalPath.startsWith("/about/")
        ? "about"
        : "dashboard";
  const navItem = (key, href, label) => `<a${activePage === key ? ' class="active" aria-current="page"' : ""} href="${href}">${label}</a>`;
  return `
  <header class="site-header">
    <div class="site-header-inner">
      <a class="brand" href="/" aria-label="UK Renewable Infrastructure Intelligence home"><span class="brand-mark">UK</span><span>Renewable Intelligence</span></a>
      <nav class="site-nav" aria-label="Primary navigation">${navItem("dashboard", "/", "Dashboard")}${navItem("projects", "/projects/", "Projects")}${navItem("forecasting", "/forecasting/", "Forecasting")}${navItem("data", "/data/", "Data")}${navItem("about", "/about/", "About")}</nav>
      <span class="status-pill"><span></span>Public beta · Forecast v2.2</span>
    </div>
  </header>`;
};
const footer = `
  <footer class="site-footer">
    <div class="footer-grid">
      <div class="footer-brand"><a class="brand" href="/"><span class="brand-mark">UK</span><span>Renewable Intelligence</span></a><p>Open UK renewable-project intelligence for planning evidence, screening and delivery research.</p></div>
      <nav class="footer-column" aria-label="Platform links"><strong>Platform</strong><a href="/">Dashboard</a><a href="/#projects">Project Explorer</a><a href="/#workbench">Screening Workbench</a><a href="/#scenario">Scenario Analysis</a></nav>
      <nav class="footer-column" aria-label="Research links"><strong>Research</strong><a href="/forecasting/">Forecasting</a><a href="/projects/">Project Directory</a><a href="/data/">Data &amp; Downloads</a><a href="/about/">About</a><a href="${repdSource}">Official REPD Source ↗</a></nav>
      <nav class="footer-column" aria-label="Development links"><strong>Development</strong><a href="${githubSource}">Source Code ↗</a><a href="https://uk-renewable-project-screening.streamlit.app/">Modelling Workspace ↗</a></nav>
    </div>
    <div class="footer-bottom"><span>Designed and engineered by HJ Nakamura · Mechanical Engineering, Imperial College London</span><span>Forecast v2.2 · Ranking signal only · Not investment advice</span></div>
  </footer>`;

function pageShell({ title, description, canonicalPath, body, structuredData, head = "", scripts = "", bodyClass = "" }) {
  const canonical = `${publicOrigin}${canonicalPath}`;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="robots" content="index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1">
  <meta name="author" content="HJ Nakamura">
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link rel="stylesheet" href="/assets/${contentAssetName}">
  <link rel="canonical" href="${canonical}">
  <link rel="alternate" hreflang="en-GB" href="${canonical}">
  <link rel="alternate" hreflang="x-default" href="${canonical}">
  <meta name="description" content="${escapeHtml(description)}">
  <meta name="theme-color" content="#102633">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="UK Renewable Intelligence">
  <meta property="og:locale" content="en_GB">
  <meta property="og:title" content="${escapeHtml(title)}">
  <meta property="og:description" content="${escapeHtml(description)}">
  <meta property="og:url" content="${canonical}">
  <meta property="og:image" content="${publicOrigin}/og.png">
  <meta property="og:image:alt" content="UK Renewable Intelligence project data and forecasting dashboard">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${escapeHtml(title)}">
  <meta name="twitter:description" content="${escapeHtml(description)}">
  <meta name="twitter:image" content="${publicOrigin}/og.png">
  <meta name="twitter:image:alt" content="UK Renewable Intelligence project data and forecasting dashboard">
  <title>${escapeHtml(title)}</title>
  <script type="application/ld+json">${jsonLd(structuredData)}</script>
  ${head}
</head>
<body${bodyClass ? ` class="${escapeHtml(bodyClass)}"` : ""}>${headerMarkup(canonicalPath)}<main class="content-shell">${body}</main>${footer}${scripts}</body>
</html>`;
}

const homeStructuredData = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "WebSite",
      "@id": `${publicOrigin}/#website`,
      name: "UK Renewable Intelligence",
      alternateName: "UK Renewable Energy Project Database and Forecasting",
      url: `${publicOrigin}/`,
      description: "Search 13,009 UK renewable energy planning records, explore project maps and compare an audited two-year delivery-ranking signal.",
      inLanguage: "en-GB",
      publisher: { "@id": `${authorUrl}/#person` },
    },
    {
      "@type": "Person",
      "@id": `${authorUrl}/#person`,
      name: "HJ Nakamura",
      url: authorUrl,
      affiliation: { "@type": "CollegeOrUniversity", name: "Imperial College London" },
    },
    {
      "@type": "Dataset",
      "@id": `${publicOrigin}/#dataset`,
      name: "UK Renewable Energy Project Database",
      description: "A searchable dataset of 13,009 UK renewable energy planning records with technology, capacity, location, planning status and transparent research enrichments.",
      url: `${publicOrigin}/data/`,
      sameAs: repdSource,
      isBasedOn: repdSource,
      isAccessibleForFree: true,
      temporalCoverage: `2019-09-25/${summary.latestSnapshot}`,
      spatialCoverage: { "@type": "Place", name: "United Kingdom" },
      version: summary.latestSnapshot,
      dateModified: siteLastModified,
      creator: { "@id": `${authorUrl}/#person` },
      publisher: { "@id": `${authorUrl}/#person` },
      keywords: "UK renewable energy projects, REPD, planning pipeline, offshore wind, solar, battery storage, project forecasting",
      variableMeasured: ["Installed capacity", "Planning stage", "Technology", "Location", "Relative two-year delivery signal"],
      distribution: [
        { "@type": "DataDownload", name: "UK renewable energy projects CSV", contentUrl: `${publicOrigin}/${publicDatasetCsv}`, encodingFormat: "text/csv" },
        { "@type": "DataDownload", name: "UK renewable energy projects JSON index", contentUrl: `${publicOrigin}/projects-index.json`, encodingFormat: "application/json" },
      ],
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
  const description = `${name}: ${formatMw(project.capacity_mw)} ${safeValue(project.technology, "renewable energy")} project in ${safeValue(project.region, "the UK")}. Planning evidence, status and relative delivery signal.`;
  const signalScore = deliverySignalScore(project);
  const signalBand = deliverySignalBand(project);
  const forecast = project.has_forecast ? `
    <div class="forecast-strip">
      <div><span>Two-year signal</span><strong>${formatNumber(signalScore)}/100</strong><small>${escapeHtml(signalBand)} relative evidence</small></div>
      <div><span>Three-year output</span><strong>Research only</strong><small>Not released as a probability</small></div>
      <div><span>Five-year output</span><strong>Withheld</strong><small>Insufficient validated cohorts</small></div>
    </div>
    <span class="status">Ranking signal only · ${escapeHtml(safeValue(project.forecast_confidence, "Limited"))} public-data coverage</span>
    <p class="note">The score is a percentile rank, not a ${signalScore}% chance of delivery. Use it to prioritise comparable projects, then inspect the dated planning evidence and constraints before making a decision.</p>`
    : `<p class="note">This planning record is outside the current active forecast universe. Its public project evidence remains searchable and comparable.</p>`;

  const body = `
    <section class="page-hero">
      <nav class="breadcrumb" aria-label="Breadcrumb"><a href="/">Home</a> / <a href="/projects/">Projects</a> / REPD ${escapeHtml(String(project.ref_id).padStart(5, "0"))}</nav>
      <p class="eyebrow">UK renewable project intelligence · REPD ${escapeHtml(String(project.ref_id).padStart(5, "0"))}</p>
      <h1>${escapeHtml(name)}</h1>
      <p class="lede">${escapeHtml(safeValue(project.operator, "Developer not reported"))} · ${escapeHtml(safeValue(project.technology))} · ${escapeHtml(safeValue(project.region))}</p>
      <div class="actions"><a class="button primary" href="/?project=${encodeURIComponent(String(project.ref_id))}#projects">Open in interactive explorer</a><a class="button secondary" href="/forecasting/">How forecasting works</a></div>
      <nav class="page-jump" aria-label="Project page sections"><span>On this page</span><a href="#project-evidence">Evidence</a><a href="#planning-timeline">Timeline</a><a href="#delivery-forecast">Delivery Signal</a><a href="#project-signals">Signals</a></nav>
    </section>
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
    <section class="section" id="delivery-forecast"><div class="section-heading"><div><p class="eyebrow">Time to operation</p><h2>Delivery Signal</h2></div><p>Relative two-year evidence for prioritisation, separated from unvalidated literal probabilities and external-risk scenarios.</p></div><article class="card">${forecast}</article></section>
    <section class="section" id="project-signals"><div class="grid"><article class="card span-6"><p class="eyebrow">Positive public evidence</p>${factorMarkup(project.positive_factors, "No additional positive signal is recorded.")}</article><article class="card span-6"><p class="eyebrow">Risks and missing evidence</p>${factorMarkup(project.risk_factors, "No additional public-data warning is recorded.")}</article></div></section>
    <section class="section source-box"><strong>Source and scope.</strong> Project facts derive from the <a href="${repdSource}">official DESNZ Renewable Energy Planning Database quarterly extract</a>. Delivery signals and screening scores are research enrichments by this platform; public data does not reveal private finance, land, supply-chain or contract terms.</section>`;

  return pageShell({
    title: `${name} – REPD ${String(project.ref_id).padStart(5, "0")} UK Renewable Project`,
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

function directoryPagination(page, position) {
  return `<nav class="pagination${position === "top" ? " pagination-top" : ""}" aria-label="Project directory pages, ${position}">${Array.from({ length: directoryPageCount }, (_, index) => index + 1).map((number) => number === page ? `<span aria-current="page">${number}</span>` : `<a href="${directoryPath(number)}" aria-label="Project directory page ${number}">${number}</a>`).join("")}</nav>`;
}

function directoryPage(page) {
  const start = (page - 1) * directoryPageSize;
  const pageProjects = directoryProjects.slice(start, start + directoryPageSize);
  const path = directoryPath(page);
  const body = `
    <section class="page-hero">
      <nav class="breadcrumb" aria-label="Breadcrumb"><a href="/">Home</a> / Projects${page > 1 ? ` / Page ${page}` : ""}</nav>
      <p class="eyebrow">Permanent project directory · Page ${page} of ${directoryPageCount}</p>
      <h1>UK Renewable Project Directory</h1>
      <p class="lede">Browse ${formatNumber(projects.length)} source-backed planning records. Every project has a permanent, indexable page with its latest public status, capacity, planning authority and available delivery evidence.</p>
      <div class="actions"><a class="button primary" href="/#projects">Search and filter interactively</a><a class="button secondary" href="/forecasting/">Review delivery-signal evidence</a></div>
      ${directoryPagination(page, "top")}
    </section>
    <section class="section"><ul class="directory-list">${pageProjects.map((project) => `
      <li><a href="${projectPath(project)}"><div><strong>${escapeHtml(safeValue(project.site_name, "Unnamed project"))}</strong><small>${escapeHtml(safeValue(project.technology))} · ${escapeHtml(safeValue(project.stage))} · ${formatMw(project.capacity_mw)}</small></div><span>View →</span></a></li>`).join("")}</ul>
      ${directoryPagination(page, "bottom")}
    </section>`;
  return pageShell({
    title: `UK Renewable Energy Project Database${page > 1 ? ` – Page ${page}` : ""} | Renewable Intelligence`,
    description: `Browse UK renewable energy planning projects, capacities, technologies, development stages and audited relative delivery signals. Page ${page} of ${directoryPageCount}.`,
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

const horizonProductStatus = { "2": "Ranking signal", "3": "Research only", "5": "Withheld" };
const releasedMetrics = (horizon, result) => (
  horizon === "2"
    ? forecastChallenger.horizons["2"].latest_cohort.enriched_tiebreak
    : result.uncalibrated
);
const auditRows = Object.entries(forecastAudit.horizons).map(([horizon, result]) => {
  const released = releasedMetrics(horizon, result);
  const brierPenalty = released.brier_score / result.historical_base_rate.brier_score - 1;
  return `<tr>
    <td><strong>${horizon} years</strong><small>${formatNumber(result.rolling_cohorts)} rolling cohorts</small></td>
    <td>${formatNumber(released.rows)}<small>${formatNumber(released.events)} observed events</small></td>
    <td class="numeric">${Number(released.roc_auc).toFixed(3)}</td>
    <td class="numeric">${formatPercent(released.event_rate)}</td>
    <td class="numeric">${formatPercent(released.mean_prediction)}</td>
    <td class="numeric penalty">+${formatPercent(brierPenalty)} worse</td>
    <td><span class="release-state state-${horizon}">${horizonProductStatus[horizon]}</span></td>
  </tr>`;
}).join("");

const rankingBars = Object.entries(forecastAudit.horizons).map(([horizon, result]) => {
  const released = releasedMetrics(horizon, result);
  return `
  <div class="evidence-bar-row">
    <div><strong>${horizon}-year horizon</strong><small>${formatNumber(result.rolling_cohorts)} rolling cohorts</small></div>
    <div class="evidence-scale" aria-label="${horizon}-year ROC-AUC ${Number(released.roc_auc).toFixed(3)}"><i style="width:${100 * released.roc_auc}%"></i><span style="left:50%"></span></div>
    <b>${Number(released.roc_auc).toFixed(3)}</b>
  </div>`;
}).join("");

const reliabilityBars = Object.entries(forecastAudit.horizons).map(([horizon, result]) => {
  const released = releasedMetrics(horizon, result);
  const scale = Math.max(released.mean_prediction, released.event_rate, 0.01);
  return `<div class="reliability-row">
    <div><strong>${horizon} years</strong><small>${formatNumber(released.rows)} held-out rows</small></div>
    <div class="reliability-bars">
      <span><i style="width:${100 * released.mean_prediction / scale}%"></i><b>Raw score mean ${formatPercent(released.mean_prediction)}</b></span>
      <span class="observed"><i style="width:${100 * released.event_rate / scale}%"></i><b>Observed ${formatPercent(released.event_rate)}</b></span>
    </div>
  </div>`;
}).join("");

const driverStatusClass = (status) => String(status).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const driverRows = [...driverRegistry.drivers]
  .sort((a, b) => a.priority - b.priority || a.category.localeCompare(b.category))
  .map((driver) => `<tr>
    <td><strong>${escapeHtml(driver.variable)}</strong><small>${escapeHtml(driver.category)}</small></td>
    <td><a href="${escapeHtml(driver.source_url)}">${escapeHtml(driver.source)} ↗</a></td>
    <td>${escapeHtml(driver.treatment)}</td>
    <td><span class="driver-state ${driverStatusClass(driver.status)}">${escapeHtml(driver.status)}</span></td>
  </tr>`).join("");

const forecastingPage = pageShell({
  title: "UK Renewable Energy Forecasting & Project Rankings",
  description: "Explore 6,189 UK renewable projects with an audited AI-enhanced two-year delivery ranking, capacity outlooks, maps, scenarios and transparent model evidence.",
  canonicalPath: "/forecasting/",
  bodyClass: "forecasting-page",
  head: `<link rel="preload" href="/forecast-data.json" as="fetch" crossorigin><link rel="stylesheet" href="/assets/${forecastingStyleAssetName}"><link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" integrity="sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=" crossorigin="">`,
  scripts: `<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js" integrity="sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=" crossorigin=""></script><script src="/assets/${forecastingAppAssetName}"></script>`,
  body: `
    <section class="page-hero">
      <nav class="breadcrumb" aria-label="Breadcrumb"><a href="/">Home</a> / Forecasting</nav>
      <p class="eyebrow">Forecast workbench · Snapshot ${escapeHtml(formatDate(forecastAudit.latest_snapshot))}</p>
      <h1>UK Renewable Delivery Outlook</h1>
      <p class="lede">Explore ${formatNumber(forecastProjects.length)} active projects, compare aggregate capacity outlooks, rank delivery evidence, map the pipeline and stress-test external conditions. The public two-year signal is a validated relative ranking—not a literal project probability.</p>
      <div class="actions"><a class="button primary" href="#forecast-workbench">Open forecast explorer</a><a class="button secondary" href="#model-evidence">Review model evidence</a></div>
      <nav class="page-jump" aria-label="Forecasting page sections"><span>Forecasting</span><a href="#forecast-workbench">Explorer</a><a href="#model-evidence">Model Evidence</a><a href="#forecast-performance">Release Matrix</a><a href="#external-inputs">External Inputs</a></nav>
    </section>
    <section class="forecast-workbench" id="forecast-workbench" aria-busy="true">
      <div class="forecast-loading" id="forecast-loading"><span>Loading ${formatNumber(forecastProjects.length)} forecast records…</span></div>
      <div id="forecast-interface" hidden>
        <div class="forecast-toolbar">
          <div class="forecast-filter-grid">
            <label class="forecast-field"><span>Search projects</span><input id="forecast-search" type="search" placeholder="Project, developer, technology or region…" autocomplete="off"></label>
            <label class="forecast-field"><span>Technology</span><select id="forecast-technology"><option>Loading…</option></select></label>
            <label class="forecast-field"><span>Region</span><select id="forecast-region"><option>Loading…</option></select></label>
            <label class="forecast-field"><span>Development stage</span><select id="forecast-stage"><option>Loading…</option></select></label>
            <button class="forecast-reset" id="forecast-reset" type="button">Reset filters</button>
          </div>
          <div class="forecast-toolbar-foot">
            <p class="forecast-filter-status" id="forecast-filter-status">All modelled projects</p>
            <div class="forecast-horizon" aria-label="Aggregate outlook horizon"><span class="forecast-control-label">Outlook</span><button type="button" data-horizon="2" aria-pressed="false">2 years</button><button type="button" data-horizon="3" aria-pressed="true">3 years</button></div>
          </div>
        </div>

        <div class="forecast-kpis" aria-label="Forecast summary">
          <article class="forecast-kpi"><span>Projects modelled</span><strong id="forecast-kpi-projects">—</strong><small>Active, non-operational records in the current forecast universe</small></article>
          <article class="forecast-kpi"><span>Pipeline capacity</span><strong id="forecast-kpi-capacity">—</strong><small>Gross capacity before timing and delivery adjustment</small></article>
          <article class="forecast-kpi"><span id="forecast-kpi-expected-label">3-year expected capacity</span><strong id="forecast-kpi-expected">—</strong><small>Probability-weighted aggregate research outlook; not a project-level promise</small></article>
          <article class="forecast-kpi"><span>Stronger-signal capacity</span><strong id="forecast-kpi-stronger">—</strong><small>Projects at or above the 75th delivery-signal percentile</small><small id="forecast-kpi-coverage">—</small></article>
        </div>

        <div class="forecast-tabs" role="tablist" aria-label="Forecast tools">
          <button type="button" role="tab" id="forecast-tab-overview" aria-controls="forecast-panel-overview" aria-selected="true" data-forecast-tab="overview">Overview</button>
          <button type="button" role="tab" id="forecast-tab-projects" aria-controls="forecast-panel-projects" aria-selected="false" tabindex="-1" data-forecast-tab="projects">Project rankings</button>
          <button type="button" role="tab" id="forecast-tab-scenario" aria-controls="forecast-panel-scenario" aria-selected="false" tabindex="-1" data-forecast-tab="scenario">Scenario lab</button>
          <button type="button" role="tab" id="forecast-tab-map" aria-controls="forecast-panel-map" aria-selected="false" tabindex="-1" data-forecast-tab="map">Forecast map</button>
        </div>

        <section class="forecast-panel" id="forecast-panel-overview" role="tabpanel" aria-labelledby="forecast-tab-overview" data-forecast-panel="overview">
          <div class="forecast-panel-heading"><div><p class="eyebrow">Aggregate forecast</p><h2>Pipeline Outlook</h2></div><p>Filters update every metric and chart. Forecast capacity is aggregated across projects; exact project probabilities remain outside the public decision surface.</p></div>
          <div class="forecast-outlook-strip" id="forecast-outlook-strip"></div>
          <div class="forecast-chart-grid">
            <article class="forecast-chart-card"><h3>Expected Capacity by Technology</h3><p class="forecast-chart-subtitle"><span data-forecast-horizon-label>3-year</span> aggregate outlook · highest-capacity technologies</p><div class="forecast-bars" id="forecast-technology-bars"></div></article>
            <article class="forecast-chart-card"><h3>Expected Capacity by Stage</h3><p class="forecast-chart-subtitle"><span data-forecast-horizon-label>3-year</span> aggregate outlook · current public planning stage</p><div class="forecast-bars" id="forecast-stage-bars"></div></article>
          </div>
        </section>

        <section class="forecast-panel" id="forecast-panel-projects" role="tabpanel" aria-labelledby="forecast-tab-projects" data-forecast-panel="projects" hidden>
          <div class="forecast-panel-heading"><div><p class="eyebrow">Research queue</p><h2>Project Delivery Rankings</h2></div><p>The score compares projects with one another. A score of 80 means stronger two-year model evidence than roughly 80% of the current forecast universe.</p></div>
          <div class="forecast-table-card">
            <div class="forecast-table-tools"><p id="forecast-table-count">Loading projects…</p><div class="forecast-table-actions"><div class="forecast-sort"><label for="forecast-sort">Sort projects</label><select id="forecast-sort"><option value="signal">Delivery signal: strongest</option><option value="capacity">Capacity: largest</option><option value="name">Project name: A–Z</option></select></div><button class="forecast-download" id="forecast-download" type="button">Download filtered CSV</button></div></div>
            <div class="forecast-table-scroll"><table class="forecast-table"><thead><tr><th>Project</th><th>Technology</th><th>Region</th><th>Stage</th><th>Capacity</th><th>2-year signal</th><th>Coverage</th><th>Evidence</th></tr></thead><tbody id="forecast-table-body"></tbody></table></div>
            <div class="forecast-pagination"><span id="forecast-page-label">Page 1</span><div><button id="forecast-page-previous" type="button">Previous</button><button id="forecast-page-next" type="button">Next</button></div></div>
          </div>
        </section>

        <section class="forecast-panel" id="forecast-panel-scenario" role="tabpanel" aria-labelledby="forecast-tab-scenario" data-forecast-panel="scenario" hidden>
          <div class="forecast-panel-heading"><div><p class="eyebrow">External conditions</p><h2>Delivery Scenario Lab</h2></div><p>Apply bounded economic, grid and policy shocks to the filtered aggregate outlook. These sensitivities are intentionally separate from the trained project ranking.</p></div>
          <div class="forecast-scenario-grid">
            <article class="forecast-chart-card forecast-scenario-controls">
              <div class="forecast-range"><div class="forecast-range-head"><label for="forecast-scenario-rate">Financing-rate shock</label><output id="forecast-scenario-rate-value">+0.0 pp</output></div><input id="forecast-scenario-rate" data-scenario-control type="range" min="-2" max="2" step="0.25" value="0"><small>Change from the reference financing environment</small></div>
              <div class="forecast-range"><div class="forecast-range-head"><label for="forecast-scenario-costs">Construction &amp; material costs</label><output id="forecast-scenario-costs-value">+0%</output></div><input id="forecast-scenario-costs" data-scenario-control type="range" min="-20" max="30" step="2" value="0"><small>Real cost shock relative to the reference case</small></div>
              <div class="forecast-range"><div class="forecast-range-head"><label for="forecast-scenario-grid-delay">Additional grid delay</label><output id="forecast-scenario-grid-delay-value">+0 months</output></div><input id="forecast-scenario-grid-delay" data-scenario-control type="range" min="0" max="24" step="3" value="0"><small>Portfolio-wide connection delay stress</small></div>
              <div class="forecast-range"><div class="forecast-range-head"><label for="forecast-scenario-power">Electricity-price support</label><output id="forecast-scenario-power-value">+0%</output></div><input id="forecast-scenario-power" data-scenario-control type="range" min="-20" max="20" step="2" value="0"><small>Revenue-support shock relative to the reference case</small></div>
              <div class="forecast-range"><div class="forecast-range-head"><label for="forecast-scenario-policy">Policy environment</label><output id="forecast-scenario-policy-value">Neutral</output></div><input id="forecast-scenario-policy" data-scenario-control type="range" min="-2" max="2" step="1" value="0"><small>Bounded qualitative support assumption</small></div>
              <button class="forecast-reset" id="forecast-scenario-reset" type="button">Reset scenario</button>
            </article>
            <article class="forecast-scenario-result">
              <p class="eyebrow"><span data-forecast-horizon-label>3-year</span> scenario outlook</p>
              <div class="forecast-scenario-values"><div><span>Reference capacity</span><strong id="forecast-scenario-baseline">—</strong></div><div><span>Stress-adjusted capacity</span><strong id="forecast-scenario-adjusted">—</strong></div></div>
              <p class="forecast-scenario-delta" id="forecast-scenario-delta">—</p>
              <div class="forecast-driver-chips"><span id="forecast-scenario-index">100 conditions index</span><span id="forecast-scenario-drivers">Reference assumptions</span></div>
              <p class="forecast-scenario-note">Scenario coefficients are transparent, bounded sensitivities for comparison—not trained causal effects or investment-grade forecasts. They do not alter the validated project ranking.</p>
            </article>
          </div>
        </section>

        <section class="forecast-panel" id="forecast-panel-map" role="tabpanel" aria-labelledby="forecast-tab-map" data-forecast-panel="map" hidden>
          <div class="forecast-panel-heading"><div><p class="eyebrow">Spatial intelligence</p><h2>Forecast Project Map</h2></div><p>Marker size represents capacity and marker tone represents the public two-year delivery-signal band. Filters remain active across the map.</p></div>
          <div class="forecast-map-card"><div class="forecast-map-head"><p id="forecast-map-count">Preparing located projects…</p><div class="forecast-map-legend" aria-label="Delivery signal legend"><span>Lower</span><span>Typical</span><span>Stronger</span></div></div><div id="forecast-map" aria-label="Map of forecastable UK renewable projects"></div></div>
        </section>
      </div>
    </section>

    <section class="section" id="model-evidence"><div class="section-heading"><div><p class="eyebrow">Validated challenger</p><h2>Forecast Model Evidence</h2></div><p>The richer model is used only where it proved useful: resolving ties inside the stable empirical ordering.</p></div>
      <div class="forecast-evidence-summary">
        <article class="card metric-card"><span>Empirical ranking AUC</span><strong>${Number(forecastChallenger.horizons["2"].latest_cohort.empirical_survival.roc_auc).toFixed(3)}</strong><small>Stage, technology and annual delivery hazard</small></article>
        <article class="card metric-card"><span>AI tie-break ranking AUC</span><strong>${Number(forecastChallenger.horizons["2"].latest_cohort.enriched_tiebreak.roc_auc).toFixed(3)}</strong><small>+${(forecastChallenger.horizons["2"].latest_cohort.enriched_tiebreak.roc_auc - forecastChallenger.horizons["2"].latest_cohort.empirical_survival.roc_auc).toFixed(3)} on the untouched latest cohort</small></article>
        <article class="card metric-card"><span>Average precision</span><strong>${Number(forecastChallenger.horizons["2"].latest_cohort.enriched_tiebreak.average_precision).toFixed(3)}</strong><small>Up from ${Number(forecastChallenger.horizons["2"].latest_cohort.empirical_survival.average_precision).toFixed(3)} for the empirical ranker</small></article>
      </div>
      <article class="card model-composition"><div><strong>Primary ordering</strong><span>Empirical survival score</span></div><i>+</i><div><strong>AI tie-break evidence</strong><span>Stage age · milestones · capacity revisions · developer history · regional track record · CfD · portfolio pressure</span></div><i>→</i><div><strong>Public output</strong><span>Relative percentile only</span></div></article>
      <p class="note">The standalone CatBoost challenger was rejected as a replacement because its overall ranking was weaker. Its within-bucket ordering improved both AUC and average precision, passed the pre-declared ranking gate and is the only AI component promoted to Forecast v2.2.</p>
    </section>
    <section class="section" id="forecast-performance"><div class="section-heading"><div><p class="eyebrow">Product governance</p><h2>Horizon Release Matrix</h2></div><p>Each horizon is released independently. Ranking quality cannot justify publishing an uncalibrated percentage.</p></div>
      <article class="card table-scroll"><table class="audit-table"><thead><tr><th>Horizon</th><th>Test sample</th><th>Ranking AUC</th><th>Observed</th><th>Raw mean</th><th>Probability error</th><th>Public output</th></tr></thead><tbody>${auditRows}</tbody></table></article>
      <p class="note">The two-year score is exposed only as a percentile rank across the current forecast universe. Three-year values remain methodology research. Five-year values are removed from the public decision surface.</p>
    </section>
    <section class="section" id="forecast-evidence"><div class="section-heading"><div><p class="eyebrow">Held-out evidence</p><h2>Ranking &amp; Reliability Evidence</h2></div><p>Higher ROC-AUC means better ordering. The rate comparison explains why the same scores are not released as probabilities.</p></div>
      <div class="grid evidence-grid">
        <article class="card span-6"><h3>Ranking Discrimination</h3><p class="chart-note">ROC-AUC by horizon · dark marker at the 0.5 random baseline</p><div class="evidence-bars">${rankingBars}</div></article>
        <article class="card span-6"><h3>Predicted and Observed Delivery Rates</h3><p class="chart-note">Raw mean score versus realised outcome rate on held-out rows</p><div class="reliability-chart">${reliabilityBars}</div></article>
      </div>
    </section>
    <section class="section" id="signal-use"><div class="section-heading"><div><p class="eyebrow">Decision workflow</p><h2>Delivery-Signal Usage</h2></div><p>The signal narrows the research queue; the underlying evidence remains the decision input.</p></div><div class="grid">
      <article class="card span-4"><span class="step-number">01</span><h3>Rank</h3><p class="note">Sort comparable projects by the two-year delivery signal. A score of 80 means stronger model evidence than roughly 80% of the current forecast universe.</p></article>
      <article class="card span-4"><span class="step-number">02</span><h3>Verify</h3><p class="note">Open the project record and inspect its planning stage, dated milestones, authority, CfD evidence and recorded constraints.</p></article>
      <article class="card span-4"><span class="step-number">03</span><h3>Stress</h3><p class="note">Use the Scenario Lab to test how rates, construction costs, grid delay and policy assumptions change portfolio delivery pressure.</p></article>
    </div></section>
    <section class="section" id="validation-controls"><div class="section-heading"><div><p class="eyebrow">Leakage controls</p><h2>Temporal Validation Controls</h2></div></div><div class="grid">
      <article class="card span-6"><h3>Fully Observed Outcomes</h3><p class="note">An origin is evaluated only when the entire forecast horizon has elapsed. Unresolved recent projects are censored rather than labelled as failures.</p></article>
      <article class="card span-6"><h3>Project-Purged Temporal Splits</h3><p class="note">Test projects are removed from survival-training rows. Features such as developer track record count only information dated before the forecast origin.</p></article>
      <article class="card span-6"><h3>Calibration Governance</h3><p class="note">Log-odds, Platt and isotonic calibration are fitted on earlier out-of-time cohorts and tested on the latest complete cohort. They are not promoted using in-sample fit.</p></article>
      <article class="card span-6"><h3>Release Abstention</h3><p class="note">The public product now abstains: a failed horizon is shown as research-only or withheld instead of publishing the least-bad candidate as a probability.</p></article>
    </div></section>
    <section class="section" id="external-inputs"><div class="section-heading"><div><p class="eyebrow">Feature roadmap</p><h2>External Driver Register</h2></div><p>Project evidence enters the trained challenger now. Market, political and news variables enter only after they have dated histories, source QA and a measurable out-of-time lift.</p></div>
      <article class="card table-scroll"><table class="driver-table"><thead><tr><th>Variable</th><th>Source</th><th>Current treatment</th><th>Status</th></tr></thead><tbody>${driverRows}</tbody></table></article>
      <p class="note">${escapeHtml(driverRegistry.principle)}</p>
    </section>
    <section class="section" id="external-scenarios"><div class="section-heading"><div><p class="eyebrow">Politics, prices and external conditions</p><h2>Macroeconomic &amp; Policy Scenarios</h2></div></div><article class="card"><p class="note">Bank Rate, wholesale electricity prices, construction and material costs, grid delay, developer-financing stress, policy support and CfD assumptions can materially change delivery conditions. However, ${formatNumber(forecastAudit.snapshots)} independent REPD dates are not enough to estimate credible macroeconomic coefficients. The <a href="/#scenario">Scenario Lab</a> therefore exposes them as bounded sensitivities, separate from the trained project ranking. This avoids pretending that thousands of projects sharing one date are thousands of independent observations of politics or inflation.</p></article></section>
    <section class="section source-box" id="audit-decision"><strong>Public release decision.</strong> Promote the empirical ranking with the validated AI tie-breaker; continue withholding literal probabilities. The saved evidence is available in <a href="/forecast-challenger.json">forecast-challenger.json</a>, with the original calibration audit in <a href="/forecast-audit.json">forecast-audit.json</a>.</section>`,
  structuredData: {
    "@context": "https://schema.org",
    "@type": "TechArticle",
    headline: "UK renewable project delivery-signal methodology and validation",
    description: "Rolling-origin validation and release governance for a relative UK renewable-project delivery signal.",
    url: `${publicOrigin}/forecasting/`,
    dateModified: forecastAudit.latest_snapshot,
    isPartOf: { "@id": `${publicOrigin}/#website` },
  },
});

const csvFields = [
  ["ref_id", "ref_id"],
  ["site_name", "site_name"],
  ["operator", "operator"],
  ["technology", "technology"],
  ["development_stage", "stage"],
  ["capacity_mw", "capacity_mw"],
  ["region", "region"],
  ["county", "county"],
  ["country", "country"],
  ["planning_authority", "planning_authority"],
  ["planning_reference", "planning_reference"],
  ["latitude", "latitude"],
  ["longitude", "longitude"],
  ["planning_submitted", "planning_submitted"],
  ["planning_granted", "planning_granted"],
  ["construction_started", "under_construction"],
  ["operational", "operational"],
  ["record_updated", "record_updated"],
  ["delivery_signal_percentile", "delivery_signal_score"],
  ["screening_score", "screening_score"],
  ["screening_risk", "screening_risk"],
];
const publicDataset = `${csvFields.map(([label]) => csvEscape(label)).join(",")}\n${projects.map((project) => (
  csvFields.map(([, field]) => csvEscape(project[field])).join(",")
)).join("\n")}\n`;

const dataPage = pageShell({
  title: "UK Renewable Energy Project Database – Free Data Download",
  description: `Search and download ${formatNumber(projects.length)} UK renewable energy planning records covering wind, solar, storage and other technologies, sourced from the official REPD.`,
  canonicalPath: "/data/",
  body: `
    <section class="page-hero">
      <nav class="breadcrumb" aria-label="Breadcrumb"><a href="/">Home</a> / Data</nav>
      <p class="eyebrow">Open renewable energy data · Snapshot ${escapeHtml(formatDate(summary.latestSnapshot))}</p>
      <h1>UK Renewable Energy Project Database</h1>
      <p class="lede">Search or download ${formatNumber(projects.length)} UK renewable energy planning records covering wind, solar, battery storage and other technologies. Each record links to its permanent evidence page and the latest public status from the official Renewable Energy Planning Database.</p>
      <div class="actions"><a class="button primary" href="/${publicDatasetCsv}" download>Download project data (CSV)</a><a class="button secondary" href="/projects/">Browse all projects</a><a class="button secondary" href="/#projects">Search interactively</a></div>
      <nav class="page-jump" aria-label="Data page sections"><span>Data</span><a href="#coverage">Coverage</a><a href="#fields">Fields</a><a href="#downloads">Downloads</a><a href="#provenance">Source &amp; Method</a></nav>
    </section>
    <section class="section" id="coverage"><div class="section-heading"><div><p class="eyebrow">United Kingdom coverage</p><h2>Renewable Project Coverage</h2></div><p>A source-backed national planning snapshot designed for project discovery, screening and reproducible analysis.</p></div>
      <div class="grid">
        <article class="card metric-card span-4"><span>Planning records</span><strong>${formatNumber(projects.length)}</strong><small>Permanent, indexable project pages</small></article>
        <article class="card metric-card span-4"><span>Forecast-linked projects</span><strong>${formatNumber(forecastProjects.length)}</strong><small>Active projects with a relative two-year delivery signal</small></article>
        <article class="card metric-card span-4"><span>Source snapshot</span><strong>${escapeHtml(formatDate(summary.latestSnapshot))}</strong><small>Latest REPD snapshot represented in this release</small></article>
      </div>
    </section>
    <section class="section" id="fields"><div class="section-heading"><div><p class="eyebrow">Data dictionary</p><h2>Project Fields</h2></div><p>Exported fields remain legible and analysis-ready while preserving direct links back to the public evidence.</p></div>
      <div class="fact-grid">
        <div><span>Identity</span><strong>REPD reference, site name, operator or applicant</strong></div>
        <div><span>Technology</span><strong>Technology category and reported capacity in MW</strong></div>
        <div><span>Location</span><strong>Country, region, county and available coordinates</strong></div>
        <div><span>Planning</span><strong>Authority, planning reference, development stage and dated milestones</strong></div>
        <div><span>Research enrichment</span><strong>Screening score, risk band and relative delivery-signal percentile</strong></div>
        <div><span>Important limitation</span><strong>The delivery signal is a relative rank, not a probability or investment recommendation</strong></div>
      </div>
    </section>
    <section class="section" id="downloads"><div class="section-heading"><div><p class="eyebrow">Machine-readable access</p><h2>Data Downloads</h2></div><p>Use CSV for analysis or the smaller JSON index for browser applications. Project evidence is also available on the permanent record pages.</p></div>
      <div class="grid">
        <article class="card span-6"><h3>Project Dataset (CSV)</h3><p class="note">${formatNumber(projects.length)} rows with public planning fields and clearly labelled research enrichments.</p><div class="actions"><a class="button primary" href="/${publicDatasetCsv}" download>Download CSV</a></div></article>
        <article class="card span-6"><h3>Project Index (JSON)</h3><p class="note">A compact machine-readable index used by the interactive project explorer.</p><div class="actions"><a class="button secondary" href="/projects-index.json">Open JSON</a></div></article>
      </div>
    </section>
    <section class="section" id="provenance"><div class="section-heading"><div><p class="eyebrow">Provenance and governance</p><h2>Data Source &amp; Methodology</h2></div></div>
      <article class="card"><p class="note">Public project facts derive from the official DESNZ Renewable Energy Planning Database quarterly extract. This platform normalises records for search and adds transparent screening and forecasting research. It does not replace the source publication, and public data cannot reveal private finance, land, supply-chain or contract terms.</p><div class="actions"><a class="button secondary" href="${repdSource}">Open official REPD source</a><a class="button secondary" href="/forecasting/">Review forecast validation</a><a class="button secondary" href="${githubSource}">Inspect source code</a></div></article>
    </section>`,
  structuredData: {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebPage",
        "@id": `${publicOrigin}/data/#page`,
        name: "UK Renewable Energy Project Database",
        url: `${publicOrigin}/data/`,
        dateModified: siteLastModified,
        isPartOf: { "@id": `${publicOrigin}/#website` },
        mainEntity: { "@id": `${publicOrigin}/#dataset` },
      },
      {
        "@type": "Dataset",
        "@id": `${publicOrigin}/#dataset`,
        name: "UK Renewable Energy Project Database",
        description: `A searchable and downloadable dataset of ${formatNumber(projects.length)} UK renewable energy planning records with technology, capacity, location, planning status and transparent research enrichments.`,
        url: `${publicOrigin}/data/`,
        sameAs: repdSource,
        isBasedOn: repdSource,
        isAccessibleForFree: true,
        temporalCoverage: `2019-09-25/${summary.latestSnapshot}`,
        spatialCoverage: { "@type": "Place", name: "United Kingdom" },
        version: summary.latestSnapshot,
        dateModified: siteLastModified,
        creator: { "@type": "Person", name: "HJ Nakamura", url: authorUrl },
        keywords: ["UK renewable energy projects", "Renewable Energy Planning Database", "REPD", "offshore wind projects", "solar projects", "battery storage projects", "renewable project forecasting"],
        variableMeasured: csvFields.map(([label]) => label),
        distribution: [
          { "@type": "DataDownload", name: "UK renewable energy projects CSV", contentUrl: `${publicOrigin}/${publicDatasetCsv}`, encodingFormat: "text/csv" },
          { "@type": "DataDownload", name: "UK renewable energy projects JSON index", contentUrl: `${publicOrigin}/projects-index.json`, encodingFormat: "application/json" },
        ],
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Home", item: `${publicOrigin}/` },
          { "@type": "ListItem", position: 2, name: "Data", item: `${publicOrigin}/data/` },
        ],
      },
    ],
  },
});

const aboutPage = pageShell({
  title: "About UK Renewable Infrastructure Intelligence",
  description: "An open engineering portfolio project that turns the UK Renewable Energy Planning Database into searchable project intelligence, mapping and an audited delivery signal.",
  canonicalPath: "/about/",
  body: `
    <section class="page-hero">
      <nav class="breadcrumb" aria-label="Breadcrumb"><a href="/">Home</a> / About</nav>
      <p class="eyebrow">Engineering portfolio case study</p>
      <h1>UK Renewable Intelligence Platform</h1>
      <p class="lede">UK Renewable Infrastructure Intelligence is an open, public-data decision-support platform developed by HJ Nakamura, a Mechanical Engineering student at Imperial College London. It combines data engineering, geospatial analysis, forecast governance and product design in one deployable system.</p>
      <div class="actions"><a class="button primary" href="${githubSource}">View source code</a><a class="button secondary" href="/#workbench">Open the engineering tools</a></div>
      <nav class="page-jump" aria-label="About page sections"><span>On this page</span><a href="#platform-purpose">Purpose</a><a href="#engineering-capabilities">Capabilities</a><a href="#related-engineering">Vehicle-data work</a><a href="#responsible-use">Responsible Use</a></nav>
    </section>
    <section class="section" id="platform-purpose"><div class="section-heading"><div><p class="eyebrow">Product thesis</p><h2>Platform Purpose</h2></div><p>The official REPD is the source of truth for public planning records. This platform adds the layer needed for screening: search, permanent evidence pages, comparable delivery signals, maps, portfolios and external-risk scenarios.</p></div><div class="grid">
      <article class="card metric-card span-4"><span>Planning records</span><strong>${formatNumber(summary.kpis.datasetProjects)}</strong><small>Complete current explorer snapshot</small></article>
      <article class="card metric-card span-4"><span>Linked delivery signals</span><strong>${formatNumber(summary.kpis.forecastCoverage)}</strong><small>Active projects joined to the audited ranking universe</small></article>
      <article class="card metric-card span-4"><span>Mapped records</span><strong>${formatNumber(projects.filter((project) => Number.isFinite(Number(project.latitude)) && Number.isFinite(Number(project.longitude))).length)}</strong><small>Valid coordinates in the public map workbench</small></article>
    </div></section>
    <section class="section" id="engineering-capabilities"><div class="section-heading"><div><p class="eyebrow">Engineering scope</p><h2>Engineering Capabilities</h2></div></div><div class="grid">
      <article class="card span-6"><h3>Data Engineering</h3><p class="note">Normalises irregular REPD releases into a project × snapshot panel, documents fallback entity keys, preserves source fields and validates duplicates, ranges and freshness.</p></article>
      <article class="card span-6"><h3>Forecast Governance</h3><p class="note">Uses right-censored survival targets, project-purged temporal holdouts, probability calibration challengers, independent horizon gates and explicit abstention when evidence is insufficient.</p></article>
      <article class="card span-6"><h3>Mechanical Engineering Context</h3><p class="note">Includes an offshore wind quick calculator for capacity factor, turbine count, CAPEX, revenue and displaced carbon, with visible techno-economic assumptions.</p></article>
      <article class="card span-6"><h3>Public Product Delivery</h3><p class="note">Runs as a static, accessible site with no account, no sleeping server, lazy project data, shareable explorer state, permanent project pages and automated integrity checks.</p></article>
    </div></section>
    <section class="section" id="related-engineering"><div class="section-heading"><div><p class="eyebrow">Related engineering work</p><h2>Formula Student Telemetry Debrief</h2></div><p>A companion vehicle-data project applies the same emphasis on data quality, transparent assumptions and reviewable outputs to EV drivetrain test data.</p></div><div class="grid">
      <article class="card span-8"><h3>Post-run review, not just charts</h3><p class="note">The tool validates uploaded telemetry logs, groups motor-temperature, inverter-temperature and voltage-sag threshold breaches into review windows, and calculates timestamp-aware mechanical and electrical energy by lap. The committed session is explicitly synthetic: it demonstrates the workflow without implying access to or deployment on a team’s private data.</p></article>
      <article class="card span-4"><h3>Reviewer path</h3><p class="note">Run the debrief in a browser, then inspect the Python analysis layer, tests and dashboard implementation.</p><div class="actions"><a class="button primary" href="https://imperial-fs-telemetry.streamlit.app/">Open live debrief</a><a class="button secondary" href="https://github.com/hj-nakamura421/imperial-fs-telemetry">View source</a></div></article>
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

const staticUrls = ["/", "/projects/", "/forecasting/", "/data/", "/about/", ...Array.from({ length: directoryPageCount - 1 }, (_, index) => directoryPath(index + 2))];
const sitemapEntries = [
  ...staticUrls.map((path) => ({ path, lastModified: siteLastModified })),
  ...projects.map((project) => ({ path: projectPath(project), lastModified: siteLastModified })),
];
const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${sitemapEntries.map(({ path, lastModified }) => `  <url><loc>${escapeXml(`${publicOrigin}${path}`)}</loc><lastmod>${escapeXml(lastModified)}</lastmod></url>`).join("\n")}\n</urlset>\n`;
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
  writeFile(resolve(output, "forecast-data.json"), JSON.stringify(forecastData)),
  writeFile(resolve(output, publicDatasetCsv), publicDataset),
  writeFile(resolve(output, "forecast-audit.json"), JSON.stringify(forecastAudit)),
  writeFile(resolve(output, "forecast-challenger.json"), JSON.stringify(forecastChallenger)),
  writeFile(resolve(output, "external-driver-registry.json"), JSON.stringify(driverRegistry)),
  writeFile(resolve(output, "assets", contentAssetName), contentStyles),
  writeFile(resolve(output, "assets", forecastingStyleAssetName), forecastingStyles),
  writeFile(resolve(output, "assets", forecastingAppAssetName), forecastingApp),
  writeFile(resolve(output, "sitemap.xml"), sitemap),
  writeFile(resolve(output, "robots.txt"), robots),
  writeFile(resolve(output, ".nojekyll"), ""),
  copyAsset("public/og-v3.png", "og.png", resolve(output, "og.png")),
  copyAsset("public/favicon.svg", "favicon.svg", resolve(output, "favicon.svg")),
  copyFile(resolve(root, "public/google66671dc9a2a42b9c.html"), resolve(output, "google66671dc9a2a42b9c.html")),
]);

await Promise.all([
  mkdir(resolve(output, "forecasting"), { recursive: true }).then(() => writeFile(resolve(output, "forecasting/index.html"), forecastingPage)),
  mkdir(resolve(output, "data"), { recursive: true }).then(() => writeFile(resolve(output, "data/index.html"), dataPage)),
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
