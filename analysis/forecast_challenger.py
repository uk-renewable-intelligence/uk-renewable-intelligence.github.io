from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd
from catboost import CatBoostClassifier
from sklearn.compose import ColumnTransformer
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import average_precision_score, brier_score_loss, roc_auc_score
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler


NUMERIC_FEATURES = [
    "log_capacity_mw",
    "project_age_years",
    "stage_rank",
    "planning_reference_present",
    "planning_granted_flag",
    "under_construction_flag",
    "data_completeness",
    "cfd_flag",
    "months_in_current_stage",
    "stage_changes_count",
    "capacity_revision_count",
    "capacity_change_pct_from_first",
    "months_since_planning_submitted",
    "months_since_planning_granted",
    "months_since_construction_started",
    "observations_to_date",
    "developer_projects_prior",
    "developer_operations_prior",
    "developer_completion_rate_prior",
    "technology_region_projects_prior",
    "technology_region_operations_prior",
    "technology_region_completion_rate_prior",
    "operator_active_projects",
    "operator_active_capacity_mw",
    "technology_region_active_projects",
    "technology_region_active_capacity_mw",
    "authority_active_projects",
    "authority_active_capacity_mw",
]

CATEGORICAL_FEATURES = [
    "technology",
    "region",
    "country",
    "stage",
    "planning_authority",
]

FEATURES = NUMERIC_FEATURES + CATEGORICAL_FEATURES


def add_origin_context(featured: pd.DataFrame) -> pd.DataFrame:
    """Add only information observable in each origin-date cross-section."""

    result = featured.copy()
    active = result["stage"].isin(
        {"Inception", "Other", "Planning", "Consented", "Under Construction"}
    )
    result["active_capacity"] = result["capacity_mw"].where(active, 0).fillna(0)
    result["active_project"] = active.astype(int)

    group_specs = {
        "operator": "operator",
        "technology_region": ["technology", "region"],
        "authority": "planning_authority",
    }
    for prefix, keys in group_specs.items():
        group_keys = ["snapshot_date", *([keys] if isinstance(keys, str) else keys)]
        grouped = result.groupby(group_keys, dropna=False)
        result[f"{prefix}_active_projects"] = grouped["active_project"].transform("sum")
        result[f"{prefix}_active_capacity_mw"] = grouped["active_capacity"].transform("sum")
    return result.drop(columns=["active_capacity", "active_project"])


def prepare_catboost(frame: pd.DataFrame) -> pd.DataFrame:
    prepared = frame[FEATURES].copy()
    for column in CATEGORICAL_FEATURES:
        prepared[column] = prepared[column].fillna("Unknown").astype(str).replace("", "Unknown")
    for column in NUMERIC_FEATURES:
        prepared[column] = pd.to_numeric(prepared[column], errors="coerce")
    return prepared


def build_catboost() -> CatBoostClassifier:
    return CatBoostClassifier(
        iterations=240,
        depth=5,
        learning_rate=0.035,
        loss_function="Logloss",
        eval_metric="AUC",
        l2_leaf_reg=12,
        random_seed=42,
        allow_writing_files=False,
        thread_count=-1,
        verbose=False,
    )


def build_logistic() -> Pipeline:
    numeric = Pipeline(
        [("imputer", SimpleImputer(strategy="median")), ("scale", StandardScaler())]
    )
    categorical = Pipeline(
        [
            ("imputer", SimpleImputer(strategy="most_frequent")),
            ("onehot", OneHotEncoder(handle_unknown="ignore", min_frequency=20)),
        ]
    )
    return Pipeline(
        [
            (
                "features",
                ColumnTransformer(
                    [
                        ("numeric", numeric, NUMERIC_FEATURES),
                        ("categorical", categorical, CATEGORICAL_FEATURES),
                    ]
                ),
            ),
            ("model", LogisticRegression(C=0.12, max_iter=2500, random_state=42)),
        ]
    )


def metrics(target: pd.Series, prediction: np.ndarray) -> dict[str, float | int]:
    values = np.asarray(prediction, dtype=float)
    return {
        "rows": int(len(target)),
        "events": int(target.sum()),
        "event_rate": float(target.mean()),
        "mean_prediction": float(values.mean()),
        "roc_auc": float(roc_auc_score(target, values)),
        "average_precision": float(average_precision_score(target, values)),
        "brier_score": float(brier_score_loss(target, np.clip(values, 1e-6, 1 - 1e-6))),
    }


def evaluate_horizon(
    featured: pd.DataFrame,
    horizon: int,
    model_module: Any,
) -> tuple[dict[str, Any], pd.DataFrame]:
    outcomes = model_module.make_horizon_outcomes(featured, horizon)
    dates = [pd.Timestamp(value) for value in sorted(outcomes["snapshot_date"].unique())]
    rolling: list[pd.DataFrame] = []
    cohort_reports: list[dict[str, Any]] = []

    for origin_date in dates[2:]:
        test = outcomes[outcomes["snapshot_date"].eq(origin_date)].copy()
        test_projects = set(test["project_key"].astype(str))
        train = outcomes[
            outcomes["snapshot_date"].lt(origin_date)
            & ~outcomes["project_key"].astype(str).isin(test_projects)
        ].copy()
        hazard_train = model_module.make_survival_rows(
            featured,
            origin_before=origin_date,
            excluded_projects=test_projects,
        )
        if (
            len(train) < 500
            or train["target"].nunique() < 2
            or test["target"].nunique() < 2
            or len(hazard_train) < 500
            or hazard_train["target"].nunique() < 2
        ):
            continue

        empirical = model_module.build_empirical_model().fit(
            hazard_train, hazard_train["target"]
        )
        empirical_prediction = model_module.predict_cumulative_probability(
            empirical, test, horizon
        )

        catboost = build_catboost()
        catboost.fit(
            prepare_catboost(train),
            train["target"].to_numpy(),
            cat_features=CATEGORICAL_FEATURES,
        )
        catboost_prediction = catboost.predict_proba(prepare_catboost(test))[:, 1]

        logistic = build_logistic().fit(train[FEATURES], train["target"])
        logistic_prediction = logistic.predict_proba(test[FEATURES])[:, 1]

        frame = pd.DataFrame(
            {
                "snapshot_date": origin_date,
                "project_key": test["project_key"].astype(str).to_numpy(),
                "target": test["target"].to_numpy(),
                "empirical_survival": empirical_prediction,
                "richer_logistic": logistic_prediction,
                "richer_catboost": catboost_prediction,
            }
        )
        rolling.append(frame)
        cohort_reports.append(
            {
                "origin": str(origin_date.date()),
                "train_rows": int(len(train)),
                "test_rows": int(len(test)),
                "event_rate": float(test["target"].mean()),
                "models": {
                    name: metrics(test["target"], frame[name].to_numpy())
                    for name in ("empirical_survival", "richer_logistic", "richer_catboost")
                },
            }
        )

    if not rolling:
        raise RuntimeError(f"No valid rolling cohorts for {horizon}-year horizon")

    predictions = pd.concat(rolling, ignore_index=True)
    latest_date = predictions["snapshot_date"].max()
    for name in ("empirical_survival", "richer_catboost"):
        predictions[f"{name}_rank"] = predictions.groupby("snapshot_date")[name].rank(
            method="average", pct=True
        )
    predictions["enriched_tiebreak"] = predictions.groupby(
        ["snapshot_date", "empirical_survival"], group_keys=False
    )["richer_catboost"].rank(method="average", pct=True)
    minimum_gaps = (
        predictions.groupby("snapshot_date")["empirical_survival"]
        .apply(lambda values: np.diff(np.sort(values.unique())).min())
        .rename("minimum_gap")
    )
    predictions["enriched_tiebreak"] = (
        predictions["empirical_survival"]
        + predictions["enriched_tiebreak"]
        * predictions["snapshot_date"].map(minimum_gaps)
        * 0.5
    )

    calibration = predictions[predictions["snapshot_date"].lt(latest_date)].copy()
    blend_grid = np.linspace(0, 1, 21)
    blend_scores: dict[float, float] = {}
    for empirical_weight in blend_grid:
        calibration["candidate_blend"] = (
            empirical_weight * calibration["empirical_survival_rank"]
            + (1 - empirical_weight) * calibration["richer_catboost_rank"]
        )
        cohort_aucs = [
            roc_auc_score(group["target"], group["candidate_blend"])
            for _, group in calibration.groupby("snapshot_date")
        ]
        blend_scores[float(empirical_weight)] = float(np.median(cohort_aucs))
    selected_empirical_weight = max(blend_scores, key=blend_scores.get)
    predictions["enriched_ensemble"] = (
        selected_empirical_weight * predictions["empirical_survival_rank"]
        + (1 - selected_empirical_weight) * predictions["richer_catboost_rank"]
    )
    latest = predictions[predictions["snapshot_date"].eq(latest_date)]
    model_names = (
        "empirical_survival",
        "richer_logistic",
        "richer_catboost",
        "enriched_ensemble",
        "enriched_tiebreak",
    )
    summary: dict[str, Any] = {
        "horizon_years": horizon,
        "rolling_cohorts": int(predictions["snapshot_date"].nunique()),
        "latest_test_cohort": str(latest_date.date()),
        "ensemble_empirical_weight": selected_empirical_weight,
        "ensemble_catboost_weight": 1 - selected_empirical_weight,
        "ensemble_weight_selection": "Highest median AUC on rolling cohorts before the final test cohort.",
        "cohorts": cohort_reports,
        "latest_cohort": {
            name: metrics(latest["target"], latest[name].to_numpy()) for name in model_names
        },
        "pooled_rolling": {
            name: metrics(predictions["target"], predictions[name].to_numpy())
            for name in model_names
        },
        "median_cohort_auc": {},
    }
    for name in model_names:
        summary["median_cohort_auc"][name] = float(
            np.median(
                [
                    roc_auc_score(group["target"], group[name])
                    for _, group in predictions.groupby("snapshot_date")
                ]
            )
        )
    baseline = summary["latest_cohort"]["empirical_survival"]
    challenger = summary["latest_cohort"]["richer_catboost"]
    summary["catboost_auc_lift_latest"] = float(
        challenger["roc_auc"] - baseline["roc_auc"]
    )
    summary["catboost_ap_lift_latest"] = float(
        challenger["average_precision"] - baseline["average_precision"]
    )
    summary["tiebreak_auc_lift_latest"] = float(
        summary["latest_cohort"]["enriched_tiebreak"]["roc_auc"] - baseline["roc_auc"]
    )
    summary["tiebreak_ap_lift_latest"] = float(
        summary["latest_cohort"]["enriched_tiebreak"]["average_precision"]
        - baseline["average_precision"]
    )
    summary["ranking_promotion_passed"] = bool(
        summary["tiebreak_auc_lift_latest"] >= 0.02
        and summary["median_cohort_auc"]["enriched_tiebreak"]
        >= summary["median_cohort_auc"]["empirical_survival"]
        and summary["latest_cohort"]["enriched_tiebreak"]["roc_auc"] >= 0.65
    )
    return summary, predictions


def train_latest_scores(
    featured: pd.DataFrame,
    model_module: Any,
    horizon: int,
) -> pd.DataFrame:
    latest_date = featured["snapshot_date"].max()
    latest = featured[
        featured["snapshot_date"].eq(latest_date)
        & featured["stage"].isin(model_module.ACTIVE_STAGES)
    ].copy()
    train = model_module.make_horizon_outcomes(featured, horizon)
    latest_projects = set(latest["project_key"].astype(str))
    train = train[~train["project_key"].astype(str).isin(latest_projects)].copy()
    model = build_catboost()
    model.fit(
        prepare_catboost(train),
        train["target"].to_numpy(),
        cat_features=CATEGORICAL_FEATURES,
    )
    latest["richer_catboost_score"] = model.predict_proba(prepare_catboost(latest))[:, 1]
    return latest[["ref_id", "richer_catboost_score"]].sort_values(
        "richer_catboost_score", ascending=False
    )


def run(project_root: Path) -> tuple[dict[str, Any], pd.DataFrame | None]:
    sys.path.insert(0, str(project_root))
    from src import model as model_module  # noqa: PLC0415

    panel_path = project_root / "data/processed/repd_panel.csv.gz"
    featured = add_origin_context(
        model_module.add_features(model_module.load_panel(panel_path))
    )
    report: dict[str, Any] = {
        "source": str(panel_path),
        "latest_snapshot": str(featured["snapshot_date"].max().date()),
        "panel_rows": int(len(featured)),
        "projects": int(featured["project_key"].nunique()),
        "snapshots": int(featured["snapshot_date"].nunique()),
        "features": FEATURES,
        "method": (
            "Direct-horizon CatBoost and regularised logistic challengers evaluated on "
            "fully observed, project-purged rolling origin cohorts. External macro and news "
            "variables remain outside the trained model until a sufficiently long dated "
            "feature history exists."
        ),
        "promotion_rule": (
            "Promote the richer ranker only if latest-cohort ROC-AUC improves by at least "
            "0.02, latest ROC-AUC is at least 0.65, and median rolling-cohort AUC does not "
            "fall below the current empirical model."
        ),
        "horizons": {},
    }
    output_scores: pd.DataFrame | None = None
    for horizon in (2, 3):
        horizon_report, _ = evaluate_horizon(featured, horizon, model_module)
        report["horizons"][str(horizon)] = horizon_report
        if horizon == 2 and horizon_report["ranking_promotion_passed"]:
            output_scores = train_latest_scores(featured, model_module, horizon)
    report["two_year_decision"] = (
        "promote empirical ranking with AI tie-breaker"
        if report["horizons"]["2"]["ranking_promotion_passed"]
        else "retain empirical ranking"
    )
    return report, output_scores


def main() -> None:
    parser = argparse.ArgumentParser(description="Evaluate richer delivery-forecast challengers.")
    parser.add_argument("--project-root", type=Path, required=True)
    parser.add_argument("--report", type=Path, required=True)
    parser.add_argument("--scores", type=Path)
    args = parser.parse_args()
    report, scores = run(args.project_root)
    args.report.write_text(json.dumps(report, indent=2), encoding="utf-8")
    if args.scores and scores is not None:
        if args.scores.suffix.lower() == ".json":
            args.scores.write_text(
                json.dumps(scores.to_dict(orient="records"), separators=(",", ":")),
                encoding="utf-8",
            )
        else:
            scores.to_csv(args.scores, index=False)
    print(json.dumps({
        "decision": report["two_year_decision"],
        "two_year": report["horizons"]["2"]["latest_cohort"],
        "auc_lift": report["horizons"]["2"]["tiebreak_auc_lift_latest"],
        "average_precision_lift": report["horizons"]["2"]["tiebreak_ap_lift_latest"],
    }, indent=2))


if __name__ == "__main__":
    main()
