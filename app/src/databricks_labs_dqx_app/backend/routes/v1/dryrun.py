from __future__ import annotations

import json
from collections.abc import Callable
from typing import Annotated, Any
from uuid import uuid4

from databricks.labs.dqx.checks_validator import ChecksValidationStatus
from databricks.sdk import WorkspaceClient
from fastapi import APIRouter, Depends, HTTPException

from databricks_labs_dqx_app.backend.config import AppConfig
from databricks_labs_dqx_app.backend.dependencies import (
    get_check_validator,
    get_conf,
    get_job_service,
    get_obo_ws,
    get_view_service,
)
from databricks_labs_dqx_app.backend.logger import logger
from databricks_labs_dqx_app.backend.models import (
    DryRunIn,
    DryRunResultsOut,
    DryRunSubmitOut,
    RunStatusOut,
    ValidationRunSummaryOut,
)
from databricks_labs_dqx_app.backend.services.job_service import JobService
from databricks_labs_dqx_app.backend.services.view_service import ViewService

router = APIRouter()


@router.get("/runs", response_model=list[ValidationRunSummaryOut], operation_id="listValidationRuns")
def list_validation_runs(
    job_svc: Annotated[JobService, Depends(get_job_service)],
    app_conf: Annotated[AppConfig, Depends(get_conf)],
) -> list[ValidationRunSummaryOut]:
    """Return validation (dry-run) history, newest first."""
    try:
        table = f"{app_conf.catalog}.{app_conf.schema_name}.dq_validation_runs"
        rows = job_svc.list_dryrun_rows(table)
        return [
            ValidationRunSummaryOut(
                run_id=row.get("run_id") or "",
                source_table_fqn=row.get("source_table_fqn") or "",
                status=row.get("status"),
                requesting_user=row.get("requesting_user"),
                sample_size=int(v) if (v := row.get("sample_size")) else None,
                total_rows=int(v) if (v := row.get("total_rows")) else None,
                valid_rows=int(v) if (v := row.get("valid_rows")) else None,
                invalid_rows=int(v) if (v := row.get("invalid_rows")) else None,
                created_at=row.get("created_at"),
            )
            for row in rows
        ]
    except Exception as e:
        logger.error("Failed to list validation runs: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to list validation runs: {e}")


@router.post("", response_model=DryRunSubmitOut, operation_id="submitDryRun")
def submit_dry_run(
    body: DryRunIn,
    obo_ws: Annotated[WorkspaceClient, Depends(get_obo_ws)],
    view_svc: Annotated[ViewService, Depends(get_view_service)],
    job_svc: Annotated[JobService, Depends(get_job_service)],
    validate_checks_fn: Annotated[Callable[[list[Any]], ChecksValidationStatus], Depends(get_check_validator)],
) -> DryRunSubmitOut:
    """Validate checks, create a temporary view (OBO), and submit a dry-run job (SP)."""
    try:
        # Validate checks first
        validation = validate_checks_fn(body.checks)
        if validation.has_errors:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid checks: {validation.errors}",
            )

        run_id = uuid4().hex[:16]

        # Get requesting user email
        user = obo_ws.current_user.me()
        requesting_user = user.user_name or "unknown"

        # Create view using OBO token — inherits user's table permissions
        view_fqn = view_svc.create_view(body.table_fqn)

        # Submit job using SP credentials
        config = {
            "checks": body.checks,
            "sample_size": body.sample_size,
            "source_table_fqn": body.table_fqn,
        }
        job_run_id = job_svc.submit_run(
            task_type="dryrun",
            view_fqn=view_fqn,
            config=config,
            run_id=run_id,
            requesting_user=requesting_user,
        )

        return DryRunSubmitOut(run_id=run_id, job_run_id=job_run_id, view_fqn=view_fqn)
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Failed to submit dry run for %s: %s", body.table_fqn, e, exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to submit dry run: {e}")


@router.get("/runs/{run_id}/status", response_model=RunStatusOut, operation_id="getDryRunStatus")
def get_dry_run_status(
    run_id: str,
    job_run_id: int,
    job_svc: Annotated[JobService, Depends(get_job_service)],
    view_svc: Annotated[ViewService, Depends(get_view_service)],
    view_fqn: str | None = None,
) -> RunStatusOut:
    """Poll the status of a dry-run job. Cleans up the view when job terminates."""
    try:
        status = job_svc.get_run_status(job_run_id)
        view_cleaned_up = False

        # Clean up the view when job is done (TERMINATED state with any result)
        if view_fqn and status.state == "TERMINATED":
            try:
                view_svc.drop_view(view_fqn)
                view_cleaned_up = True
                logger.info("Cleaned up temporary view: %s", view_fqn)
            except Exception as cleanup_err:
                logger.warning("Failed to clean up view %s: %s", view_fqn, cleanup_err)

        return RunStatusOut(
            run_id=run_id,
            state=status.state,
            result_state=status.result_state,
            message=status.message,
            view_cleaned_up=view_cleaned_up,
        )
    except Exception as e:
        logger.error("Failed to get dry run status (run_id=%s): %s", run_id, e, exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to get run status: {e}")


@router.get("/runs/{run_id}/results", response_model=DryRunResultsOut, operation_id="getDryRunResults")
def get_dry_run_results(
    run_id: str,
    job_svc: Annotated[JobService, Depends(get_job_service)],
    app_conf: Annotated[AppConfig, Depends(get_conf)],
) -> DryRunResultsOut:
    """Read dry-run results from the Delta table."""
    try:
        table = f"{app_conf.catalog}.{app_conf.schema_name}.dq_validation_runs"
        row = job_svc.get_run_result_row(table, run_id)

        if row is None:
            raise HTTPException(status_code=404, detail=f"No results found for run_id={run_id}")

        if row.get("status") == "FAILED":
            raise HTTPException(status_code=500, detail=f"Dry run failed: {row.get('error_message', 'Unknown error')}")

        error_summary_json = row.get("error_summary_json") or "[]"
        sample_invalid_json = row.get("sample_invalid_json") or "[]"

        return DryRunResultsOut(
            run_id=run_id,
            source_table_fqn=row.get("source_table_fqn") or "",
            total_rows=int(v) if (v := row.get("total_rows")) else None,
            valid_rows=int(v) if (v := row.get("valid_rows")) else None,
            invalid_rows=int(v) if (v := row.get("invalid_rows")) else None,
            error_summary=json.loads(error_summary_json),
            sample_invalid=json.loads(sample_invalid_json),
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Failed to get dry run results (run_id=%s): %s", run_id, e, exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to get dry run results: {e}")
