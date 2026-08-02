from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.metrics import average_precision_score, brier_score_loss, log_loss, roc_auc_score
from sklearn.linear_model import LogisticRegression
from sklearn.isotonic import IsotonicRegression


def metrics(target: pd.Series, probability: np.ndarray) -> dict[str, float]:
    values = np.clip(np.asarray(probability, dtype=float), 1e-6, 1 - 1e-6)
    return {
        "rows": int(len(target)),
        "events": int(target.sum()),
        "event_rate": float(target.mean()),
        "mean_prediction": float(values.mean()),
        "brier_score": float(brier_score_loss(target, values)),
        "log_loss": float(log_loss(target, values, labels=[0, 1])),
        "roc_auc": float(roc_auc_score(target, values)),
        "average_precision": float(average_precision_score(target, values)),
    }


def apply_logit_offset(probability: np.ndarray, offset: float) -> np.ndarray:
    values = np.clip(np.asarray(probability, dtype=float), 1e-6, 1 - 1e-6)
    logits = np.log(values / (1 - values))
    return 1 / (1 + np.exp(-np.clip(logits + offset, -20, 20)))


def fit_logit_offset(target: pd.Series, probability: np.ndarray) -> float:
    grid = np.linspace(-5.0, 2.0, 1401)
    scores = np.asarray(
        [brier_score_loss(target, apply_logit_offset(probability, offset)) for offset in grid]
    )
    return float(grid[int(scores.argmin())])


def fit_platt_calibrator(target: pd.Series, probability: np.ndarray) -> LogisticRegression:
    values = np.clip(np.asarray(probability, dtype=float), 1e-6, 1 - 1e-6)
    logits = np.log(values / (1 - values)).reshape(-1, 1)
    return LogisticRegression(C=0.1, max_iter=2000).fit(logits, target.to_numpy())


def apply_platt_calibrator(model: LogisticRegression, probability: np.ndarray) -> np.ndarray:
    values = np.clip(np.asarray(probability, dtype=float), 1e-6, 1 - 1e-6)
    logits = np.log(values / (1 - values)).reshape(-1, 1)
    return model.predict_proba(logits)[:, 1]


def fit_isotonic_calibrator(target: pd.Series, probability: np.ndarray) -> IsotonicRegression:
    return IsotonicRegression(y_min=0, y_max=1, out_of_bounds="clip").fit(
        np.asarray(probability, dtype=float), target.to_numpy()
    )


def calibration_bins(target: pd.Series, probability: np.ndarray) -> list[dict[str, float]]:
    frame = pd.DataFrame({"actual": target.to_numpy(), "probability": probability})
    frame["bin"] = pd.qcut(frame["probability"], q=5, duplicates="drop")
    return (
        frame.groupby("bin", observed=True)
        .agg(
            mean_prediction=("probability", "mean"),
            observed_rate=("actual", "mean"),
            count=("actual", "size"),
        )
        .reset_index(drop=True)
        .round(6)
        .to_dict(orient="records")
    )


def horizon_empirical_probability(
    train: pd.DataFrame, test: pd.DataFrame, *, stage_prior: float = 120, detail_prior: float = 240
) -> np.ndarray:
    working = train[["stage", "technology", "target"]].copy()
    working[["stage", "technology"]] = working[["stage", "technology"]].fillna("Unknown")
    global_rate = float((working["target"].sum() + 1) / (len(working) + 20))
    stage_summary = working.groupby("stage")["target"].agg(["sum", "count"])
    stage_rates = {
        str(stage): float((row["sum"] + stage_prior * global_rate) / (row["count"] + stage_prior))
        for stage, row in stage_summary.iterrows()
    }
    detail_summary = working.groupby(["stage", "technology"])["target"].agg(["sum", "count"])
    detail_rates = {
        (str(stage), str(technology)): float(
            (row["sum"] + detail_prior * stage_rates.get(str(stage), global_rate))
            / (row["count"] + detail_prior)
        )
        for (stage, technology), row in detail_summary.iterrows()
    }
    return np.asarray(
        [
            detail_rates.get(
                (str(stage), str(technology)), stage_rates.get(str(stage), global_rate)
            )
            for stage, technology in zip(
                test["stage"].fillna("Unknown"),
                test["technology"].fillna("Unknown"),
                strict=False,
            )
        ]
    )


def run(project_root: Path) -> dict:
    sys.path.insert(0, str(project_root))
    from src.model import (  # noqa: PLC0415
        HORIZONS,
        add_features,
        build_empirical_model,
        load_panel,
        make_horizon_outcomes,
        make_survival_rows,
        predict_cumulative_probability,
    )

    panel_path = project_root / "data/processed/repd_panel.csv.gz"
    featured = add_features(load_panel(panel_path))
    report: dict[str, object] = {
        "source": "data/processed/repd_panel.csv.gz",
        "latest_snapshot": str(featured["snapshot_date"].max().date()),
        "panel_rows": int(len(featured)),
        "projects": int(featured["project_key"].nunique()),
        "snapshots": int(featured["snapshot_date"].nunique()),
        "method": (
            "Rolling-origin empirical survival predictions with direct-horizon, log-odds, "
            "Platt and isotonic challengers. Calibration is trained only on earlier "
            "out-of-time cohorts and tested on the latest fully observed cohort."
        ),
        "promotion_rule": (
            "A challenger must preserve positive ranking, beat the historical base-rate Brier "
            "score by at least 2%, and have at least three rolling cohorts."
        ),
        "horizons": {},
    }

    for horizon in HORIZONS:
        outcomes = make_horizon_outcomes(featured, horizon)
        dates = [pd.Timestamp(value) for value in sorted(outcomes["snapshot_date"].unique())]
        rolling: list[pd.DataFrame] = []
        skipped: list[dict[str, str]] = []
        for origin_date in dates[2:]:
            origin = outcomes[outcomes["snapshot_date"].eq(origin_date)].copy()
            excluded_projects = set(origin["project_key"].astype(str))
            hazard_train = make_survival_rows(
                featured,
                origin_before=origin_date,
                excluded_projects=excluded_projects,
            )
            if len(hazard_train) < 500 or hazard_train["target"].nunique() < 2:
                skipped.append({"origin": str(origin_date.date()), "reason": "insufficient training rows"})
                continue
            if origin["target"].nunique() < 2:
                skipped.append({"origin": str(origin_date.date()), "reason": "single-class cohort"})
                continue
            model = build_empirical_model().fit(hazard_train, hazard_train["target"])
            probability = predict_cumulative_probability(model, origin, horizon)
            outcome_train = outcomes[
                outcomes["snapshot_date"].lt(origin_date)
                & ~outcomes["project_key"].astype(str).isin(excluded_projects)
            ].copy()
            direct_probability = horizon_empirical_probability(outcome_train, origin)
            rolling.append(
                pd.DataFrame(
                    {
                        "snapshot_date": origin_date,
                        "target": origin["target"].to_numpy(),
                        "raw_probability": probability,
                        "direct_probability": direct_probability,
                    }
                )
            )

        if len(rolling) < 2:
            report["horizons"][str(horizon)] = {
                "status": "insufficient rolling cohorts",
                "rolling_cohorts": len(rolling),
                "skipped": skipped,
            }
            continue

        rolling_frame = pd.concat(rolling, ignore_index=True)
        test_date = rolling_frame["snapshot_date"].max()
        calibration = rolling_frame[rolling_frame["snapshot_date"] < test_date].copy()
        test = rolling_frame[rolling_frame["snapshot_date"].eq(test_date)].copy()
        offset = fit_logit_offset(calibration["target"], calibration["raw_probability"].to_numpy())
        calibrated = apply_logit_offset(test["raw_probability"].to_numpy(), offset)
        platt_model = fit_platt_calibrator(
            calibration["target"], calibration["raw_probability"].to_numpy()
        )
        platt_calibrated = apply_platt_calibrator(
            platt_model, test["raw_probability"].to_numpy()
        )
        isotonic_model = fit_isotonic_calibrator(
            calibration["target"], calibration["raw_probability"].to_numpy()
        )
        isotonic_calibrated = isotonic_model.predict(test["raw_probability"].to_numpy())
        calibration_baseline = float(calibration["target"].mean())
        baseline_probability = np.full(len(test), calibration_baseline)
        raw_metrics = metrics(test["target"], test["raw_probability"].to_numpy())
        platt_metrics = metrics(test["target"], platt_calibrated)
        baseline_metrics = metrics(test["target"], baseline_probability)
        brier_skill = 1 - platt_metrics["brier_score"] / baseline_metrics["brier_score"]
        promoted = bool(
            len(rolling) >= 3
            and platt_model.coef_[0, 0] > 0
            and platt_metrics["roc_auc"] > 0.5
            and brier_skill >= 0.02
        )

        if promoted:
            product_decision = "publish calibrated probability"
        elif horizon == 2 and len(rolling) >= 3 and raw_metrics["roc_auc"] >= 0.65:
            product_decision = "ranking signal only"
        elif horizon == 3 and len(rolling) >= 3 and raw_metrics["roc_auc"] > 0.5:
            product_decision = "research only"
        else:
            product_decision = "withheld"

        report["horizons"][str(horizon)] = {
            "status": "evaluated",
            "rolling_cohorts": int(rolling_frame["snapshot_date"].nunique()),
            "calibration_cohorts": [
                str(pd.Timestamp(value).date())
                for value in sorted(calibration["snapshot_date"].unique())
            ],
            "test_cohort": str(test_date.date()),
            "logit_offset": offset,
            "platt_slope": float(platt_model.coef_[0, 0]),
            "platt_intercept": float(platt_model.intercept_[0]),
            "brier_skill_vs_base_rate": float(brier_skill),
            "promotion_decision": product_decision,
            "uncalibrated": raw_metrics,
            "direct_horizon_empirical": metrics(
                test["target"], test["direct_probability"].to_numpy()
            ),
            "calibrated": metrics(test["target"], calibrated),
            "platt_calibrated": platt_metrics,
            "isotonic_calibrated": metrics(test["target"], isotonic_calibrated),
            "historical_base_rate": baseline_metrics,
            "calibration_bins": calibration_bins(test["target"], platt_calibrated),
            "skipped": skipped,
        }

    report["overall_decision"] = (
        "Release the two-year empirical score as a relative ranking signal only. Withhold "
        "literal project probabilities and the five-year output until a calibrated model "
        "clears the pre-declared release gate."
    )
    return report


def main() -> None:
    parser = argparse.ArgumentParser(description="Audit a leakage-aware forecast calibration candidate.")
    parser.add_argument("--project-root", type=Path, required=True)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    report = run(args.project_root.resolve())
    encoded = json.dumps(report, indent=2)
    if args.output:
        args.output.write_text(encoded + "\n", encoding="utf-8")
    print(encoded)


if __name__ == "__main__":
    main()
