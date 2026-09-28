# UK Renewable Infrastructure Intelligence

An independent decision-support platform built from 13,009 UK renewable planning records. I reconstructed project histories, developed time-to-operation models and tested them on later project cohorts.

When validation showed that the data supported useful relative ranking but not reliable literal probabilities, I withheld project-level probabilities from the public ranking interface and redesigned it around the evidence the model could support.

**Evidence boundary:** the historical panel contains only **15 independent REPD snapshots**. Forecast v2.2 releases a two-year relative ranking. Probability calibration did not clear the release criterion; the five-year output remains withheld. Experimental capacity aggregates and the separate Python modelling workspace retain research scores for inspection, with no claim that aggregation makes them calibrated.

## For portfolio reviewers — 2-minute tour

1. [Open the live dashboard](https://uk-renewable-intelligence.github.io/) and inspect a project record.
2. [Review the forecasting evidence](https://uk-renewable-intelligence.github.io/forecasting/#model-evidence), including the temporal test cohort and baseline comparison.
3. [See why literal probabilities were withheld](https://uk-renewable-intelligence.github.io/forecasting/#forecast-performance).
4. [Read the engineering case study](https://uk-renewable-intelligence.github.io/about/) and inspect the [modelling methodology](https://github.com/hj-nakamura421/uk-renewable-energy-dashboard/blob/main/METHODOLOGY.md), [calibration audit](analysis/forecast_audit.py) and [challenger evaluation](analysis/forecast_challenger.py).

**Release versions:** this web platform is **2.2.0**; its public forecasting release is **v2.2**. The separate Python workspace retains its own package version and Model v2 research pipeline.

## What I engineered

- Reconciled changing REPD schemas, linked records across snapshots and reconstructed project histories in the [Python data pipeline](https://github.com/hj-nakamura421/uk-renewable-energy-dashboard/blob/main/src/repd_clean.py).
- Built censored time-to-event forecasting and compared empirical survival, logistic and CatBoost candidates in the [modelling workspace](https://github.com/hj-nakamura421/uk-renewable-energy-dashboard/blob/main/src/model.py).
- Designed temporal holdouts, removed test projects from training histories and evaluated ranking separately from probability calibration in the [rolling-origin audit](analysis/forecast_audit.py).
- Implemented independent release gates for each horizon and evaluated a CatBoost tie-breaker in the [challenger analysis](analysis/forecast_challenger.py).
- Built the public [JavaScript/Leaflet interface](src/app.js), including mapping, filtering, shortlists, project comparison, live grid context and an offshore engineering calculator.
- Implemented bounded scenario analysis and documented the treatment of potential external inputs in the [driver register](analysis/external-driver-registry.json).
- Built [static generation](scripts/build-static.mjs) for 13,009 permanent project pages, searchable directories and downloadable data.
- Automated [data-integrity checks](scripts/smoke-test.mjs) and [GitHub Pages deployment](.github/workflows/deploy-pages.yml). The checks reconstruct all project records from the published data shards and compare every source field.

## Modelling in plain English

**Survival modelling** estimates how the chance of reaching operation changes as a project spends longer in development.

**Censoring** means a project whose history ends before its outcome is known contributes only its observed follow-up; it is not counted as a failure just because it has not yet opened.

The public two-year ranking combines an empirical survival baseline with a CatBoost tie-breaker. CatBoost orders projects only when the baseline gives them the same score. A percentile of 80 means stronger model evidence than roughly 80% of the current forecast universe; it is not an 80% chance of delivery.

On the latest fully observed two-year cohort (origin **27 March 2024**, **4,019 rows**, **63 observed events**), the tie-breaker raised ROC-AUC from **0.767 to 0.791** and average precision from **0.043 to 0.073**. These are ranking measures. They do not establish probability reliability. Inspect the [saved challenger report](analysis/forecast-challenger.json) and [calibration audit](analysis/forecast-audit.json) for the full evidence.

## What failed / what I changed

| Finding | Engineering decision |
|---|---|
| Earlier fixed-horizon evaluation included cohorts without enough follow-up, producing misleading outcomes. | Rebuilt targets with censoring, fully observed test cohorts and project-purged temporal splits. |
| Probability calibration candidates did not beat the historical base-rate Brier benchmark by the required 2%, while preserving ranking and at least three rolling cohorts. | Withheld literal project probabilities; published a relative two-year ranking and the failed release evidence. |
| The standalone CatBoost challenger ranked worse than the empirical baseline on the latest cohort. | Retained the empirical ordering and promoted only the within-bucket tie-breaker that passed the ranking gate. |
| Too few fully observed cohorts support the five-year horizon. | Withheld the five-year public output. |
| Only 15 independent snapshot dates are available for learning macroeconomic effects. | Kept rates, costs, policy and grid assumptions in a separate scenario layer. |

## Development timeline

- **Initial prototype / v1:** project exploration and fixed-horizon prediction; subsequent review exposed incomplete-follow-up bias.
- **Model v2:** reconstructed histories, annual survival intervals, censoring, temporal holdouts and empirical/logistic/CatBoost comparisons. The Python pipeline remains a research workspace.
- **Public ranking release:** audited probability calibration and replaced project-level percentages with a relative delivery signal; withheld the five-year output.
- **Forecast v2.2:** retained the empirical baseline, added the evaluated CatBoost tie-breaker, and published the interactive forecast workbench with evidence and release status.

## External conditions and limitations

Bank Rate, electricity prices, construction and materials costs, grid delay, policy support and developer stress can affect delivery. The scenario controls explore explicit assumptions; their coefficients have not been learned as causal effects. Thousands of projects observed on one date still provide only one observation of that date's economic environment. The 15-snapshot history is too limited to justify causal political, news or inflation claims.

The workbench retains experimental two- and three-year capacity aggregates computed from research scores. They inherit the probability-calibration limitations and are not validated capacity forecasts. Raw research fields remain in the downloadable evidence for reproducibility.

REPD coverage and field definitions change over time; project linking can be imperfect. Public records do not reveal private finance, land agreements, detailed grid studies or confidential contracts. This is a research and early-stage screening tool, not investment advice.

## Run locally

Node.js 20 or newer is sufficient; the dashboard has no runtime package dependencies.

```bash
git clone https://github.com/uk-renewable-intelligence/uk-renewable-intelligence.github.io.git
cd uk-renewable-intelligence.github.io
npm run build
npm run dev
```

Open `http://127.0.0.1:4173/`. The source entry point is [`src/index.html`](src/index.html); the build writes the dashboard, fallback page, project pages, forecasting evidence and About page to `dist-static/`.

```bash
npm test
```

The build accepts `src/dashboard-data.json` from the modelling pipeline, or reconstructs the snapshot from the three published JSON files in the repository root. These root JSON files are build inputs, not an alternative interface.

## Reproduce the forecast audit

Clone the [Python modelling repository](https://github.com/hj-nakamura421/uk-renewable-energy-dashboard) into a sibling directory and install its dependencies with `uv sync`. From this web repository, run:

```bash
../uk-renewable-energy-dashboard/.venv/bin/python analysis/forecast_audit.py \
  --project-root ../uk-renewable-energy-dashboard \
  --output analysis/forecast-audit.json

../uk-renewable-energy-dashboard/.venv/bin/python analysis/forecast_challenger.py \
  --project-root ../uk-renewable-energy-dashboard \
  --report analysis/forecast-challenger.json \
  --scores analysis/forecast-challenger-scores.json
```

The [companion notebook](analysis/forecast_audit.ipynb) summarises the saved audit. The public build consumes the saved evidence; it does not retrain models when a visitor opens the site.

## Publishing

GitHub Pages uses **GitHub Actions**. The workflow builds, verifies and deploys **only `dist-static/`**. Root `index.html` and `404.html` are intentionally absent and ignored so an obsolete generated interface cannot contradict the source. Historical versions remain recoverable in Git history.

The [About page](https://uk-renewable-intelligence.github.io/about/) also links to the [Formula Student EV Test-Data Debrief](https://imperial-fs-telemetry.streamlit.app/), an independent portfolio prototype using synthetic demonstration data, and its [engineering case study and source](https://github.com/hj-nakamura421/imperial-fs-telemetry#readme). It is not an official Imperial Formula Student tool or team dataset.

HJ Nakamura · Mechanical Engineering, Imperial College London
