const forecastQuery = (selector, root = document) => root.querySelector(selector);
const forecastQueryAll = (selector, root = document) => [...root.querySelectorAll(selector)];

const forecastState = {
  all: [],
  filtered: [],
  horizon: 3,
  page: 1,
  pageSize: 12,
  sort: "signal",
  map: null,
  mapLayer: null,
  mapReady: false,
};

const forecastNumber = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 0 });
const forecastDecimal = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 1 });
const formatForecastNumber = (value) => forecastNumber.format(Number(value) || 0);
const formatForecastMw = (value) => `${forecastNumber.format(Math.round(Number(value) || 0))} MW`;
const formatForecastCapacity = (value) => `${forecastDecimal.format(Number(value) || 0)} MW`;
const escapeForecastHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;",
}[character]));
const forecastProbability = (project, horizon = forecastState.horizon) => Number(project[`p${horizon}`]) || 0;
const forecastExpectedCapacity = (project, horizon = forecastState.horizon) => (
  (Number(project.capacity_mw) || 0) * forecastProbability(project, horizon)
);
const forecastSignalBand = (score) => {
  if (Number(score) >= 75) return "Stronger";
  if (Number(score) >= 40) return "Typical";
  return "Lower";
};

function forecastAggregate(projects, horizon = forecastState.horizon) {
  return projects.reduce((result, project) => {
    const capacity = Number(project.capacity_mw) || 0;
    result.capacity += capacity;
    result.expected += capacity * forecastProbability(project, horizon);
    if (Number(project.signal) >= 75) result.strongerCapacity += capacity;
    if (["Moderate", "High"].includes(String(project.confidence))) result.moderateCoverage += 1;
    return result;
  }, { capacity: 0, expected: 0, strongerCapacity: 0, moderateCoverage: 0 });
}

function forecastGroup(projects, field, horizon = forecastState.horizon) {
  const groups = new Map();
  projects.forEach((project) => {
    const label = String(project[field] || "Not reported");
    if (!groups.has(label)) groups.set(label, { label, projects: 0, capacity: 0, expected: 0 });
    const group = groups.get(label);
    group.projects += 1;
    group.capacity += Number(project.capacity_mw) || 0;
    group.expected += forecastExpectedCapacity(project, horizon);
  });
  return [...groups.values()].sort((a, b) => b.expected - a.expected || b.capacity - a.capacity);
}

function populateForecastSelect(id, values, allLabel) {
  const select = forecastQuery(id);
  select.innerHTML = `<option value="all">${escapeForecastHtml(allLabel)}</option>${values.map((value) => (
    `<option value="${escapeForecastHtml(value)}">${escapeForecastHtml(value)}</option>`
  )).join("")}`;
}

function forecastFilterDescription() {
  const parts = [];
  const technology = forecastQuery("#forecast-technology").value;
  const region = forecastQuery("#forecast-region").value;
  const stage = forecastQuery("#forecast-stage").value;
  const search = forecastQuery("#forecast-search").value.trim();
  if (technology !== "all") parts.push(technology);
  if (region !== "all") parts.push(region);
  if (stage !== "all") parts.push(stage);
  if (search) parts.push(`“${search}”`);
  return parts.length ? parts.join(" · ") : "All modelled projects";
}

function applyForecastFilters() {
  const search = forecastQuery("#forecast-search").value.trim().toLowerCase();
  const technology = forecastQuery("#forecast-technology").value;
  const region = forecastQuery("#forecast-region").value;
  const stage = forecastQuery("#forecast-stage").value;

  forecastState.filtered = forecastState.all.filter((project) => {
    const matchesSearch = !search || [project.site_name, project.operator, project.technology, project.region]
      .some((value) => String(value || "").toLowerCase().includes(search));
    return matchesSearch
      && (technology === "all" || project.technology === technology)
      && (region === "all" || project.region === region)
      && (stage === "all" || project.stage === stage);
  });
  forecastState.page = 1;
  renderForecastWorkbench();
}

function renderForecastKpis() {
  const aggregate = forecastAggregate(forecastState.filtered);
  const coverage = forecastState.filtered.length ? aggregate.moderateCoverage / forecastState.filtered.length : 0;
  forecastQuery("#forecast-kpi-projects").textContent = formatForecastNumber(forecastState.filtered.length);
  forecastQuery("#forecast-kpi-capacity").textContent = formatForecastMw(aggregate.capacity);
  forecastQuery("#forecast-kpi-expected").textContent = formatForecastMw(aggregate.expected);
  forecastQuery("#forecast-kpi-expected-label").textContent = `${forecastState.horizon}-year expected capacity`;
  forecastQuery("#forecast-kpi-stronger").textContent = formatForecastMw(aggregate.strongerCapacity);
  forecastQuery("#forecast-kpi-coverage").textContent = `${(100 * coverage).toFixed(1)}% moderate+ public-data coverage`;
  forecastQuery("#forecast-filter-status").textContent = `${formatForecastNumber(forecastState.filtered.length)} projects · ${forecastFilterDescription()} · ${forecastState.horizon}-year aggregate outlook`;
}

function renderForecastBars(containerSelector, rows, valueFormatter = formatForecastMw) {
  const container = forecastQuery(containerSelector);
  if (!rows.length || rows.every((row) => row.value <= 0)) {
    container.innerHTML = `<div class="forecast-empty">No forecast capacity is available for this view.</div>`;
    return;
  }
  const maximum = Math.max(...rows.map((row) => row.value), 1);
  container.innerHTML = rows.map((row) => `
    <div class="forecast-bar-row">
      <div class="forecast-bar-label"><strong title="${escapeForecastHtml(row.label)}">${escapeForecastHtml(row.label)}</strong><small>${escapeForecastHtml(row.detail)}</small></div>
      <div class="forecast-bar-track" aria-label="${escapeForecastHtml(row.label)} ${escapeForecastHtml(valueFormatter(row.value))}"><i style="width:${Math.max(1, 100 * row.value / maximum).toFixed(1)}%"></i></div>
      <b>${escapeForecastHtml(valueFormatter(row.value))}</b>
    </div>`).join("");
}

function renderForecastOverview() {
  const twoYear = forecastAggregate(forecastState.filtered, 2);
  const threeYear = forecastAggregate(forecastState.filtered, 3);
  const incremental = Math.max(0, threeYear.expected - twoYear.expected);
  forecastQuery("#forecast-outlook-strip").innerHTML = `
    <article><span>Expected within 2 years</span><strong>${formatForecastMw(twoYear.expected)}</strong><small>Aggregate research outlook</small></article>
    <article><span>Expected within 3 years</span><strong>${formatForecastMw(threeYear.expected)}</strong><small>Aggregate research outlook</small></article>
    <article><span>Year 2–3 increment</span><strong>${formatForecastMw(incremental)}</strong><small>Additional modelled capacity</small></article>`;

  const technologyRows = forecastGroup(forecastState.filtered, "technology")
    .slice(0, 7)
    .map((group) => ({ label: group.label, detail: `${formatForecastNumber(group.projects)} projects`, value: group.expected }));
  const stageRows = forecastGroup(forecastState.filtered, "stage")
    .map((group) => ({ label: group.label, detail: `${formatForecastMw(group.capacity)} pipeline`, value: group.expected }));
  forecastQueryAll("[data-forecast-horizon-label]").forEach((element) => { element.textContent = `${forecastState.horizon}-year`; });
  renderForecastBars("#forecast-technology-bars", technologyRows);
  renderForecastBars("#forecast-stage-bars", stageRows);
}

function sortedForecastProjects() {
  const rows = [...forecastState.filtered];
  if (forecastState.sort === "capacity") {
    return rows.sort((a, b) => (Number(b.capacity_mw) || 0) - (Number(a.capacity_mw) || 0) || Number(b.signal) - Number(a.signal));
  }
  if (forecastState.sort === "name") {
    return rows.sort((a, b) => String(a.site_name).localeCompare(String(b.site_name)));
  }
  return rows.sort((a, b) => Number(b.signal) - Number(a.signal) || (Number(b.capacity_mw) || 0) - (Number(a.capacity_mw) || 0));
}

function renderForecastTable() {
  const rows = sortedForecastProjects();
  const totalPages = Math.max(1, Math.ceil(rows.length / forecastState.pageSize));
  forecastState.page = Math.min(forecastState.page, totalPages);
  const start = (forecastState.page - 1) * forecastState.pageSize;
  const visibleRows = rows.slice(start, start + forecastState.pageSize);
  forecastQuery("#forecast-table-count").textContent = rows.length
    ? `Showing ${formatForecastNumber(start + 1)}–${formatForecastNumber(Math.min(start + forecastState.pageSize, rows.length))} of ${formatForecastNumber(rows.length)} projects`
    : "No projects match these filters";
  forecastQuery("#forecast-table-body").innerHTML = visibleRows.length ? visibleRows.map((project) => {
    const band = forecastSignalBand(project.signal);
    return `<tr>
      <td><a class="forecast-project-link" href="/projects/${encodeURIComponent(project.ref_id)}/">${escapeForecastHtml(project.site_name || "Unnamed project")}</a><span class="forecast-project-meta">${escapeForecastHtml(project.operator || `REPD ${project.ref_id}`)}</span></td>
      <td>${escapeForecastHtml(project.technology || "Not reported")}</td>
      <td>${escapeForecastHtml(project.region || "Not reported")}</td>
      <td>${escapeForecastHtml(project.stage || "Not reported")}</td>
      <td>${formatForecastCapacity(project.capacity_mw)}</td>
      <td class="signal-cell"><strong>${formatForecastNumber(project.signal)}/100</strong><span class="signal-band ${band.toLowerCase()}">${band}</span><span class="signal-track"><i style="width:${Math.max(1, Number(project.signal) || 0)}%"></i></span></td>
      <td>${escapeForecastHtml(project.confidence || "Limited")}</td>
      <td><a href="/projects/${encodeURIComponent(project.ref_id)}/">Evidence →</a></td>
    </tr>`;
  }).join("") : `<tr><td colspan="8"><div class="forecast-empty">Try removing one or more filters.</div></td></tr>`;
  forecastQuery("#forecast-page-label").textContent = `Page ${formatForecastNumber(forecastState.page)} of ${formatForecastNumber(totalPages)}`;
  forecastQuery("#forecast-page-previous").disabled = forecastState.page <= 1;
  forecastQuery("#forecast-page-next").disabled = forecastState.page >= totalPages;
}

function renderForecastScenario() {
  const aggregate = forecastAggregate(forecastState.filtered);
  const rate = Number(forecastQuery("#forecast-scenario-rate").value);
  const costs = Number(forecastQuery("#forecast-scenario-costs").value);
  const grid = Number(forecastQuery("#forecast-scenario-grid-delay").value);
  const power = Number(forecastQuery("#forecast-scenario-power").value);
  const policy = Number(forecastQuery("#forecast-scenario-policy").value);
  const shift = (-0.08 * rate) - (0.012 * costs) - (0.012 * grid) + (0.009 * power) + (0.10 * policy);
  const multiplier = Math.max(0.55, Math.min(1.45, Math.exp(shift)));
  const adjusted = aggregate.expected * multiplier;
  const delta = adjusted - aggregate.expected;
  const deltaPercent = aggregate.expected ? 100 * delta / aggregate.expected : 0;
  const policyLabels = { "-2": "Strongly restrictive", "-1": "Restrictive", "0": "Neutral", "1": "Supportive", "2": "Strongly supportive" };

  forecastQuery("#forecast-scenario-rate-value").textContent = `${rate >= 0 ? "+" : ""}${rate.toFixed(1)} pp`;
  forecastQuery("#forecast-scenario-costs-value").textContent = `${costs >= 0 ? "+" : ""}${costs}%`;
  forecastQuery("#forecast-scenario-grid-delay-value").textContent = `+${grid} months`;
  forecastQuery("#forecast-scenario-power-value").textContent = `${power >= 0 ? "+" : ""}${power}%`;
  forecastQuery("#forecast-scenario-policy-value").textContent = policyLabels[String(policy)];
  forecastQuery("#forecast-scenario-baseline").textContent = formatForecastMw(aggregate.expected);
  forecastQuery("#forecast-scenario-adjusted").textContent = formatForecastMw(adjusted);
  forecastQuery("#forecast-scenario-delta").textContent = `${delta >= 0 ? "+" : ""}${formatForecastMw(delta)} · ${deltaPercent >= 0 ? "+" : ""}${deltaPercent.toFixed(1)}% versus reference`;
  forecastQuery("#forecast-scenario-index").textContent = `${Math.round(multiplier * 100)} conditions index`;

  const drivers = [
    rate && `Rates ${rate > 0 ? "tighter" : "easier"}`,
    costs && `Materials ${costs > 0 ? "costlier" : "cheaper"}`,
    grid && `Grid +${grid}m`,
    power && `Power ${power > 0 ? "supportive" : "weaker"}`,
    policy && policyLabels[String(policy)],
  ].filter(Boolean);
  forecastQuery("#forecast-scenario-drivers").textContent = (drivers.length ? drivers : ["Reference assumptions"]).join(" · ");
}

function forecastMapColour(signal) {
  if (Number(signal) >= 75) return "#087b72";
  if (Number(signal) >= 40) return "#2e6f9e";
  return "#8fa1aa";
}

function ensureForecastMap() {
  if (forecastState.mapReady) return;
  forecastState.mapReady = true;
  if (!window.L) {
    forecastQuery("#forecast-map").innerHTML = `<div class="forecast-map-fallback">The map library could not load. Project rankings and all other forecast tools remain available.</div>`;
    return;
  }
  forecastState.map = window.L.map("forecast-map", { preferCanvas: true, zoomControl: true }).setView([54.7, -2.6], 5);
  window.L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 18,
    attribution: "&copy; OpenStreetMap contributors",
  }).addTo(forecastState.map);
  forecastState.mapLayer = window.L.layerGroup().addTo(forecastState.map);
  renderForecastMap();
}

function renderForecastMap() {
  if (!forecastState.map) return;
  forecastState.mapLayer.clearLayers();
  const located = forecastState.filtered
    .filter((project) => Number.isFinite(Number(project.latitude)) && Number.isFinite(Number(project.longitude)))
    .sort((a, b) => Number(b.signal) - Number(a.signal) || Number(b.capacity_mw) - Number(a.capacity_mw));
  const displayed = located.slice(0, 900);
  displayed.forEach((project) => {
    const radius = Math.max(4, Math.min(13, 4 + Math.sqrt(Math.max(0, Number(project.capacity_mw) || 0)) / 5));
    window.L.circleMarker([Number(project.latitude), Number(project.longitude)], {
      radius,
      color: forecastMapColour(project.signal),
      weight: 1,
      fillColor: forecastMapColour(project.signal),
      fillOpacity: 0.62,
    }).bindPopup(`<strong>${escapeForecastHtml(project.site_name || "Unnamed project")}</strong><br>${escapeForecastHtml(project.technology)} · ${formatForecastCapacity(project.capacity_mw)}<br>Delivery signal ${formatForecastNumber(project.signal)}/100<br><a href="/projects/${encodeURIComponent(project.ref_id)}/">Open evidence page →</a>`).addTo(forecastState.mapLayer);
  });
  forecastQuery("#forecast-map-count").textContent = displayed.length < located.length
    ? `Showing the ${formatForecastNumber(displayed.length)} strongest located records from ${formatForecastNumber(located.length)} matching projects`
    : `${formatForecastNumber(displayed.length)} located projects in this view`;
  if (displayed.length && displayed.length < 250) {
    const bounds = window.L.latLngBounds(displayed.map((project) => [Number(project.latitude), Number(project.longitude)]));
    forecastState.map.fitBounds(bounds.pad(0.12), { maxZoom: 8 });
  } else {
    forecastState.map.setView([54.7, -2.6], 5);
  }
  window.setTimeout(() => forecastState.map.invalidateSize(), 0);
}

function renderForecastWorkbench() {
  renderForecastKpis();
  renderForecastOverview();
  renderForecastTable();
  renderForecastScenario();
  if (forecastState.map) renderForecastMap();
}

function activateForecastTab(tabName, updateHash = true) {
  forecastQueryAll("[data-forecast-tab]").forEach((button) => {
    const active = button.dataset.forecastTab === tabName;
    button.setAttribute("aria-selected", String(active));
    button.tabIndex = active ? 0 : -1;
  });
  forecastQueryAll("[data-forecast-panel]").forEach((panel) => {
    panel.hidden = panel.dataset.forecastPanel !== tabName;
  });
  if (tabName === "map") ensureForecastMap();
  if (updateHash && window.history?.replaceState) window.history.replaceState(null, "", `#forecast-${tabName}`);
}

function downloadForecastCsv() {
  const rows = sortedForecastProjects();
  const fields = [
    ["REPD reference", "ref_id"], ["Project", "site_name"], ["Operator", "operator"],
    ["Technology", "technology"], ["Region", "region"], ["Stage", "stage"],
    ["Capacity MW", "capacity_mw"], ["Two-year delivery signal /100", "signal"], ["Public-data coverage", "confidence"],
  ];
  const quote = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;
  const csv = [fields.map(([label]) => quote(label)).join(","), ...rows.map((row) => fields.map(([, key]) => quote(row[key])).join(","))].join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `uk-renewable-delivery-signal-${forecastState.horizon}y.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

function bindForecastControls() {
  let searchTimer;
  forecastQuery("#forecast-search").addEventListener("input", () => {
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(applyForecastFilters, 120);
  });
  ["#forecast-technology", "#forecast-region", "#forecast-stage"].forEach((selector) => {
    forecastQuery(selector).addEventListener("change", applyForecastFilters);
  });
  forecastQuery("#forecast-reset").addEventListener("click", () => {
    forecastQuery("#forecast-search").value = "";
    forecastQuery("#forecast-technology").value = "all";
    forecastQuery("#forecast-region").value = "all";
    forecastQuery("#forecast-stage").value = "all";
    applyForecastFilters();
  });
  forecastQueryAll("[data-horizon]").forEach((button) => button.addEventListener("click", () => {
    forecastState.horizon = Number(button.dataset.horizon);
    forecastQueryAll("[data-horizon]").forEach((candidate) => candidate.setAttribute("aria-pressed", String(candidate === button)));
    renderForecastWorkbench();
  }));
  forecastQueryAll("[data-forecast-tab]").forEach((button) => button.addEventListener("click", () => activateForecastTab(button.dataset.forecastTab)));
  forecastQuery("#forecast-sort").addEventListener("change", (event) => {
    forecastState.sort = event.target.value;
    forecastState.page = 1;
    renderForecastTable();
  });
  forecastQuery("#forecast-page-previous").addEventListener("click", () => {
    forecastState.page = Math.max(1, forecastState.page - 1);
    renderForecastTable();
  });
  forecastQuery("#forecast-page-next").addEventListener("click", () => {
    forecastState.page += 1;
    renderForecastTable();
  });
  forecastQuery("#forecast-download").addEventListener("click", downloadForecastCsv);
  forecastQueryAll("[data-scenario-control]").forEach((control) => control.addEventListener("input", renderForecastScenario));
  forecastQuery("#forecast-scenario-reset").addEventListener("click", () => {
    forecastQueryAll("[data-scenario-control]").forEach((control) => { control.value = "0"; });
    renderForecastScenario();
  });
}

async function initialiseForecastWorkbench() {
  const workbench = forecastQuery("#forecast-workbench");
  try {
    const response = await fetch("/forecast-data.json?v=20260805-workbench-v1");
    if (!response.ok) throw new Error(`Forecast data request failed with ${response.status}`);
    const data = await response.json();
    forecastState.all = data.projects;
    forecastState.filtered = data.projects;
    populateForecastSelect("#forecast-technology", [...new Set(data.projects.map((project) => project.technology).filter(Boolean))].sort(), "All technologies");
    populateForecastSelect("#forecast-region", [...new Set(data.projects.map((project) => project.region).filter(Boolean))].sort(), "All regions");
    populateForecastSelect("#forecast-stage", [...new Set(data.projects.map((project) => project.stage).filter(Boolean))].sort(), "All stages");
    bindForecastControls();
    renderForecastWorkbench();
    forecastQuery("#forecast-loading").hidden = true;
    forecastQuery("#forecast-interface").hidden = false;
    const requestedTab = window.location.hash.replace("#forecast-", "");
    activateForecastTab(["overview", "projects", "scenario", "map"].includes(requestedTab) ? requestedTab : "overview", false);
    workbench.setAttribute("aria-busy", "false");
  } catch (error) {
    forecastQuery("#forecast-loading").classList.add("forecast-error");
    forecastQuery("#forecast-loading").innerHTML = `<div><strong>Forecast interface unavailable</strong><p>The evidence sections below remain accessible. Please reload the page to retry the data connection.</p></div>`;
    workbench.setAttribute("aria-busy", "false");
    console.error(error);
  }
}

initialiseForecastWorkbench();
