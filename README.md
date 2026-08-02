# UK Renewable Intelligence

[Live dashboard](https://uk-renewable-intelligence.github.io/) · [Modelling workspace](https://uk-renewable-project-screening.streamlit.app/)

A public decision-support dashboard for exploring the UK renewable project pipeline. It combines 13,009 Renewable Energy Planning Database records with transparent time-to-operation forecasts, project screening, geospatial analysis and bounded macroeconomic scenarios.

## What it does

- Searches and filters the complete 13,009-record public planning snapshot.
- Maps 12,980 projects with valid coordinates.
- Links 6,189 active projects to two-, three- and five-year operational forecasts.
- Shows dated planning evidence and shareable URLs for every project and filter view.
- Generates permanent HTML evidence pages for all 13,009 projects, plus a crawlable directory, XML sitemap and robots file.
- Supports regional ranking, shortlists, side-by-side comparison, live grid context and an offshore engineering calculator.
- Explains temporal back-tests, data quality and known model limitations in the product.

## Engineering highlights

- Static GitHub Pages deployment with no sign-in and no sleeping server.
- Framework-free JavaScript and accessible native controls.
- Leaflet/OpenStreetMap geospatial workbench.
- Summary-first loading: the overview payload is about 244 KB; the project index and evidence are loaded only when needed.
- Integrity tests rebuild all 13,009 records from the published data shards and compare every source field.
- Search-ready static generation adds unique titles, descriptions, canonical URLs, internal links and schema.org metadata without weakening the interactive dashboard.
- Forecast challengers are evaluated on temporal holdouts; the simpler survival baseline remains deployed when more complex candidates are less reliable.
- A rolling-origin calibration audit is saved in `analysis/forecast-audit.json`; the latest challenger did not clear the pre-declared promotion threshold, so production probabilities were not silently changed.

## Data flow

```mermaid
flowchart LR
    A["REPD public records"] --> B["Forecast and screening pipeline"]
    C["Bank of England and ONS context"] --> B
    B --> D["Validated dashboard snapshot"]
    D --> E["Portfolio summary"]
    D --> F["Project index"]
    D --> G["Lazy project evidence"]
    E --> H["GitHub Pages dashboard"]
    F --> H
    G --> H
```

## Run locally

Node.js 20 or newer is sufficient; the dashboard has no runtime package dependencies.

```bash
npm run build
npm run dev
```

Then open `http://127.0.0.1:4173/`. The build creates the dashboard, permanent project pages, methodology and about pages in `dist-static/`.

Run the data and static-build checks with:

```bash
npm test
```

The build can use either `src/dashboard-data.json` from the modelling pipeline or reconstruct the source snapshot from the three published JSON files in the repository root.

## Forecast audit

The audit requires the modelling workspace environment because it imports the survival pipeline and historical panel:

```bash
/path/to/offshore-energy-dashboard/.venv/bin/python \
  analysis/forecast_audit.py \
  --project-root /path/to/offshore-energy-dashboard \
  --output analysis/forecast-audit.json
```

The companion notebook summarises the saved result for review. Current evidence supports useful two-year ranking, but not a calibrated production upgrade across all horizons.

## Publishing

The GitHub Pages workflow builds and verifies the full static site before deployment. GitHub Pages must use **GitHub Actions** as its publishing source so the generated project pages in `dist-static/` are included without committing more than 13,000 generated HTML files.

## Model boundary

This is a research and early-stage screening tool, not investment advice. Public planning data cannot reveal private financing, land, supply-chain or contract terms, and the available historical snapshots are too limited to claim learned political or macroeconomic causality. External conditions are therefore exposed as explicit scenario assumptions rather than hidden inside the production forecast.
