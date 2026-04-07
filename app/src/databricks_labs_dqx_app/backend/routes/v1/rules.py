from typing import Annotated

from databricks.sdk import WorkspaceClient
from fastapi import APIRouter, Depends, HTTPException, Query

from databricks_labs_dqx_app.backend.common.authorization import UserRole
from databricks_labs_dqx_app.backend.dependencies import get_obo_ws, get_rules_catalog_service, require_role
from databricks_labs_dqx_app.backend.logger import logger
from databricks_labs_dqx_app.backend.models import (
    BatchSaveRulesIn,
    BatchSaveRulesOut,
    RuleCatalogEntryOut,
    SaveRulesIn,
    SetStatusIn,
)
from databricks_labs_dqx_app.backend.services.rules_catalog_service import RulesCatalogService

router = APIRouter()

# Role shortcuts for readability
_ALL_ROLES = [UserRole.ADMIN, UserRole.RULE_APPROVER, UserRole.RULE_AUTHOR, UserRole.VIEWER]
_AUTHORS_AND_ABOVE = [UserRole.ADMIN, UserRole.RULE_APPROVER, UserRole.RULE_AUTHOR]
_APPROVERS_ONLY = [UserRole.ADMIN, UserRole.RULE_APPROVER]


def _entry_to_out(entry) -> RuleCatalogEntryOut:
    return RuleCatalogEntryOut(
        table_fqn=entry.table_fqn,
        checks=entry.checks,
        version=entry.version,
        status=entry.status,
        created_by=entry.created_by,
        created_at=entry.created_at,
        updated_by=entry.updated_by,
        updated_at=entry.updated_at,
    )


@router.get(
    "",
    response_model=list[RuleCatalogEntryOut],
    operation_id="listRules",
    dependencies=[require_role(*_ALL_ROLES)],
)
def list_rules(
    svc: Annotated[RulesCatalogService, Depends(get_rules_catalog_service)],
    status: Annotated[str | None, Query(description="Filter by status")] = None,
) -> list[RuleCatalogEntryOut]:
    """List all rule sets in the catalog, optionally filtered by status."""
    try:
        entries = svc.list_rules(status=status)
        return [_entry_to_out(e) for e in entries]
    except Exception as e:
        logger.error(f"Failed to list rules: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to list rules: {e}")


@router.get(
    "/{table_fqn:path}",
    response_model=RuleCatalogEntryOut,
    operation_id="getRules",
    dependencies=[require_role(*_ALL_ROLES)],
)
def get_rules(
    table_fqn: str,
    svc: Annotated[RulesCatalogService, Depends(get_rules_catalog_service)],
) -> RuleCatalogEntryOut:
    """Get the rule set for a specific table."""
    try:
        entry = svc.get(table_fqn)
        if entry is None:
            raise HTTPException(status_code=404, detail=f"No rules found for table: {table_fqn}")
        return _entry_to_out(entry)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get rules for {table_fqn}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to get rules: {e}")


@router.post(
    "",
    response_model=RuleCatalogEntryOut,
    operation_id="saveRules",
    dependencies=[require_role(*_AUTHORS_AND_ABOVE)],
)
def save_rules(
    body: SaveRulesIn,
    svc: Annotated[RulesCatalogService, Depends(get_rules_catalog_service)],
    obo_ws: Annotated[WorkspaceClient, Depends(get_obo_ws)],
) -> RuleCatalogEntryOut:
    """Save (upsert) a rule set for a table (Rule Author and above)."""
    try:
        user = obo_ws.current_user.me()
        user_email = user.user_name or "unknown"
        entry = svc.save(body.table_fqn, body.checks, user_email)
        return _entry_to_out(entry)
    except Exception as e:
        logger.error(f"Failed to save rules for {body.table_fqn}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to save rules: {e}")


@router.post(
    "/batch",
    response_model=BatchSaveRulesOut,
    operation_id="batchSaveRules",
    dependencies=[require_role(*_AUTHORS_AND_ABOVE)],
)
def batch_save_rules(
    body: BatchSaveRulesIn,
    svc: Annotated[RulesCatalogService, Depends(get_rules_catalog_service)],
    obo_ws: Annotated[WorkspaceClient, Depends(get_obo_ws)],
) -> BatchSaveRulesOut:
    """Save the same set of checks to multiple tables (reusable rules)."""
    if not body.table_fqns:
        raise HTTPException(status_code=400, detail="table_fqns must not be empty")
    user = obo_ws.current_user.me()
    user_email = user.user_name or "unknown"
    saved: list[RuleCatalogEntryOut] = []
    failed: list[dict[str, str]] = []
    for fqn in body.table_fqns:
        try:
            entry = svc.save(fqn, body.checks, user_email)
            saved.append(_entry_to_out(entry))
        except Exception as e:
            logger.error(f"Failed to save rules for {fqn}: {e}", exc_info=True)
            failed.append({"table_fqn": fqn, "error": str(e)})
    return BatchSaveRulesOut(saved=saved, failed=failed)


@router.delete(
    "/{table_fqn:path}",
    operation_id="deleteRules",
    dependencies=[require_role(*_AUTHORS_AND_ABOVE)],
)
def delete_rules(
    table_fqn: str,
    svc: Annotated[RulesCatalogService, Depends(get_rules_catalog_service)],
    obo_ws: Annotated[WorkspaceClient, Depends(get_obo_ws)],
) -> dict[str, str]:
    """Delete the rule set for a table (Rule Author and above)."""
    try:
        user = obo_ws.current_user.me()
        user_email = user.user_name or "unknown"
        svc.delete(table_fqn, user_email)
        return {"status": "deleted", "table_fqn": table_fqn}
    except Exception as e:
        logger.error(f"Failed to delete rules for {table_fqn}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to delete rules: {e}")


@router.post(
    "/{table_fqn:path}/submit",
    response_model=RuleCatalogEntryOut,
    operation_id="submitRulesForApproval",
    dependencies=[require_role(*_AUTHORS_AND_ABOVE)],
)
def submit_for_approval(
    table_fqn: str,
    svc: Annotated[RulesCatalogService, Depends(get_rules_catalog_service)],
    obo_ws: Annotated[WorkspaceClient, Depends(get_obo_ws)],
    body: SetStatusIn | None = None,
) -> RuleCatalogEntryOut:
    """Submit a rule set for approval (Rule Author and above)."""
    try:
        user = obo_ws.current_user.me()
        user_email = user.user_name or "unknown"
        expected_version = body.expected_version if body else None
        entry = svc.set_status(table_fqn, "pending_approval", user_email, expected_version)
        return _entry_to_out(entry)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except RuntimeError as e:
        raise HTTPException(status_code=409, detail=str(e))
    except Exception as e:
        logger.error(f"Failed to submit rules for approval: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to submit for approval: {e}")


@router.post(
    "/{table_fqn:path}/approve",
    response_model=RuleCatalogEntryOut,
    operation_id="approveRules",
    dependencies=[require_role(*_APPROVERS_ONLY)],
)
def approve_rules(
    table_fqn: str,
    svc: Annotated[RulesCatalogService, Depends(get_rules_catalog_service)],
    obo_ws: Annotated[WorkspaceClient, Depends(get_obo_ws)],
    body: SetStatusIn | None = None,
) -> RuleCatalogEntryOut:
    """Approve a rule set (Rule Approver and Admin only)."""
    try:
        user = obo_ws.current_user.me()
        user_email = user.user_name or "unknown"
        expected_version = body.expected_version if body else None
        entry = svc.set_status(table_fqn, "approved", user_email, expected_version)
        return _entry_to_out(entry)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except RuntimeError as e:
        raise HTTPException(status_code=409, detail=str(e))
    except Exception as e:
        logger.error(f"Failed to approve rules: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to approve rules: {e}")


@router.post(
    "/{table_fqn:path}/reject",
    response_model=RuleCatalogEntryOut,
    operation_id="rejectRules",
    dependencies=[require_role(*_APPROVERS_ONLY)],
)
def reject_rules(
    table_fqn: str,
    svc: Annotated[RulesCatalogService, Depends(get_rules_catalog_service)],
    obo_ws: Annotated[WorkspaceClient, Depends(get_obo_ws)],
    body: SetStatusIn | None = None,
) -> RuleCatalogEntryOut:
    """Reject a rule set (Rule Approver and Admin only)."""
    try:
        user = obo_ws.current_user.me()
        user_email = user.user_name or "unknown"
        expected_version = body.expected_version if body else None
        entry = svc.set_status(table_fqn, "rejected", user_email, expected_version)
        return _entry_to_out(entry)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except RuntimeError as e:
        raise HTTPException(status_code=409, detail=str(e))
    except Exception as e:
        logger.error(f"Failed to reject rules: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to reject rules: {e}")
