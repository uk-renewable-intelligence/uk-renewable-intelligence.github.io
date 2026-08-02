from __future__ import annotations

import json
from pathlib import Path

import pandas as pd
from pyproj import Transformer


SITE_ROOT = Path(__file__).resolve().parents[1]
PROJECT_ROOT = SITE_ROOT.parent
PROCESSED = PROJECT_ROOT / "data" / "processed"


def records(frame: pd.DataFrame) -> list[dict]:
    return json.loads(frame.to_json(orient="records", date_format="iso"))


forecast = pd.read_csv(PROCESSED / "latest_forecasts.csv.gz", low_memory=False)
forecast["capacity_mw"] = pd.to_numeric(forecast["capacity_mw"], errors="coerce").fillna(0)
raw_projects = pd.read_csv(
    PROJECT_ROOT / "data" / "renewable_projects.csv",
    encoding="latin1",
    low_memory=False,
)
raw_projects["capacity_mw"] = pd.to_numeric(
    raw_projects["Installed Capacity (MWelec)"],
    errors="coerce",
)
raw_projects = raw_projects.dropna(subset=["capacity_mw"]).copy()
raw_projects["x_coordinate"] = pd.to_numeric(
    raw_projects["X-coordinate"],
    errors="coerce",
)
raw_projects["y_coordinate"] = pd.to_numeric(
    raw_projects["Y-coordinate"],
    errors="coerce",
)
coordinate_mask = (
    raw_projects["x_coordinate"].between(0, 800_000)
    & raw_projects["y_coordinate"].between(0, 1_400_000)
)
transformer = Transformer.from_crs("EPSG:27700", "EPSG:4326", always_xy=True)
longitude, latitude = transformer.transform(
    raw_projects.loc[coordinate_mask, "x_coordinate"].to_numpy(),
    raw_projects.loc[coordinate_mask, "y_coordinate"].to_numpy(),
)
raw_projects["longitude"] = pd.NA
raw_projects["latitude"] = pd.NA
raw_projects.loc[coordinate_mask, "longitude"] = longitude
raw_projects.loc[coordinate_mask, "latitude"] = latitude
raw_projects["longitude"] = pd.to_numeric(raw_projects["longitude"], errors="coerce")
raw_projects["latitude"] = pd.to_numeric(raw_projects["latitude"], errors="coerce")

for column in (
    "prob_operational_2y",
    "prob_operational_3y",
    "prob_operational_5y",
):
    forecast[column] = pd.to_numeric(forecast[column], errors="coerce").fillna(0)

metrics = json.loads((PROCESSED / "model_metrics.json").read_text())
quality = json.loads((PROCESSED / "data_quality_report.json").read_text())
external = pd.read_csv(PROCESSED / "external_context.csv")

grouped = {}
for dimension in ("technology", "stage", "region"):
    table = (
        forecast.groupby(dimension, dropna=False)
        .agg(
            projects=("project_key", "size"),
            capacity_mw=("capacity_mw", "sum"),
            expected_3y_mw=("expected_capacity_3y_mw", "sum"),
        )
        .reset_index()
        .rename(columns={dimension: "name"})
        .sort_values("capacity_mw", ascending=False)
    )
    table["name"] = table["name"].fillna("Unknown")
    grouped[dimension] = records(table)

project_columns = [
    "ref_id",
    "prob_operational_2y",
    "prob_operational_3y",
    "prob_operational_5y",
    "forecast_confidence",
    "positive_factors",
    "risk_factors",
]
forecast_projects = forecast[project_columns].copy()


def normalise_ref_id(series: pd.Series) -> pd.Series:
    return (
        series.astype(str)
        .str.replace(r"\.0$", "", regex=True)
        .str.strip()
        .str.zfill(5)
    )


forecast_projects["join_ref_id"] = normalise_ref_id(forecast_projects["ref_id"])
raw_projects["join_ref_id"] = normalise_ref_id(raw_projects["Ref ID"])

projects = raw_projects[
    [
        "join_ref_id",
        "Ref ID",
        "Site Name",
        "Operator (or Applicant)",
        "Technology Type",
        "Region",
        "Country",
        "County",
        "Development Status (short)",
        "Installed Capacity (MWelec)",
        "Planning Authority",
        "Planning Application Reference",
        "CfD Allocation Round",
        "Record Last Updated (dd/mm/yyyy)",
        "Planning Application Submitted",
        "Planning Permission  Granted",
        "Under Construction",
        "Operational",
        "longitude",
        "latitude",
    ]
].rename(
    columns={
        "Ref ID": "ref_id",
        "Site Name": "site_name",
        "Operator (or Applicant)": "operator",
        "Technology Type": "technology",
        "Region": "region",
        "Country": "country",
        "County": "county",
        "Development Status (short)": "stage",
        "Installed Capacity (MWelec)": "capacity_mw",
        "Planning Authority": "planning_authority",
        "Planning Application Reference": "planning_reference",
        "CfD Allocation Round": "cfd_round",
        "Record Last Updated (dd/mm/yyyy)": "record_updated",
        "Planning Application Submitted": "planning_submitted",
        "Planning Permission  Granted": "planning_granted",
        "Under Construction": "under_construction",
        "Operational": "operational",
    }
)

projects = projects.merge(
    forecast_projects.drop(columns=["ref_id"]),
    on="join_ref_id",
    how="left",
    validate="one_to_one",
)
projects["has_forecast"] = projects["prob_operational_3y"].notna()


def screening_score(row: pd.Series) -> int:
    capacity = float(row["capacity_mw"])
    stage = str(row["stage"]).lower()
    technology = str(row["technology"]).lower()
    capacity_score = 35 if capacity >= 1000 else 28 if capacity >= 500 else 20 if capacity >= 100 else 12 if capacity >= 20 else 5
    planning_score = 35 if "operational" in stage else 30 if "construction" in stage else 25 if "granted" in stage or "awaiting" in stage else 15 if "application" in stage or "planning" in stage else 8
    technology_score = 20 if "wind offshore" in technology else 18 if "battery" in technology or "storage" in technology else 15 if "solar" in technology or "wind onshore" in technology else 10
    useful_fields = ("operator", "region", "county", "planning_authority", "planning_reference")
    data_score = min(
        10,
        sum(
            bool(pd.notna(row[field]) and str(row[field]).strip())
            for field in useful_fields
        )
        * 2,
    )
    return min(capacity_score + planning_score + technology_score + data_score, 100)


def screening_risk(row: pd.Series) -> str:
    stage = str(row["stage"]).lower()
    capacity = float(row["capacity_mw"])
    technology = str(row["technology"]).lower()
    points = 0 if "operational" in stage else 1 if "construction" in stage else 2 if "granted" in stage or "awaiting" in stage else 3 if "application" in stage or "planning" in stage else 4
    points += 2 if capacity >= 1000 else 1 if capacity >= 300 else 0
    points += int(pd.isna(row["planning_reference"]) or not str(row["planning_reference"]).strip())
    points += int("wind offshore" in technology)
    return "Low" if points <= 2 else "Medium" if points <= 5 else "High"


projects["screening_score"] = projects.apply(screening_score, axis=1)
projects["screening_risk"] = projects.apply(screening_risk, axis=1)
projects = projects.drop(columns=["join_ref_id"]).sort_values("capacity_mw", ascending=False)

updated_dates = pd.to_datetime(
    raw_projects["Record Last Updated (dd/mm/yyyy)"],
    dayfirst=True,
    errors="coerce",
)

macro_latest = {}
for column in (
    "bank_rate_pct",
    "cpi_annual_pct",
    "construction_opi_annual_pct",
):
    valid = external.dropna(subset=[column])
    if not valid.empty:
        row = valid.iloc[-1]
        macro_latest[column] = {
            "value": round(float(row[column]), 2),
            "date": str(row["date"]),
        }

backtests = []
for horizon, result in metrics["models"].items():
    for candidate, values in result["candidates"].items():
        backtests.append(
            {
                "horizon": int(horizon),
                "candidate": candidate,
                "roc_auc": round(float(values["roc_auc"]), 4),
                "brier_score": round(float(values["brier_score"]), 4),
                "average_precision": round(float(values["average_precision"]), 4),
                "selected": candidate == result["selected_candidate"],
            }
        )

payload = {
    "generatedAt": metrics["generated_at"],
    "latestSnapshot": metrics["latest_snapshot"],
    "kpis": {
        "activeProjects": int(len(forecast)),
        "datasetProjects": int(len(projects)),
        "forecastCoverage": int(projects["has_forecast"].sum()),
        "pipelineCapacityMw": round(float(forecast["capacity_mw"].sum())),
        "expected2yMw": round(float(forecast["expected_capacity_2y_mw"].sum())),
        "expected3yMw": round(float(forecast["expected_capacity_3y_mw"].sum())),
        "expected5yMw": round(float(forecast["expected_capacity_5y_mw"].sum())),
        "snapshots": int(metrics["snapshots"]),
        "panelRows": int(metrics["panel_rows"]),
        "linkedProjects": int(metrics["projects"]),
        "survivalIntervals": int(metrics["survival_training_rows"]),
    },
    "dataset": {
        "latestRecordUpdate": updated_dates.max().strftime("%Y-%m-%d"),
        "source": "UK Renewable Energy Planning Database",
    },
    "model": {
        "version": metrics["model_version"],
        "selected": metrics["selected_model"],
        "releaseStatus": metrics["release_status"],
        "backtests": backtests,
        "limitations": metrics["known_limitations"],
    },
    "quality": {
        "readiness": quality["readiness"],
        "duplicateRows": quality["duplicate_snapshot_project_rows"],
        "fallbackKeyRate": quality["fallback_project_key_rate"],
        "issues": quality["issues"],
    },
    "macro": macro_latest,
    "groups": grouped,
    "projects": records(projects.where(pd.notna(projects), None)),
    "portfolio": forecast[
        [
            "capacity_mw",
            "prob_operational_2y",
            "prob_operational_3y",
            "prob_operational_5y",
        ]
    ].round(6).values.tolist(),
}

output = SITE_ROOT / "src" / "dashboard-data.json"
output.write_text(json.dumps(payload, separators=(",", ":"), ensure_ascii=False))
print(f"Saved {output} ({output.stat().st_size:,} bytes)")
