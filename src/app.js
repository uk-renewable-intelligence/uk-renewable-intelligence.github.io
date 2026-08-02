(async () => {
const summary = window.DASHBOARD_SUMMARY || await fetch("./dashboard-summary.json?v=20260802-dashboard-v3").then((response) => {
  if (!response.ok) throw new Error(`Dashboard data request failed (${response.status})`);
  return response.json();
});
const data = { ...summary, projects: [] };
const qs = (selector) => document.querySelector(selector);
const qsa = (selector) => [...document.querySelectorAll(selector)];
const numberFormatter = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 0 });
const compactFormatter = new Intl.NumberFormat("en-GB", { notation: "compact", maximumFractionDigits: 1 });
const formatNumber = (value) => numberFormatter.format(Number(value) || 0);
const formatMw = (value, compact = false) => `${compact ? compactFormatter.format(Number(value) || 0) : formatNumber(value)} MW`;
const formatPercent = (value, digits = 1) => Number.isFinite(Number(value)) ? `${(100 * Number(value)).toFixed(digits)}%` : "Not modelled";
const formatDate = (value, options = { day: "2-digit", month: "short", year: "numeric" }) => {
  if (!value) return "Not reported";
  const parts = String(value).split("/");
  const date = parts.length === 3
    ? new Date(`${parts[2]}-${parts[1]}-${parts[0]}T12:00:00`)
    : new Date(/^\d{4}-\d{2}-\d{2}$/.test(String(value)) ? `${value}T12:00:00` : value);
  return Number.isNaN(date.valueOf()) ? String(value) : date.toLocaleDateString("en-GB", options);
};
const parseDate = (value) => {
  if (!value) return null;
  const parts = String(value).split("/");
  const date = parts.length === 3
    ? new Date(`${parts[2]}-${parts[1]}-${parts[0]}T12:00:00`)
    : new Date(/^\d{4}-\d{2}-\d{2}$/.test(String(value)) ? `${value}T12:00:00` : value);
  return Number.isNaN(date.valueOf()) ? null : date;
};
const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
}[character]));
const safeValue = (value, fallback = "Not reported") => value === null || value === undefined || String(value).trim() === "" ? fallback : String(value);
const csvCell = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;
const downloadText = (filename, content, type = "text/plain;charset=utf-8") => {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([content], { type }));
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
};
let toastTimer;
const showToast = (message) => {
  const toast = qs("#toast");
  if (!toast) return;
  window.clearTimeout(toastTimer);
  toast.textContent = message;
  toast.hidden = false;
  toastTimer = window.setTimeout(() => { toast.hidden = true; }, 2600);
};

qs("#snapshot-date").textContent = formatDate(data.latestSnapshot);
qs("#hero-expected").textContent = Number(data.model.rollingAudit.horizons["2"].rocAuc).toFixed(3);
qs("#hero-active").textContent = "Ranking only";
qs("#hero-updated").textContent = formatNumber(data.model.rollingAudit.horizons["2"].rollingCohorts);
qs("#kpi-records").textContent = formatNumber(data.kpis.datasetProjects);
qs("#kpi-projects").textContent = formatNumber(data.kpis.activeProjects);
qs("#kpi-capacity").textContent = formatMw(data.kpis.pipelineCapacityMw, true);
qs("#kpi-expected").textContent = formatNumber(data.kpis.strongerSignalProjects);
qs("#explorer-total").textContent = formatNumber(data.kpis.datasetProjects);
qs("#coverage-records").textContent = formatNumber(data.kpis.datasetProjects);
qs("#coverage-forecasts").textContent = formatNumber(data.kpis.forecastCoverage);
qs("#dataset-update").textContent = formatDate(data.dataset.latestRecordUpdate, { month: "short", year: "numeric" });

const stages = data.groups.stage.slice(0, 7);
const maxStageCapacity = Math.max(...stages.map((item) => item.capacity_mw));
qs("#stage-chart").innerHTML = stages.map((item) => `
  <div class="bar-item">
    <div class="bar-item-header"><span>${escapeHtml(item.name)}</span><strong>${formatMw(item.capacity_mw)}</strong></div>
    <div class="bar-track"><div class="bar-fill" style="width:${100 * item.capacity_mw / maxStageCapacity}%"></div></div>
  </div>
`).join("");

const deliveryTechnology = data.groups.deliveryTechnology.slice(0, 7);
const maxTechSignal = Math.max(1, ...deliveryTechnology.map((item) => item.stronger_signal_projects));
qs("#tech-chart").innerHTML = deliveryTechnology.map((item) => `
  <div class="tech-item">
    <span>${escapeHtml(item.name)}</span>
    <small>${formatNumber(item.stronger_signal_projects)} of ${formatNumber(item.forecast_projects)} forecastable projects</small>
    <strong>${formatPercent(item.stronger_signal_share, 0)}</strong>
    <span class="tech-meter"><i style="width:${100 * item.stronger_signal_projects / maxTechSignal}%"></i></span>
  </div>
`).join("");

document.body.classList.remove("loading");

const waitForProjectDemand = () => new Promise((resolve) => {
  let settled = false;
  const triggers = qsa('a[href="#projects"], a[href="#workbench"], a[href="#scenario"], a[href="#trust"]');
  const trigger = () => {
    if (settled) return;
    settled = true;
    observer.disconnect();
    triggers.forEach((link) => link.removeEventListener("click", trigger));
    resolve();
  };
  const params = new URLSearchParams(window.location.search);
  const needsProjectsNow = params.has("project") || [...params.keys()].some((key) => ["q", "technology", "stage", "region", "coverage", "sort"].includes(key))
    || ["#projects", "#workbench", "#scenario", "#trust"].includes(window.location.hash);
  const observer = new IntersectionObserver((entries) => {
    if (entries.some((entry) => entry.isIntersecting)) trigger();
  }, { rootMargin: "0px" });
  observer.observe(qs("#projects"));
  triggers.forEach((link) => link.addEventListener("click", trigger));
  if (needsProjectsNow) trigger();
  else window.setTimeout(trigger, 12000);
});

await waitForProjectDemand();
data.projects = await fetch("./projects-index.json?v=20260802-dashboard-v3").then((response) => {
  if (!response.ok) throw new Error(`Project register request failed (${response.status})`);
  return response.json();
});

data.projects.forEach((project, index) => {
  project._index = index;
  project._search = [
    project.site_name,
    project.operator,
    project.technology,
    project.region,
    project.county,
    project.planning_authority,
    project.planning_reference,
    project.ref_id,
  ].join(" ").toLowerCase();
});

const signalCounts = new Map();
data.projects.filter((project) => project.has_forecast && Number.isFinite(Number(project.prob_operational_2y))).forEach((project) => {
  const probability = Number(project.prob_operational_2y);
  signalCounts.set(probability, (signalCounts.get(probability) || 0) + 1);
});
const signalPopulation = [...signalCounts.values()].reduce((sum, count) => sum + count, 0);
const signalScoreByProbability = new Map();
let signalCursor = 0;
[...signalCounts.entries()].sort(([a], [b]) => a - b).forEach(([probability, count]) => {
  const midRank = signalCursor + (count + 1) / 2;
  signalScoreByProbability.set(probability, Math.round(100 * midRank / signalPopulation));
  signalCursor += count;
});
const signalBand = (score) => score >= 75 ? "Stronger" : score >= 40 ? "Typical" : "Lower";
data.projects.forEach((project) => {
  project._delivery_signal_score = signalScoreByProbability.get(Number(project.prob_operational_2y)) ?? null;
  project._delivery_signal_band = project._delivery_signal_score === null ? "Not available" : signalBand(project._delivery_signal_score);
});

const populateSelect = (selector, values) => {
  qs(selector).insertAdjacentHTML(
    "beforeend",
    [...new Set(values.filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b)))
      .map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join("")
  );
};
populateSelect("#technology-filter", data.projects.map((project) => project.technology));
populateSelect("#stage-filter", data.projects.map((project) => project.stage));
populateSelect("#region-filter", data.projects.map((project) => project.region));

const validCoverage = new Set(["all", "forecast", "unforecast"]);
const validSort = new Set(["capacity", "signal", "score", "name"]);
const applyExplorerStateFromUrl = () => {
  const params = new URLSearchParams(window.location.search);
  qs("#project-search").value = params.get("q") || "";
  qs("#technology-filter").value = params.get("technology") || "";
  qs("#stage-filter").value = params.get("stage") || "";
  qs("#region-filter").value = params.get("region") || "";
  qs("#project-sort").value = validSort.has(params.get("sort")) ? params.get("sort") : "capacity";
  return validCoverage.has(params.get("coverage")) ? params.get("coverage") : "all";
};
const initialCoverage = applyExplorerStateFromUrl();

const projectState = {
  page: 1,
  pageSize: 25,
  coverage: initialCoverage,
  filtered: data.projects,
};
qsa(".filter-chip").forEach((button) => button.classList.toggle("active", button.dataset.coverage === projectState.coverage));

function syncExplorerUrl() {
  const url = new URL(window.location.href);
  const values = {
    q: qs("#project-search").value.trim(),
    technology: qs("#technology-filter").value,
    stage: qs("#stage-filter").value,
    region: qs("#region-filter").value,
    coverage: projectState.coverage === "all" ? "" : projectState.coverage,
    sort: qs("#project-sort").value === "capacity" ? "" : qs("#project-sort").value,
  };
  Object.entries(values).forEach(([key, value]) => {
    if (value) url.searchParams.set(key, value);
    else url.searchParams.delete(key);
  });
  window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
}

async function copyText(value, message) {
  try {
    await navigator.clipboard.writeText(value);
  } catch {
    const input = document.createElement("textarea");
    input.value = value;
    input.setAttribute("readonly", "");
    input.style.position = "fixed";
    input.style.opacity = "0";
    document.body.appendChild(input);
    input.select();
    document.execCommand("copy");
    input.remove();
  }
  showToast(message);
}
const copyCurrentUrl = (message) => copyText(window.location.href, message);
const projectPath = (project) => `./projects/${encodeURIComponent(String(project.ref_id))}/`;
const permanentProjectUrl = (project) => new URL(projectPath(project), document.baseURI).href;
let storedShortlist = [];
try {
  storedShortlist = JSON.parse(localStorage.getItem("renewable-project-shortlist") || "[]");
} catch {
  storedShortlist = [];
}
const shortlist = new Set(storedShortlist.filter((index) => Number.isInteger(index) && data.projects[index]));

function projectBadge(project) {
  const risk = safeValue(project.screening_risk, "Unknown");
  return `<span class="risk-badge risk-${risk.toLowerCase()}">${escapeHtml(risk)} · ${formatNumber(project.screening_score)}</span>`;
}

function getFilteredProjects() {
  const query = qs("#project-search").value.trim().toLowerCase();
  const technology = qs("#technology-filter").value;
  const stage = qs("#stage-filter").value;
  const region = qs("#region-filter").value;
  const sort = qs("#project-sort").value;
  const filtered = data.projects.filter((project) => {
    const coverageMatch = projectState.coverage === "all"
      || (projectState.coverage === "forecast" && project.has_forecast)
      || (projectState.coverage === "unforecast" && !project.has_forecast);
    return coverageMatch
      && (!query || project._search.includes(query))
      && (!technology || project.technology === technology)
      && (!stage || project.stage === stage)
      && (!region || project.region === region);
  });
  const compareNumber = (key) => (a, b) => (Number(b[key]) || -1) - (Number(a[key]) || -1);
  filtered.sort(
    sort === "signal" ? compareNumber("_delivery_signal_score")
      : sort === "score" ? compareNumber("screening_score")
        : sort === "name" ? (a, b) => safeValue(a.site_name).localeCompare(safeValue(b.site_name))
          : compareNumber("capacity_mw")
  );
  return filtered;
}

function renderProjects(resetPage = false) {
  if (resetPage) projectState.page = 1;
  syncExplorerUrl();
  projectState.filtered = getFilteredProjects();
  const pageCount = Math.max(1, Math.ceil(projectState.filtered.length / projectState.pageSize));
  projectState.page = Math.min(projectState.page, pageCount);
  const start = (projectState.page - 1) * projectState.pageSize;
  const results = projectState.filtered.slice(start, start + projectState.pageSize);

  qs("#project-table").innerHTML = results.map((project) => `
    <tr>
      <td><a class="project-name-link" href="${projectPath(project)}">${escapeHtml(safeValue(project.site_name, "Unnamed project"))}</a><small>${escapeHtml(safeValue(project.operator, "Developer not reported"))}</small></td>
      <td>${escapeHtml(safeValue(project.technology))}</td>
      <td><span class="stage-label">${escapeHtml(safeValue(project.stage))}</span></td>
      <td class="numeric">${formatMw(project.capacity_mw)}</td>
      <td>${projectBadge(project)}</td>
      <td class="probability">
        ${project.has_forecast
          ? `<span class="mini-track"><span style="width:${project._delivery_signal_score}%"></span></span><strong>${formatNumber(project._delivery_signal_score)}/100</strong><small>${escapeHtml(project._delivery_signal_band)}</small>`
          : `<span class="not-modelled">Planning data only</span>`}
      </td>
      <td><div class="row-actions">
        <button class="shortlist-action ${shortlist.has(project._index) ? "active" : ""}" type="button" data-shortlist-index="${project._index}" aria-label="${shortlist.has(project._index) ? "Remove" : "Add"} ${escapeHtml(safeValue(project.site_name, "project"))} ${shortlist.has(project._index) ? "from" : "to"} shortlist">+</button>
        <button class="row-action" type="button" data-open-project="${project._index}" aria-label="Open ${escapeHtml(safeValue(project.site_name, "project"))} details">↗</button>
      </div></td>
    </tr>
  `).join("") || `<tr><td class="empty-state" colspan="7"><strong>No projects found.</strong><span>Try clearing a filter or using a broader search.</span></td></tr>`;

  const rangeEnd = Math.min(start + results.length, projectState.filtered.length);
  qs("#project-count").textContent = projectState.filtered.length
    ? `${formatNumber(start + 1)}–${formatNumber(rangeEnd)} of ${formatNumber(projectState.filtered.length)} projects`
    : "0 projects";
  qs("#page-status").textContent = `Page ${projectState.page} of ${pageCount}`;
  qs("#previous-page").disabled = projectState.page <= 1;
  qs("#next-page").disabled = projectState.page >= pageCount;
}

["#project-search", "#technology-filter", "#stage-filter", "#region-filter", "#project-sort"].forEach((selector) => {
  qs(selector).addEventListener("input", () => renderProjects(true));
});
qsa(".filter-chip").forEach((button) => {
  button.addEventListener("click", () => {
    qsa(".filter-chip").forEach((item) => item.classList.toggle("active", item === button));
    projectState.coverage = button.dataset.coverage;
    renderProjects(true);
  });
});
qs("#copy-explorer-link").addEventListener("click", () => {
  syncExplorerUrl();
  copyCurrentUrl("Explorer view link copied");
});
qs("#previous-page").addEventListener("click", () => {
  projectState.page -= 1;
  renderProjects();
  qs(".project-table-wrap").scrollIntoView({ behavior: "smooth", block: "start" });
});
qs("#next-page").addEventListener("click", () => {
  projectState.page += 1;
  renderProjects();
  qs(".project-table-wrap").scrollIntoView({ behavior: "smooth", block: "start" });
});

function factorList(value, emptyText) {
  const factors = safeValue(value, "").replace(/^\[|\]$/g, "").split(/[;|]/).map((item) => item.replace(/^['"\s]+|['"\s]+$/g, "")).filter(Boolean);
  return factors.length ? `<ul>${factors.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>` : `<p>${emptyText}</p>`;
}

let projectDetailsPromise;
const loadProjectDetails = () => {
  if (!projectDetailsPromise) {
    projectDetailsPromise = fetch("./project-details.json?v=20260802-dashboard-v3").then((response) => {
      if (!response.ok) throw new Error(`Project evidence request failed (${response.status})`);
      return response.json();
    });
  }
  return projectDetailsPromise;
};

function updateProjectUrl(refId) {
  const url = new URL(window.location.href);
  if (refId === null) url.searchParams.delete("project");
  else url.searchParams.set("project", String(refId));
  window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
}

function projectTimeline(project) {
  const milestones = [
    ["Planning submitted", project.planning_submitted],
    ["Planning granted", project.planning_granted],
    ["Construction started", project.under_construction],
    ["Became operational", project.operational],
    ["Latest public record", project.record_updated],
  ].filter(([, date]) => parseDate(date)).sort((a, b) => parseDate(a[1]) - parseDate(b[1]));
  if (!milestones.length) {
    return `<p class="project-timeline-empty">No dated planning milestones are available in the current public record.</p>`;
  }
  return `<ol class="project-timeline">${milestones.map(([label, date]) => `
    <li><strong>${escapeHtml(label)}</strong><time datetime="${parseDate(date).toISOString().slice(0, 10)}">${escapeHtml(formatDate(date))}</time></li>
  `).join("")}</ol>`;
}

function evidenceSpan(project) {
  const dates = [project.planning_submitted, project.planning_granted, project.under_construction, project.operational, project.record_updated]
    .map(parseDate).filter(Boolean).sort((a, b) => a - b);
  if (dates.length < 2) return null;
  const months = Math.max(0, Math.round((dates.at(-1) - dates[0]) / (1000 * 60 * 60 * 24 * 30.44)));
  return months >= 24 ? `${(months / 12).toFixed(1)} years` : `${months} months`;
}

async function openProject(project, { updateUrl = true } = {}) {
  const dialog = qs("#project-dialog");
  const requestedRef = String(project.ref_id);
  dialog.dataset.projectRef = requestedRef;
  qs("#project-dialog-content").innerHTML = `<div class="dialog-loading"><strong>${escapeHtml(safeValue(project.site_name, "Project evidence"))}</strong><span>Loading planning milestones and forecast evidence…</span></div>`;
  if (!dialog.open) dialog.showModal();
  if (updateUrl) updateProjectUrl(project.ref_id);

  let evidenceAvailable = true;
  try {
    const details = await loadProjectDetails();
    Object.assign(project, details[requestedRef] || {});
  } catch (error) {
    evidenceAvailable = false;
    console.warn("Project evidence could not be loaded", error);
  }
  if (dialog.dataset.projectRef !== requestedRef) return;

  const forecast = project.has_forecast ? `
    <div class="forecast-grid">
      <div><span>Two-year signal</span><strong>${formatNumber(project._delivery_signal_score)}/100</strong><small>${escapeHtml(project._delivery_signal_band)} relative evidence</small></div>
      <div><span>Three-year output</span><strong>Research only</strong><small>Not released as a probability</small></div>
      <div><span>Five-year output</span><strong>Withheld</strong><small>Insufficient validated cohorts</small></div>
    </div>
    <div class="signal-explainer"><strong>How to read this</strong><p>A score of ${formatNumber(project._delivery_signal_score)} means this project has stronger two-year model evidence than roughly ${formatNumber(project._delivery_signal_score)}% of the current forecast universe. It does not mean a ${formatNumber(project._delivery_signal_score)}% chance of delivery.</p></div>
    <div class="factor-grid">
      <div><h4>Positive evidence</h4>${factorList(project.positive_factors, "No additional positive factors recorded.")}</div>
      <div><h4>Risks and constraints</h4>${factorList(project.risk_factors, "No additional risk factors recorded.")}</div>
    </div>
  ` : `<div class="forecast-unavailable"><strong>No forward forecast for this record</strong><p>The project remains available for planning-data screening but is outside the current active forecast universe.</p></div>`;
  const span = evidenceSpan(project);

  qs("#project-dialog-content").innerHTML = `
    <p class="eyebrow">REPD ${escapeHtml(String(project.ref_id).padStart(5, "0"))}</p>
    <h2 id="dialog-title">${escapeHtml(safeValue(project.site_name, "Unnamed project"))}</h2>
    <p class="dialog-lede">${escapeHtml(safeValue(project.operator, "Developer not reported"))}</p>
    <div class="dialog-badges">${projectBadge(project)}<span class="stage-label">${escapeHtml(safeValue(project.stage))}</span></div>
    <div class="project-facts">
      <div><span>Technology</span><strong>${escapeHtml(safeValue(project.technology))}</strong></div>
      <div><span>Capacity</span><strong>${formatMw(project.capacity_mw)}</strong></div>
      <div><span>Region</span><strong>${escapeHtml(safeValue(project.region))}</strong></div>
      <div><span>County</span><strong>${escapeHtml(safeValue(project.county))}</strong></div>
      <div><span>Planning authority</span><strong>${escapeHtml(safeValue(project.planning_authority))}</strong></div>
      <div><span>Planning reference</span><strong>${escapeHtml(safeValue(project.planning_reference))}</strong></div>
      <div><span>Record updated</span><strong>${escapeHtml(formatDate(project.record_updated))}</strong></div>
      <div><span>CfD round</span><strong>${escapeHtml(safeValue(project.cfd_round))}</strong></div>
    </div>
    <div class="dialog-section">
      <p class="eyebrow">Public planning timeline</p>
      ${evidenceAvailable ? "" : `<p class="project-timeline-empty">Detailed planning evidence is temporarily unavailable. The summary record remains visible.</p>`}
      <div class="evidence-summary">
        <span class="evidence-chip"><strong>${escapeHtml(safeValue(project.stage))}</strong> current recorded stage</span>
        ${span ? `<span class="evidence-chip"><strong>${escapeHtml(span)}</strong> public record span</span>` : ""}
        ${project.forecast_confidence ? `<span class="evidence-chip"><strong>${escapeHtml(project.forecast_confidence)}</strong> public-data coverage</span>` : ""}
      </div>
      ${projectTimeline(project)}
    </div>
    <div class="dialog-section"><p class="eyebrow">Relative delivery evidence</p>${forecast}</div>
    <div class="dialog-actions">
      <button class="primary-button" type="button" data-shortlist-dialog="${project._index}">${shortlist.has(project._index) ? "Remove from shortlist" : "Add to shortlist"}</button>
      <a class="secondary-button" href="${projectPath(project)}">Open permanent page</a>
      <button class="secondary-button" type="button" data-brief-index="${project._index}">Download project brief</button>
      <button class="secondary-button" type="button" data-copy-project-link>Copy project link</button>
    </div>
    <p class="dialog-disclaimer">Screening scores and delivery signals are research prioritisation tools based on public data. They are not literal probabilities or investment advice.</p>
  `;
}

qs("#project-table").addEventListener("click", (event) => {
  const shortlistButton = event.target.closest("[data-shortlist-index]");
  if (shortlistButton) {
    toggleShortlist(Number(shortlistButton.dataset.shortlistIndex));
    return;
  }
  const button = event.target.closest("[data-open-project]");
  if (button) openProject(data.projects[Number(button.dataset.openProject)]);
});
qs("#project-dialog-content").addEventListener("click", (event) => {
  const shortlistButton = event.target.closest("[data-shortlist-dialog]");
  if (shortlistButton) {
    const index = Number(shortlistButton.dataset.shortlistDialog);
    toggleShortlist(index);
    openProject(data.projects[index], { updateUrl: false });
  }
  const briefButton = event.target.closest("[data-brief-index]");
  if (briefButton) downloadProjectBrief(data.projects[Number(briefButton.dataset.briefIndex)]);
  if (event.target.closest("[data-copy-project-link]")) {
    const refId = qs("#project-dialog").dataset.projectRef;
    const project = data.projects.find((item) => String(item.ref_id) === refId);
    if (project) copyText(permanentProjectUrl(project), "Permanent project link copied");
  }
});
qs(".dialog-close").addEventListener("click", () => qs("#project-dialog").close());
qs("#project-dialog").addEventListener("click", (event) => {
  if (event.target === qs("#project-dialog")) qs("#project-dialog").close();
});
qs("#project-dialog").addEventListener("close", () => {
  qs("#project-dialog").dataset.projectRef = "";
  updateProjectUrl(null);
});

qs("#export-projects").addEventListener("click", () => {
  const columns = [
    ["REPD reference", "ref_id"], ["Project", "site_name"], ["Operator", "operator"],
    ["Technology", "technology"], ["Stage", "stage"], ["Region", "region"],
    ["Capacity MW", "capacity_mw"], ["Screening score", "screening_score"],
    ["Screening risk", "screening_risk"], ["2-year delivery signal", "_delivery_signal_score"],
    ["Delivery signal band", "_delivery_signal_band"], ["Forecast use", "_forecast_use"],
  ];
  projectState.filtered.forEach((project) => { project._forecast_use = project.has_forecast ? "Ranking only" : "Planning data only"; });
  const csv = [
    columns.map(([label]) => csvCell(label)).join(","),
    ...projectState.filtered.map((project) => columns.map(([, key]) => csvCell(project[key])).join(",")),
  ].join("\n");
  downloadText("uk-renewable-projects-filtered.csv", csv, "text/csv;charset=utf-8");
});

function persistShortlist() {
  localStorage.setItem("renewable-project-shortlist", JSON.stringify([...shortlist]));
}

function toggleShortlist(index) {
  if (shortlist.has(index)) shortlist.delete(index);
  else shortlist.add(index);
  persistShortlist();
  renderShortlist();
  renderProjects();
}

function projectBrief(project) {
  return `UK Renewable Project Brief
==========================

Project: ${safeValue(project.site_name)}
REPD reference: ${String(project.ref_id).padStart(5, "0")}

Executive summary
-----------------
Technology: ${safeValue(project.technology)}
Installed capacity: ${formatMw(project.capacity_mw)}
Development status: ${safeValue(project.stage)}
Screening score: ${formatNumber(project.screening_score)}/100
Screening risk: ${safeValue(project.screening_risk)}

Developer and location
----------------------
Operator / applicant: ${safeValue(project.operator)}
Region: ${safeValue(project.region)}
County: ${safeValue(project.county)}
Country: ${safeValue(project.country)}

Planning evidence
-----------------
Planning authority: ${safeValue(project.planning_authority)}
Planning reference: ${safeValue(project.planning_reference)}
Planning submitted: ${formatDate(project.planning_submitted)}
Planning granted: ${formatDate(project.planning_granted)}
Under construction: ${formatDate(project.under_construction)}
Operational: ${formatDate(project.operational)}
Record updated: ${formatDate(project.record_updated)}

Delivery signal
---------------
Two-year relative signal: ${project.has_forecast ? `${formatNumber(project._delivery_signal_score)}/100 (${project._delivery_signal_band})` : "Not available"}
Three-year public output: ${project.has_forecast ? "Research only" : "Not available"}
Five-year public output: Withheld
Public-data coverage: ${safeValue(project.forecast_confidence)}
Permanent page: ${permanentProjectUrl(project)}

Interpretation
--------------
This is an early-stage screening summary based on public project data. The
delivery signal is a relative ranking, not a literal chance of delivery or
investment advice.

Generated by UK Renewable Infrastructure Intelligence.
`;
}

function downloadProjectBrief(project) {
  const filename = safeValue(project.site_name, "renewable-project")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  downloadText(`${filename || "renewable-project"}-brief.txt`, projectBrief(project));
}

function renderShortlist() {
  const selected = [...shortlist].map((index) => data.projects[index]).filter(Boolean);
  const capacity = selected.reduce((sum, project) => sum + (Number(project.capacity_mw) || 0), 0);
  const averageScore = selected.length
    ? selected.reduce((sum, project) => sum + (Number(project.screening_score) || 0), 0) / selected.length
    : 0;
  qs("#shortlist-count-chip").textContent = formatNumber(selected.length);
  qs("#shortlist-projects").textContent = formatNumber(selected.length);
  qs("#shortlist-capacity").textContent = formatMw(capacity, true);
  qs("#shortlist-score").textContent = selected.length ? `${averageScore.toFixed(1)}/100` : "—";
  qs("#download-shortlist").disabled = !selected.length;
  qs("#clear-shortlist").disabled = !selected.length;
  qs("#shortlist-table").innerHTML = selected.map((project) => `
    <tr>
      <td><strong>${escapeHtml(safeValue(project.site_name))}</strong><small>${escapeHtml(safeValue(project.operator))}</small></td>
      <td>${escapeHtml(safeValue(project.technology))}</td>
      <td>${escapeHtml(safeValue(project.region))}</td>
      <td>${formatMw(project.capacity_mw)}</td>
      <td>${projectBadge(project)}</td>
      <td><button class="shortlist-action active" type="button" data-remove-shortlist="${project._index}" aria-label="Remove ${escapeHtml(safeValue(project.site_name))} from shortlist">×</button></td>
    </tr>
  `).join("") || `<tr><td class="empty-state" colspan="6"><strong>Your shortlist is empty.</strong><span>Add projects from the register or a project brief.</span></td></tr>`;
}

qs("#shortlist-table").addEventListener("click", (event) => {
  const button = event.target.closest("[data-remove-shortlist]");
  if (button) toggleShortlist(Number(button.dataset.removeShortlist));
});
qs("#clear-shortlist").addEventListener("click", () => {
  shortlist.clear();
  persistShortlist();
  renderShortlist();
  renderProjects();
});
qs("#download-shortlist").addEventListener("click", () => {
  const columns = [
    ["REPD reference", "ref_id"], ["Project", "site_name"], ["Operator", "operator"],
    ["Technology", "technology"], ["Stage", "stage"], ["Region", "region"],
    ["Capacity MW", "capacity_mw"], ["Screening score", "screening_score"],
    ["Screening risk", "screening_risk"], ["2-year delivery signal", "_delivery_signal_score"],
    ["Delivery signal band", "_delivery_signal_band"],
  ];
  const selected = [...shortlist].map((index) => data.projects[index]).filter(Boolean);
  const csv = [
    columns.map(([label]) => csvCell(label)).join(","),
    ...selected.map((project) => columns.map(([, key]) => csvCell(project[key])).join(",")),
  ].join("\n");
  downloadText("renewable-project-shortlist.csv", csv, "text/csv;charset=utf-8");
});
renderShortlist();

let projectMap;
let projectMapLayer;
function renderMap() {
  const container = qs("#project-map");
  if (!window.L) {
    container.innerHTML = `<div class="empty-state"><strong>Map library unavailable.</strong><span>The rest of the dashboard remains available.</span></div>`;
    return;
  }
  if (!projectMap) {
    projectMap = L.map(container, { preferCanvas: true, zoomControl: true }).setView([54.7, -3.4], 5);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 18,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(projectMap);
  }
  if (projectMapLayer) projectMapLayer.remove();
  projectMapLayer = L.layerGroup().addTo(projectMap);
  const mapped = projectState.filtered.filter((project) => (
    Number.isFinite(Number(project.latitude))
    && Number.isFinite(Number(project.longitude))
    && Number(project.latitude) >= 49
    && Number(project.latitude) <= 61.5
    && Number(project.longitude) >= -9.5
    && Number(project.longitude) <= 3.5
  ));
  const density = qs("#map-density").value;
  const visible = density === "all"
    ? mapped
    : [...mapped].sort((a, b) => (Number(b.capacity_mw) || 0) - (Number(a.capacity_mw) || 0)).slice(0, Number(density));
  const bounds = [];
  visible.forEach((project) => {
    const risk = safeValue(project.screening_risk, "Unknown").toLowerCase();
    const capacity = Math.max(0, Number(project.capacity_mw) || 0);
    const marker = L.circleMarker([Number(project.latitude), Number(project.longitude)], {
      renderer: projectMap.options.renderer,
      radius: Math.max(3, Math.min(11, 2.5 + Math.sqrt(capacity) / 6)),
      color: "#ffffff",
      weight: 1.25,
      fillColor: risk === "high" ? "#a44d42" : risk === "medium" ? "#b97816" : "#087b72",
      fillOpacity: .82,
    });
    marker.bindPopup(`
      <strong>${escapeHtml(safeValue(project.site_name))}</strong>
      ${escapeHtml(safeValue(project.technology))} · ${formatMw(project.capacity_mw)}<br>
      ${escapeHtml(safeValue(project.stage))} · ${escapeHtml(safeValue(project.region))}<br>
      <button class="text-button map-open-project" type="button" data-map-open="${project._index}">Open project brief</button>
    `);
    marker.addTo(projectMapLayer);
    bounds.push([Number(project.latitude), Number(project.longitude)]);
  });
  qs("#map-summary").textContent = `${formatNumber(visible.length)} mapped projects shown · ${formatNumber(mapped.length)} filtered records have valid coordinates`;
  if (bounds.length) projectMap.fitBounds(bounds, { padding: [22, 22], maxZoom: 8 });
  window.setTimeout(() => projectMap.invalidateSize(), 50);
}
document.addEventListener("click", (event) => {
  const button = event.target.closest("[data-map-open]");
  if (button) openProject(data.projects[Number(button.dataset.mapOpen)]);
});
qs("#refresh-map").addEventListener("click", renderMap);
qs("#map-density").addEventListener("change", renderMap);

function renderRegional() {
  const regionMap = new Map();
  projectState.filtered.forEach((project) => {
    const name = safeValue(project.region, "Unknown");
    if (!regionMap.has(name)) regionMap.set(name, { name, projects: 0, capacity: 0, score: 0, offshore: 0, construction: 0, operational: 0 });
    const region = regionMap.get(name);
    const capacity = Number(project.capacity_mw) || 0;
    region.projects += 1;
    region.capacity += capacity;
    region.score += Number(project.screening_score) || 0;
    if (safeValue(project.technology, "").toLowerCase().includes("wind offshore")) region.offshore += capacity;
    if (safeValue(project.stage, "").toLowerCase().includes("construction")) region.construction += capacity;
    if (safeValue(project.stage, "").toLowerCase().includes("operational")) region.operational += capacity;
  });
  const regions = [...regionMap.values()];
  const maxCapacity = Math.max(1, ...regions.map((region) => region.capacity));
  const maxConstruction = Math.max(1, ...regions.map((region) => region.construction));
  const maxOffshore = Math.max(1, ...regions.map((region) => region.offshore));
  regions.forEach((region) => {
    region.averageScore = region.projects ? region.score / region.projects : 0;
    region.opportunity = (
      .40 * region.capacity / maxCapacity * 100
      + .25 * region.averageScore
      + .20 * region.construction / maxConstruction * 100
      + .15 * region.offshore / maxOffshore * 100
    );
  });
  regions.sort((a, b) => b.opportunity - a.opportunity);
  qs("#regional-table").innerHTML = regions.map((region) => `
    <tr><td><strong>${escapeHtml(region.name)}</strong></td><td>${formatNumber(region.projects)}</td><td>${formatMw(region.capacity, true)}</td><td>${region.averageScore.toFixed(1)}</td><td><strong>${region.opportunity.toFixed(1)}</strong></td></tr>
  `).join("") || `<tr><td class="empty-state" colspan="5">No regional records match the Explorer filters.</td></tr>`;
  renderQuickAnswer();
}

function renderQuickAnswer() {
  const answer = qs("#quick-answer").value;
  let projects = [...projectState.filtered];
  if (answer === "construction") {
    projects = projects.filter((project) => safeValue(project.stage, "").toLowerCase().includes("construction"))
      .sort((a, b) => Number(b.capacity_mw) - Number(a.capacity_mw));
  } else if (answer === "offshore") {
    projects = projects.filter((project) => safeValue(project.technology, "").toLowerCase().includes("wind offshore"))
      .sort((a, b) => Number(b.capacity_mw) - Number(a.capacity_mw));
  } else if (answer === "region") {
    projects.sort((a, b) => Number(b.capacity_mw) - Number(a.capacity_mw));
  } else {
    projects.sort((a, b) => Number(b.screening_score) - Number(a.screening_score) || Number(b.capacity_mw) - Number(a.capacity_mw));
  }
  qs("#answer-table").innerHTML = projects.slice(0, 10).map((project) => `
    <tr><td><button class="table-link" type="button" data-answer-open="${project._index}">${escapeHtml(safeValue(project.site_name))}</button><small>${escapeHtml(safeValue(project.region))}</small></td><td>${escapeHtml(safeValue(project.stage))}</td><td>${formatMw(project.capacity_mw, true)}</td><td>${formatNumber(project.screening_score)}</td></tr>
  `).join("") || `<tr><td class="empty-state" colspan="4">No projects match this answer.</td></tr>`;
}
qs("#quick-answer").addEventListener("change", renderQuickAnswer);
qs("#answer-table").addEventListener("click", (event) => {
  const button = event.target.closest("[data-answer-open]");
  if (button) openProject(data.projects[Number(button.dataset.answerOpen)]);
});

const comparisonProjects = [...data.projects].sort((a, b) => safeValue(a.site_name).localeCompare(safeValue(b.site_name)));
let comparisonInitialised = false;

function ensureComparisonInitialised() {
  if (comparisonInitialised) return;
  const comparisonOptions = comparisonProjects.map((project) => `<option value="${project._index}">${escapeHtml(safeValue(project.site_name))} · ${formatMw(project.capacity_mw, true)}</option>`).join("");
  qs("#compare-a").innerHTML = comparisonOptions;
  qs("#compare-b").innerHTML = comparisonOptions;
  if (comparisonProjects.length > 1) qs("#compare-b").value = String(comparisonProjects[1]._index);
  comparisonInitialised = true;
  renderComparison();
}

function renderComparison() {
  const a = data.projects[Number(qs("#compare-a").value)];
  const b = data.projects[Number(qs("#compare-b").value)];
  if (!a || !b) return;
  const rows = [
    ["Technology", safeValue(a.technology), safeValue(b.technology)],
    ["Capacity", formatMw(a.capacity_mw), formatMw(b.capacity_mw)],
    ["Development stage", safeValue(a.stage), safeValue(b.stage)],
    ["Region", safeValue(a.region), safeValue(b.region)],
    ["Operator / applicant", safeValue(a.operator), safeValue(b.operator)],
    ["Screening score", `${formatNumber(a.screening_score)}/100`, `${formatNumber(b.screening_score)}/100`],
    ["Risk level", safeValue(a.screening_risk), safeValue(b.screening_risk)],
    ["Two-year delivery signal", a.has_forecast ? `${formatNumber(a._delivery_signal_score)}/100 · ${a._delivery_signal_band}` : "Not available", b.has_forecast ? `${formatNumber(b._delivery_signal_score)}/100 · ${b._delivery_signal_band}` : "Not available"],
  ];
  qs("#compare-content").innerHTML = `
    <div class="table-wrap"><table class="comparison-table"><thead><tr><th>Metric</th><th>${escapeHtml(safeValue(a.site_name))}</th><th>${escapeHtml(safeValue(b.site_name))}</th></tr></thead><tbody>
      ${rows.map(([label, aValue, bValue]) => `<tr><td>${escapeHtml(label)}</td><td><strong>${escapeHtml(aValue)}</strong></td><td><strong>${escapeHtml(bValue)}</strong></td></tr>`).join("")}
    </tbody></table></div>
    <div class="mini-metric-grid">
      <div><span>${escapeHtml(safeValue(a.site_name))} screening</span><strong>${formatNumber(a.screening_score)}/100</strong><div class="comparison-meter"><span style="width:${Number(a.screening_score) || 0}%"></span></div></div>
      <div><span>${escapeHtml(safeValue(b.site_name))} screening</span><strong>${formatNumber(b.screening_score)}/100</strong><div class="comparison-meter"><span style="width:${Number(b.screening_score) || 0}%"></span></div></div>
      <div><span>Capacity difference</span><strong>${formatMw(Math.abs(Number(a.capacity_mw) - Number(b.capacity_mw)), true)}</strong></div>
    </div>`;
}
qs("#compare-a").addEventListener("change", renderComparison);
qs("#compare-b").addEventListener("change", renderComparison);

let gridLoaded = false;
async function refreshGrid() {
  const button = qs("#refresh-grid");
  button.disabled = true;
  button.textContent = "Refreshing…";
  qs("#grid-metrics").innerHTML = `<div><span>Status</span><strong>Loading…</strong></div>`;
  try {
    const [intensityResponse, generationResponse] = await Promise.all([
      fetch("https://api.carbonintensity.org.uk/intensity", { cache: "no-store" }),
      fetch("https://api.carbonintensity.org.uk/generation", { cache: "no-store" }),
    ]);
    if (!intensityResponse.ok || !generationResponse.ok) throw new Error("Grid API returned an error");
    const intensityPayload = await intensityResponse.json();
    const generationPayload = await generationResponse.json();
    const intensityRecord = intensityPayload.data?.[0] || {};
    const intensity = intensityRecord.intensity || {};
    const mix = generationPayload.data?.generationmix || [];
    const renewableFuels = new Set(["wind", "solar", "hydro", "biomass"]);
    const renewableShare = mix.reduce((sum, item) => sum + (renewableFuels.has(item.fuel) ? Number(item.perc) || 0 : 0), 0);
    const dominant = [...mix].sort((a, b) => Number(b.perc) - Number(a.perc))[0];
    qs("#grid-metrics").innerHTML = `
      <div><span>GB carbon intensity</span><strong>${formatNumber(intensity.actual ?? intensity.forecast)} gCO₂/kWh</strong></div>
      <div><span>Intensity index</span><strong>${escapeHtml(safeValue(intensity.index))}</strong></div>
      <div><span>Renewable share</span><strong>${renewableShare.toFixed(1)}%</strong></div>
      <div><span>Dominant fuel</span><strong>${escapeHtml(safeValue(dominant?.fuel))}</strong></div>`;
    qs("#grid-period").textContent = `Grid period · ${formatDate(intensityRecord.from)} to ${formatDate(intensityRecord.to)} · National Grid ESO Carbon Intensity API`;
    qs("#generation-chart").innerHTML = [...mix].sort((a, b) => Number(b.perc) - Number(a.perc)).map((item) => `
      <div class="generation-row"><span>${escapeHtml(safeValue(item.fuel))}</span><div class="generation-bar"><i style="width:${Math.max(0, Math.min(100, Number(item.perc) || 0))}%"></i></div><strong>${Number(item.perc).toFixed(1)}%</strong></div>
    `).join("");
    gridLoaded = true;
  } catch (error) {
    qs("#grid-metrics").innerHTML = `<div><span>Status</span><strong>Temporarily unavailable</strong></div>`;
    qs("#grid-period").textContent = "Live grid context could not be loaded. Project screening and the delivery signal remain available.";
    qs("#generation-chart").innerHTML = "";
    console.warn("Live grid request failed", error);
  } finally {
    button.disabled = false;
    button.textContent = "Refresh live data";
  }
}
qs("#refresh-grid").addEventListener("click", refreshGrid);

const offshoreProjects = data.projects
  .filter((project) => safeValue(project.technology, "").toLowerCase().includes("wind offshore"))
  .sort((a, b) => Number(b.capacity_mw) - Number(a.capacity_mw));
qs("#offshore-project").innerHTML = offshoreProjects.map((project) => `<option value="${project._index}">${escapeHtml(safeValue(project.site_name))} · ${formatMw(project.capacity_mw, true)}</option>`).join("");
const calculatorControls = {
  factor: qs("#capacity-factor"),
  turbine: qs("#turbine-rating"),
  price: qs("#electricity-price"),
  capex: qs("#capex-rate"),
  life: qs("#project-life"),
  carbon: qs("#grid-carbon"),
};
function updateOffshoreCalculator() {
  const project = data.projects[Number(qs("#offshore-project").value)];
  if (!project) return;
  const capacity = Number(project.capacity_mw) || 0;
  const factor = Number(calculatorControls.factor.value);
  const turbine = Number(calculatorControls.turbine.value);
  const price = Number(calculatorControls.price.value);
  const capexRate = Number(calculatorControls.capex.value);
  const life = Number(calculatorControls.life.value);
  const carbon = Number(calculatorControls.carbon.value);
  const annualEnergy = capacity * factor * 8760;
  const turbines = capacity / turbine;
  const revenue = annualEnergy * price;
  const capex = capacity * capexRate * 1_000_000;
  const payback = revenue > 0 ? capex / revenue : 0;
  const lifetimeRevenue = revenue * life;
  const annualCarbon = annualEnergy * carbon;
  qs("#capacity-factor-output").textContent = `${(factor * 100).toFixed(0)}%`;
  qs("#turbine-rating-output").textContent = `${turbine.toFixed(1)} MW`;
  qs("#electricity-price-output").textContent = `£${formatNumber(price)}/MWh`;
  qs("#capex-rate-output").textContent = `£${capexRate.toFixed(1)}m/MW`;
  qs("#project-life-output").textContent = `${life} years`;
  qs("#grid-carbon-output").textContent = `${carbon.toFixed(2)} kg/kWh`;
  qs("#calculator-project").innerHTML = `<div><span>Selected project</span><strong>${escapeHtml(safeValue(project.site_name))}</strong></div><div><span>Reported capacity · ${escapeHtml(safeValue(project.region))}</span><strong>${formatMw(capacity)}</strong></div>`;
  const results = [
    ["Annual energy", `${compactFormatter.format(annualEnergy)} MWh`],
    ["Indicative turbines", turbines.toFixed(1)],
    ["Annual revenue", `£${compactFormatter.format(revenue)}`],
    ["Indicative CAPEX", `£${compactFormatter.format(capex)}`],
    ["Simple payback", `${payback.toFixed(1)} years`],
    ["Lifetime revenue", `£${compactFormatter.format(lifetimeRevenue)}`],
    ["Annual carbon saving", `${compactFormatter.format(annualCarbon)} tCO₂e`],
    ["Lifetime carbon saving", `${compactFormatter.format(annualCarbon * life)} tCO₂e`],
  ];
  qs("#calculator-results").innerHTML = results.map(([label, value]) => `<div><span>${label}</span><strong>${value}</strong></div>`).join("");
}
Object.values(calculatorControls).forEach((control) => control.addEventListener("input", updateOffshoreCalculator));
qs("#offshore-project").addEventListener("change", updateOffshoreCalculator);
updateOffshoreCalculator();

qsa(".tool-tab").forEach((button) => {
  button.addEventListener("click", () => {
    qsa(".tool-tab").forEach((tab) => {
      const active = tab === button;
      tab.classList.toggle("active", active);
      tab.setAttribute("aria-selected", String(active));
    });
    qsa(".tool-panel").forEach((panel) => {
      const active = panel.id === `${button.dataset.tool}-panel`;
      panel.hidden = !active;
      panel.classList.toggle("active", active);
    });
    if (button.dataset.tool === "map") renderMap();
    if (button.dataset.tool === "regional") renderRegional();
    if (button.dataset.tool === "compare") ensureComparisonInitialised();
    if (button.dataset.tool === "grid" && !gridLoaded) refreshGrid();
  });
});

async function openProjectFromUrl() {
  const refId = new URLSearchParams(window.location.search).get("project");
  if (!refId) {
    if (qs("#project-dialog").open) qs("#project-dialog").close();
    return;
  }
  const project = data.projects.find((item) => String(item.ref_id) === refId);
  if (!project) {
    updateProjectUrl(null);
    showToast("That project is not present in this data snapshot");
    return;
  }
  await openProject(project, { updateUrl: false });
}

renderProjects();
await openProjectFromUrl();
window.addEventListener("popstate", async () => {
  projectState.coverage = applyExplorerStateFromUrl();
  qsa(".filter-chip").forEach((button) => button.classList.toggle("active", button.dataset.coverage === projectState.coverage));
  renderProjects(true);
  await openProjectFromUrl();
});
const mapObserver = new IntersectionObserver((entries) => {
  if (!entries.some((entry) => entry.isIntersecting)) return;
  renderMap();
  mapObserver.disconnect();
}, { rootMargin: "300px 0px" });
mapObserver.observe(qs("#workbench"));

const controls = {
  rate: qs("#rate-slider"),
  cost: qs("#cost-slider"),
  grid: qs("#grid-slider"),
  policy: qs("#policy-select"),
  cfd: qs("#cfd-check"),
};
const policyShift = { restrictive: -0.34, neutral: 0, supportive: 0.27 };
function updateScenario() {
  const rate = Number(controls.rate.value);
  const cost = Number(controls.cost.value);
  const grid = Number(controls.grid.value);
  const shift = (-0.18 * rate) + (-0.025 * cost) + (-0.32 * grid) + policyShift[controls.policy.value] + (controls.cfd.checked ? 0.24 : 0);
  const reference = 100;
  const scenario = Math.max(25, Math.min(220, reference * Math.exp(shift)));
  const delta = scenario / reference - 1;
  qs("#rate-output").textContent = `${rate >= 0 ? "+" : ""}${rate.toFixed(2)} pp`;
  qs("#cost-output").textContent = `${cost >= 0 ? "+" : ""}${cost.toFixed(0)}%`;
  qs("#grid-output").textContent = `${grid.toFixed(1)} years`;
  qs("#reference-value").textContent = `${formatNumber(reference)} index`;
  qs("#scenario-value").textContent = `${formatNumber(scenario)} index`;
  qs("#scenario-delta").textContent = `${delta >= 0 ? "+" : ""}${(100 * delta).toFixed(1)}% vs reference`;
  qs("#scenario-delta").classList.toggle("negative", delta < 0);
  qs("#scenario-bar").style.width = `${Math.min(100, Math.max(3, 100 * scenario / reference))}%`;
  qs("#scenario-note").textContent = Math.abs(shift) > .001
    ? `Combined assumptions imply ${Math.abs(100 * delta).toFixed(1)}% ${delta >= 0 ? "more supportive" : "more restrictive"} delivery conditions than the reference. This is a bounded sensitivity, not a causal forecast.`
    : "Current-conditions reference set to index 100.";
}

Object.values(controls).forEach((control) => control.addEventListener("input", updateScenario));
qs("#reset-scenario").addEventListener("click", () => {
  controls.rate.value = 0;
  controls.cost.value = 0;
  controls.grid.value = 0;
  controls.policy.value = "neutral";
  controls.cfd.checked = false;
  updateScenario();
});

qs("#macro-row").innerHTML = [
  ["Bank Rate", data.macro.bank_rate_pct],
  ["UK CPI", data.macro.cpi_annual_pct],
  ["Infrastructure costs", data.macro.construction_opi_annual_pct],
].map(([label, item]) => `<div class="macro-card"><strong>${item ? `${item.value.toFixed(1)}%` : "N/A"}</strong><span>${label}</span><small>${item ? formatDate(item.date, { month: "short", year: "numeric" }) : ""}</small></div>`).join("");
updateScenario();

qs("#panel-rows").textContent = formatNumber(data.kpis.panelRows);
qs("#linked-projects").textContent = formatNumber(data.kpis.linkedProjects);
qs("#intervals").textContent = formatNumber(data.kpis.survivalIntervals);

qs("#backtest-table").innerHTML = Object.entries(data.model.rollingAudit.horizons).map(([horizon, result]) => `
  <tr>
    <td>${horizon} years</td>
    <td>${formatNumber(result.testRows)}</td>
    <td>${Number(result.rocAuc).toFixed(3)}</td>
    <td>+${formatPercent(result.rawBrierPenaltyVsBaseRate)} vs base</td>
    <td><span class="model-status ${result.promotionDecision === "ranking signal only" ? "selected-model" : "rejected-model"}">${escapeHtml(result.promotionDecision)}</span></td>
  </tr>
`).join("");

const qualityCards = [
  {
    label: "Project-snapshot duplicates",
    value: formatNumber(data.quality.duplicateRows),
    description: "No duplicated analytical grain detected in the packaged project panel.",
    tone: "good",
  },
  {
    label: "Fallback entity keys",
    value: formatPercent(data.quality.fallbackKeyRate),
    description: "Records without stable reference IDs remain more vulnerable to imperfect history matching.",
    tone: "watch",
  },
  {
    label: "Independent snapshots",
    value: formatNumber(data.kpis.snapshots),
    description: "Too few independent time points to claim learned political or macroeconomic causality.",
    tone: "watch",
  },
];
qs("#quality-grid").innerHTML = qualityCards.map((card) => `<article class="quality-card"><span>${card.label}</span><strong>${card.value}</strong><p>${card.description}</p><i class="${card.tone}"></i></article>`).join("");
qs("#limitations-list").innerHTML = data.model.limitations.map((item) => `<li>${escapeHtml(item)}</li>`).join("");

const navLinks = qsa(".section-nav a");
const sections = navLinks.map((link) => document.querySelector(link.getAttribute("href"))).filter(Boolean);
const observer = new IntersectionObserver((entries) => {
  const visible = entries.filter((entry) => entry.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
  if (!visible) return;
  navLinks.forEach((link) => link.classList.toggle("active", link.getAttribute("href") === `#${visible.target.id}`));
}, { rootMargin: "-20% 0px -65% 0px", threshold: [0, .2, .5] });
sections.forEach((section) => observer.observe(section));
document.body.classList.remove("loading");
})().catch((error) => {
  console.error("Dashboard initialization failed", error);
  document.body.classList.remove("loading");
  document.body.classList.add("load-failed");
  const status = document.querySelector("#hero-expected");
  if (status && status.textContent === "Loading…") status.textContent = "Data unavailable";
  const table = document.querySelector("#project-table");
  if (table) {
    table.innerHTML = `<tr><td class="empty-state" colspan="7"><strong>The data view could not be loaded.</strong><span>Please refresh the page.</span></td></tr>`;
  }
});
