# UK Renewable Intelligence

[Live dashboard](https://uk-renewable-intelligence.github.io/) · [Modelling workspace](https://uk-renewable-project-screening.streamlit.app/)

A public decision-support dashboard for exploring the UK renewable project pipeline. It combines 13,009 Renewable Energy Planning Database records with an audited relative delivery signal, project screening, geospatial analysis and bounded macroeconomic scenarios.

## What it does

- Searches and filters the complete 13,009-record public planning snapshot.
- Maps 12,980 projects with valid coordinates.
- Links 6,189 active projects to a validated AI-enhanced two-year relative delivery signal.
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
- Forecast challengers are evaluated on temporal holdouts and each horizon has an independent release gate.
- Forecast v2.2 preserves the stronger empirical survival ordering and uses a richer CatBoost model only to resolve ties. On the latest untouched two-year cohort, ROC-AUC improves from 0.767 to 0.791 and average precision from 0.043 to 0.073.
- A rolling-origin calibration audit is saved in `analysis/forecast-audit.json`; literal probabilities and the five-year output are withheld because no calibrated model clears the declared production threshold.
- The useful two-year ranking information is published as a percentile signal, with an explicit warning that the score is not a chance of delivery.
- The external-driver register separates live project features, editable scenarios and research-only inputs, preventing news or market data from entering the model without dated backtests.

## Data flow

```mermaid
flowchart LR
    A["Dated REPD project histories"] --> B["Empirical survival ordering"]
    A --> C["Richer CatBoost challenger"]
    B --> D["AI tie-break ranking"]
    C --> D
    E["Rates, prices, materials, grid, policy and developer stress"] --> F["Transparent scenario layer"]
    D --> G["Validated dashboard snapshot"]
    F --> G
    G --> H["Portfolio summary and project evidence"]
    H --> I["GitHub Pages dashboard"]
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

The companion notebook summarises the saved result for review. Current evidence supports useful two-year ranking, but not literal project probabilities; the five-year horizon remains withheld.

Run the richer direct-horizon challenger and regenerate the AI tie-break scores with:

```bash
/path/to/offshore-energy-dashboard/.venv/bin/python \
  analysis/forecast_challenger.py \
  --project-root /path/to/offshore-energy-dashboard \
  --report analysis/forecast-challenger.json \
  --scores analysis/forecast-challenger-scores.json
```

The public build consumes the saved challenger evidence only when its ranking promotion gate passes. Candidate external variables and their current treatment are declared in `analysis/external-driver-registry.json`.

## Publishing

The GitHub Pages workflow builds and verifies the full static site before deployment. GitHub Pages must use **GitHub Actions** as its publishing source so the generated project pages in `dist-static/` are included without committing more than 13,000 generated HTML files.

## Model boundary

This is a research and early-stage screening tool, not investment advice. Public planning data cannot reveal private financing, land, supply-chain or contract terms, and the available historical snapshots are too limited to claim learned political or macroeconomic causality. External conditions are therefore exposed as explicit scenario assumptions rather than hidden inside the production forecast.
