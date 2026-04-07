import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState, useEffect, useCallback, useMemo } from "react";
import { PageBreadcrumb } from "@/components/apx/PageBreadcrumb";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sparkles,
  Play,
  Save,
  Loader2,
  ArrowLeft,
  AlertCircle,
  FileEdit,
  Clock,
  CheckCircle2,
  XCircle,
  Info,
  Columns3,
} from "lucide-react";
import { toast } from "sonner";
import { CatalogBrowser } from "@/components/CatalogBrowser";
import { RulesReview } from "@/components/RulesReview";
import { DryRunResults } from "@/components/DryRunResults";
import {
  useAiAssistedChecksGeneration,
  useSubmitDryRun,
  useGetDryRunResults,
  useSaveRules,
  useSubmitRulesForApproval,
  useGetRules,
  useGetTableColumns,
  getDryRunStatus,
  type DryRunResultsOut,
  type RuleCatalogEntryOut,
} from "@/lib/api";
import { useJobPolling } from "@/hooks/use-job-polling";

// ──────────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────────

type SearchParams = {
  table?: string;
};

// Map of ruleIndex -> tableFqn -> column name | null (null = skip this rule for this table)
type ColumnMapping = Map<number, Map<string, string | null>>;

// ──────────────────────────────────────────────────────────────────────────────
// Route
// ──────────────────────────────────────────────────────────────────────────────

export const Route = createFileRoute("/_sidebar/rules/generate")({
  component: GenerateRulesPage,
  validateSearch: (search: Record<string, unknown>): SearchParams => ({
    table: (search.table as string) || undefined,
  }),
});

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────

function statusBadge(status: string) {
  switch (status) {
    case "draft":
      return (
        <Badge variant="secondary" className="gap-1">
          <FileEdit className="h-3 w-3" />
          Draft
        </Badge>
      );
    case "pending_approval":
      return (
        <Badge variant="outline" className="gap-1 border-amber-500 text-amber-600">
          <Clock className="h-3 w-3" />
          Pending
        </Badge>
      );
    case "approved":
      return (
        <Badge variant="outline" className="gap-1 border-green-500 text-green-600">
          <CheckCircle2 className="h-3 w-3" />
          Approved
        </Badge>
      );
    case "rejected":
      return (
        <Badge variant="outline" className="gap-1 border-red-500 text-red-600">
          <XCircle className="h-3 w-3" />
          Rejected
        </Badge>
      );
    default:
      return <Badge variant="secondary">{status}</Badge>;
  }
}

/** Extract column name from a check object, if any. */
function getCheckColumn(check: Record<string, unknown>): string | null {
  const checkDef = (check.check as Record<string, unknown>) ?? {};
  const args = (checkDef.arguments as Record<string, unknown>) ?? {};
  return (args.column as string) ?? null;
}

/** Return a copy of the rule set with `arguments.column` substituted per the mapping for one table. */
function applyColumnMapping(
  checks: Record<string, unknown>[],
  mapping: ColumnMapping,
  tableFqn: string,
): Record<string, unknown>[] {
  return checks.flatMap((check, idx) => {
    const tableMap = mapping.get(idx);
    if (!tableMap) return [check]; // no mapping for this rule — apply as-is

    const mapped = tableMap.get(tableFqn);
    if (mapped === null) return []; // explicitly skipped

    if (mapped === undefined) return [check]; // no entry — apply as-is

    // Substitute the column
    const checkDef = { ...((check.check as Record<string, unknown>) ?? {}) };
    const args = { ...((checkDef.arguments as Record<string, unknown>) ?? {}), column: mapped };
    checkDef.arguments = args;
    return [{ ...check, check: checkDef }];
  });
}

/** Initialise a ColumnMapping from the current checks and selected tables' column lists. */
function buildInitialMapping(
  checks: Record<string, unknown>[],
  tables: string[],
  tableColumns: Map<string, string[]>,
): ColumnMapping {
  const mapping: ColumnMapping = new Map();
  checks.forEach((check, idx) => {
    const aiColumn = getCheckColumn(check);
    if (!aiColumn) return; // no column argument — skip mapping
    const tableMap = new Map<string, string | null>();
    tables.forEach((t) => {
      const cols = tableColumns.get(t) ?? [];
      // Pre-fill with AI column if it exists in the table, else leave empty string (user must pick)
      tableMap.set(t, cols.includes(aiColumn) ? aiColumn : "");
    });
    mapping.set(idx, tableMap);
  });
  return mapping;
}

// ──────────────────────────────────────────────────────────────────────────────
// Main Page Component
// ──────────────────────────────────────────────────────────────────────────────

function GenerateRulesPage() {
  const navigate = useNavigate();
  const { table: initialTable } = Route.useSearch();

  // Multi-table state — array of FQNs
  const [selectedTables, setSelectedTables] = useState<string[]>(
    initialTable ? [initialTable] : [],
  );
  const primaryTable = selectedTables[0] ?? "";
  const hasTable = primaryTable.split(".").length === 3;
  const isMultiTable = selectedTables.length > 1;

  const [userInput, setUserInput] = useState("");
  const [checks, setChecks] = useState<Record<string, unknown>[]>([]);
  const [columnMapping, setColumnMapping] = useState<ColumnMapping>(new Map());
  const [dryRunResult, setDryRunResult] = useState<DryRunResultsOut | null>(null);
  const [existingEntry, setExistingEntry] = useState<RuleCatalogEntryOut | null>(null);
  const [dryRunJobRunId, setDryRunJobRunId] = useState<number | null>(null);
  const [dryRunRunId, setDryRunRunId] = useState<string | null>(null);
  const [dryRunViewFqn, setDryRunViewFqn] = useState<string | null>(null);

  // Edit mode only applies when exactly one table is selected
  const {
    data: rulesResp,
    isLoading: isLoadingRules,
  } = useGetRules(primaryTable, {
    query: { enabled: hasTable && !isMultiTable },
  });

  useEffect(() => {
    if (rulesResp?.data && !isMultiTable) {
      const entry = rulesResp.data;
      setExistingEntry(entry);
      if (checks.length === 0) setChecks(entry.checks);
    }
  }, [rulesResp]); // eslint-disable-line react-hooks/exhaustive-deps

  // Clear edit mode state when switching to multi-table
  useEffect(() => {
    if (isMultiTable) setExistingEntry(null);
  }, [isMultiTable]);

  const isEditMode = existingEntry !== null && !isMultiTable;

  const generateMutation = useAiAssistedChecksGeneration();
  const submitDryRunMutation = useSubmitDryRun();
  const saveMutation = useSaveRules();
  const submitMutation = useSubmitRulesForApproval();

  const dryRunResultsQuery = useGetDryRunResults(dryRunRunId ?? "", {
    query: { enabled: false },
  });

  const fetchDryRunStatus = useCallback(async () => {
    if (!dryRunRunId || dryRunJobRunId === null) throw new Error("No active run");
    const resp = await getDryRunStatus(dryRunRunId, {
      job_run_id: dryRunJobRunId,
      view_fqn: dryRunViewFqn ?? undefined,
    });
    return resp.data;
  }, [dryRunRunId, dryRunJobRunId, dryRunViewFqn]);

  const dryRunPolling = useJobPolling({
    fetchStatus: fetchDryRunStatus,
    enabled: dryRunJobRunId !== null && dryRunRunId !== null,
    interval: 3000,
    onComplete: async (status) => {
      if (status.result_state === "SUCCESS") {
        try {
          const resp = await dryRunResultsQuery.refetch();
          if (resp.data?.data) {
            setDryRunResult(resp.data.data);
            toast.success("Dry run complete");
          }
        } catch {
          toast.error("Failed to fetch dry run results");
        }
      } else {
        toast.error(`Dry run failed: ${status.message || "Unknown error"}`);
      }
      setDryRunJobRunId(null);
      setDryRunViewFqn(null);
    },
    onError: () => {
      toast.error("Failed to check dry run status");
    },
  });

  const hasChecks = checks.length > 0;

  // Whether the column mapping step is relevant
  const hasColumnRules = checks.some((c) => getCheckColumn(c) !== null);
  const showColumnMapping = isMultiTable && hasChecks && hasColumnRules;

  const handleGenerate = async () => {
    if (!userInput.trim()) {
      toast.error("Please describe your data quality requirements");
      return;
    }
    try {
      const resp = await generateMutation.mutateAsync({
        data: {
          user_input: userInput,
          table_fqn: hasTable ? primaryTable : undefined,
        },
      });
      const generated = resp.data?.checks ?? [];
      if (generated.length === 0) {
        toast.warning("No rules were generated. Try a more specific description.");
        return;
      }
      setChecks((prev) => [...prev, ...generated]);
      setDryRunResult(null);
      setColumnMapping(new Map()); // reset mapping when rules change
      toast.success(`Added ${generated.length} rule(s) (total: ${checks.length + generated.length})`);
    } catch {
      toast.error("Failed to generate rules");
    }
  };

  const handleDryRun = async () => {
    if (!hasTable) { toast.error("Select a table to run a dry run"); return; }
    if (!hasChecks) { toast.error("Generate or add rules first"); return; }
    try {
      setDryRunResult(null);
      const resp = await submitDryRunMutation.mutateAsync({
        data: { table_fqn: primaryTable, checks },
      });
      setDryRunRunId(resp.data.run_id);
      setDryRunJobRunId(resp.data.job_run_id);
      setDryRunViewFqn(resp.data.view_fqn);
      toast.info("Dry run submitted — waiting for results...");
    } catch {
      toast.error("Failed to submit dry run");
    }
  };

  const handleSave = async () => {
    if (selectedTables.length === 0) { toast.error("Select at least one table before saving"); return; }
    if (!hasChecks) { toast.error("No rules to save"); return; }

    // Validate: for multi-table, ensure all column mappings are filled
    if (showColumnMapping) {
      for (const [ruleIdx, tableMap] of columnMapping) {
        for (const [tableFqn, col] of tableMap) {
          if (col === "") {
            const check = checks[ruleIdx];
            const fn = ((check.check as Record<string, unknown>)?.function as string) ?? "rule";
            toast.error(`Please map column for rule "${fn}" on table "${tableFqn.split(".").pop()}"`);
            return;
          }
        }
      }
    }

    try {
      let savedCount = 0;
      for (const table of selectedTables) {
        const rulesForTable = showColumnMapping
          ? applyColumnMapping(checks, columnMapping, table)
          : checks;

        await saveMutation.mutateAsync({ data: { table_fqn: table, checks: rulesForTable } });

        try {
          await submitMutation.mutateAsync({ tableFqn: table, data: null });
        } catch {
          // Approval submission failure is non-fatal
        }
        savedCount++;
      }

      toast.success(
        savedCount === 1
          ? "Rules saved and submitted for approval"
          : `Rules saved to ${savedCount} tables`,
      );
      navigate({ to: "/rules" });
    } catch {
      toast.error("Failed to save rules");
    }
  };

  const isGenerating = generateMutation.isPending;
  const isDryRunning = submitDryRunMutation.isPending || dryRunPolling.isPolling;
  const isSaving = saveMutation.isPending || submitMutation.isPending;
  const isBusy = isGenerating || isDryRunning || isSaving;

  const reviewStep = isEditMode ? 2 : 3;
  const saveStep = showColumnMapping
    ? isEditMode ? 4 : 5
    : isEditMode ? 3 : 4;

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <PageBreadcrumb
          items={[{ label: "Rules", to: "/rules" }]}
          page={isEditMode ? "Edit Rules" : "Generate Rules"}
        />
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">
              {isEditMode ? "Edit Rules" : "Generate Rules"}
            </h1>
            <p className="text-muted-foreground">
              {isEditMode
                ? "Edit the data quality rules for this table. Use AI to regenerate, or edit manually."
                : "Select tables and describe your data quality requirements to generate rules with AI."}
            </p>
          </div>
          <Button variant="outline" asChild className="gap-2">
            <Link to="/rules">
              <ArrowLeft className="h-4 w-4" />
              Back to Rules
            </Link>
          </Button>
        </div>
      </div>

      {/* Step 1: Table selection */}
      <Card>
        <CardHeader>
          <CardTitle>1. Select {isEditMode ? "Table" : "Tables"}</CardTitle>
          <CardDescription>
            {isEditMode
              ? "Table is locked while editing an existing rule set."
              : "Choose one or more tables to apply data quality rules to."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {isEditMode ? (
            <>
              <CatalogBrowser
                value={primaryTable}
                onChange={(fqn) => setSelectedTables([fqn])}
                disabled
              />
              {existingEntry && (
                <div className="flex items-center gap-3 rounded-md border border-border bg-muted/50 px-4 py-3">
                  <Info className="h-4 w-4 text-muted-foreground shrink-0" />
                  <div className="flex items-center gap-3 text-sm">
                    <code className="font-mono text-xs bg-background px-1.5 py-0.5 rounded">{primaryTable}</code>
                    <span className="text-muted-foreground">·</span>
                    <span className="tabular-nums font-medium">v{existingEntry.version}</span>
                    <span className="text-muted-foreground">·</span>
                    {statusBadge(existingEntry.status)}
                    {existingEntry.updated_at && (
                      <>
                        <span className="text-muted-foreground">·</span>
                        <span className="text-muted-foreground text-xs">
                          Updated {new Date(existingEntry.updated_at).toLocaleDateString()}
                        </span>
                      </>
                    )}
                  </div>
                </div>
              )}
            </>
          ) : (
            <>
              <CatalogBrowser
                value=""
                onChange={(fqn) => setSelectedTables([fqn])}
                disabled={isBusy}
                multiSelect
                selectedTables={selectedTables}
                onMultiChange={(tables) => {
                  setSelectedTables(tables);
                  setColumnMapping(new Map()); // reset mapping on table change
                }}
              />
              {selectedTables.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-sm font-medium">
                    {selectedTables.length} table{selectedTables.length !== 1 ? "s" : ""} selected
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {selectedTables.map((t) => (
                      <Badge key={t} variant="secondary" className="font-mono text-xs gap-1">
                        {t.split(".").pop()}
                        <button
                          type="button"
                          className="ml-0.5 hover:text-destructive"
                          onClick={() => {
                            setSelectedTables((prev) => prev.filter((x) => x !== t));
                            setColumnMapping(new Map());
                          }}
                          disabled={isBusy}
                        >
                          ×
                        </button>
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
              {isLoadingRules && hasTable && !isMultiTable && (
                <p className="text-sm text-muted-foreground">Loading existing rules...</p>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* Step 2: AI generation */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5" />
            {isEditMode ? "AI Assist (Optional)" : "2. Describe Requirements"}
          </CardTitle>
          <CardDescription>
            {isEditMode
              ? "Optionally add more rules with AI. Generated rules will be added to the existing ones."
              : isMultiTable
                ? `Describe data quality checks to generate. Rules will be mapped to each table's columns in the next step.`
                : "Describe what data quality checks you need in plain English."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-2">
            <Label htmlFor="user-input">Requirements</Label>
            <Textarea
              id="user-input"
              value={userInput}
              onChange={(e) => setUserInput(e.target.value)}
              disabled={isBusy}
              placeholder="e.g. Ensure no null values in the id and email columns, validate email format, check that amount is positive..."
              rows={4}
            />
          </div>
          <Button
            onClick={handleGenerate}
            disabled={!userInput.trim() || isBusy}
            className="gap-2"
          >
            {isGenerating ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="h-4 w-4" />
            )}
            {isGenerating ? "Generating..." : "Generate Rules"}
          </Button>
        </CardContent>
      </Card>

      {/* Step 3: Review rules */}
      {hasChecks && (
        <Card>
          <CardHeader>
            <CardTitle>{reviewStep}. Review Rules</CardTitle>
            <CardDescription>
              {isEditMode
                ? "Edit the existing rules, change criticality, or remove rules."
                : "Review, edit, or remove the generated rules before saving."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <RulesReview
              checks={checks}
              onChange={(updated) => {
                setChecks(updated);
                setColumnMapping(new Map()); // reset mapping when rules change
              }}
            />
          </CardContent>
        </Card>
      )}

      {/* Step 4 (multi-table only): Column mapping */}
      {showColumnMapping && (
        <ColumnMappingStep
          stepNumber={isEditMode ? 3 : 4}
          checks={checks}
          selectedTables={selectedTables}
          mapping={columnMapping}
          onMappingChange={setColumnMapping}
          disabled={isBusy}
        />
      )}

      {/* Final step: Validate & Save */}
      {hasChecks && (
        <Card>
          <CardHeader>
            <CardTitle>{saveStep}. Validate & Save</CardTitle>
            <CardDescription>
              {isMultiTable
                ? `Rules will be saved to ${selectedTables.length} tables.`
                : "Run a dry run to validate rules against live data, then save."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="flex items-center gap-3">
              {!isMultiTable && (
                <Button
                  variant="outline"
                  onClick={handleDryRun}
                  disabled={!hasTable || isBusy}
                  className="gap-2"
                >
                  {isDryRunning ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Play className="h-4 w-4" />
                  )}
                  {isDryRunning ? "Running..." : "Dry Run"}
                </Button>
              )}
              <Button
                onClick={handleSave}
                disabled={selectedTables.length === 0 || isBusy}
                className="gap-2"
              >
                {isSaving ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Save className="h-4 w-4" />
                )}
                {isSaving
                  ? "Saving..."
                  : isMultiTable
                    ? `Save to ${selectedTables.length} Tables`
                    : "Save Rules"}
              </Button>
              {selectedTables.length === 0 && (
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  <AlertCircle className="h-3 w-3" />
                  Select a table first
                </p>
              )}
            </div>

            {isDryRunning && dryRunPolling.status && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>
                  Job status: <span className="font-medium">{dryRunPolling.status.state}</span>
                </span>
              </div>
            )}

            {dryRunResult && (
              <>
                <Separator />
                <DryRunResults result={dryRunResult} />
              </>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Column Mapping Step Component
// ──────────────────────────────────────────────────────────────────────────────

interface ColumnMappingStepProps {
  stepNumber: number;
  checks: Record<string, unknown>[];
  selectedTables: string[];
  mapping: ColumnMapping;
  onMappingChange: (mapping: ColumnMapping) => void;
  disabled?: boolean;
}

function ColumnMappingStep({
  stepNumber,
  checks,
  selectedTables,
  mapping,
  onMappingChange,
  disabled,
}: ColumnMappingStepProps) {
  // Fetch columns for all selected tables in parallel
  const tableColumnQueries = selectedTables.map((t) => {
    const parts = t.split(".");
    return {
      tableFqn: t,
      catalog: parts[0] ?? "",
      schema: parts[1] ?? "",
      table: parts[2] ?? "",
    };
  });

  // We call the hook for each table; hooks must be called unconditionally so we
  // render a fixed-size array by slicing to a max of 10 tables
  const q0 = useGetTableColumns(tableColumnQueries[0]?.catalog ?? "", tableColumnQueries[0]?.schema ?? "", tableColumnQueries[0]?.table ?? "", { query: { enabled: !!tableColumnQueries[0] } });
  const q1 = useGetTableColumns(tableColumnQueries[1]?.catalog ?? "", tableColumnQueries[1]?.schema ?? "", tableColumnQueries[1]?.table ?? "", { query: { enabled: !!tableColumnQueries[1] } });
  const q2 = useGetTableColumns(tableColumnQueries[2]?.catalog ?? "", tableColumnQueries[2]?.schema ?? "", tableColumnQueries[2]?.table ?? "", { query: { enabled: !!tableColumnQueries[2] } });
  const q3 = useGetTableColumns(tableColumnQueries[3]?.catalog ?? "", tableColumnQueries[3]?.schema ?? "", tableColumnQueries[3]?.table ?? "", { query: { enabled: !!tableColumnQueries[3] } });
  const q4 = useGetTableColumns(tableColumnQueries[4]?.catalog ?? "", tableColumnQueries[4]?.schema ?? "", tableColumnQueries[4]?.table ?? "", { query: { enabled: !!tableColumnQueries[4] } });
  const q5 = useGetTableColumns(tableColumnQueries[5]?.catalog ?? "", tableColumnQueries[5]?.schema ?? "", tableColumnQueries[5]?.table ?? "", { query: { enabled: !!tableColumnQueries[5] } });
  const q6 = useGetTableColumns(tableColumnQueries[6]?.catalog ?? "", tableColumnQueries[6]?.schema ?? "", tableColumnQueries[6]?.table ?? "", { query: { enabled: !!tableColumnQueries[6] } });
  const q7 = useGetTableColumns(tableColumnQueries[7]?.catalog ?? "", tableColumnQueries[7]?.schema ?? "", tableColumnQueries[7]?.table ?? "", { query: { enabled: !!tableColumnQueries[7] } });
  const q8 = useGetTableColumns(tableColumnQueries[8]?.catalog ?? "", tableColumnQueries[8]?.schema ?? "", tableColumnQueries[8]?.table ?? "", { query: { enabled: !!tableColumnQueries[8] } });
  const q9 = useGetTableColumns(tableColumnQueries[9]?.catalog ?? "", tableColumnQueries[9]?.schema ?? "", tableColumnQueries[9]?.table ?? "", { query: { enabled: !!tableColumnQueries[9] } });

  const allQueries = [q0, q1, q2, q3, q4, q5, q6, q7, q8, q9].slice(0, selectedTables.length);

  const tableColumns: Map<string, string[]> = useMemo(() => {
    const m = new Map<string, string[]>();
    allQueries.forEach((q, i) => {
      const t = selectedTables[i];
      if (t && q.data?.data) {
        m.set(t, q.data.data.map((c) => c.name).filter(Boolean) as string[]);
      }
    });
    return m;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allQueries.map((q) => q.data?.data?.length).join(","), selectedTables.join(",")]);

  const isLoadingAny = allQueries.some((q) => q.isLoading);

  // Auto-initialise mapping when columns become available
  useEffect(() => {
    if (isLoadingAny) return;
    if (mapping.size > 0) return; // already initialised
    const initial = buildInitialMapping(checks, selectedTables, tableColumns);
    if (initial.size > 0) onMappingChange(initial);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoadingAny, tableColumns.size]);

  const setCell = (ruleIdx: number, tableFqn: string, value: string | null) => {
    const next = new Map(mapping);
    const tableMap = new Map(next.get(ruleIdx) ?? new Map<string, string | null>());
    tableMap.set(tableFqn, value);
    next.set(ruleIdx, tableMap);
    onMappingChange(next);
  };

  // Column-bearing rules only
  const columnRules = checks
    .map((check, idx) => ({ check, idx, column: getCheckColumn(check) }))
    .filter((r) => r.column !== null);

  if (isLoadingAny) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Columns3 className="h-5 w-5" />
            {stepNumber}. Map Columns per Table
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading table schemas...
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Columns3 className="h-5 w-5" />
          {stepNumber}. Map Columns per Table
        </CardTitle>
        <CardDescription>
          For each rule that targets a column, select which column to use in each table.
          Choose "— skip —" to omit a rule for a specific table.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full text-sm border rounded-lg overflow-hidden">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="text-left p-3 font-medium min-w-[180px]">Rule</th>
                <th className="text-left p-3 font-medium text-muted-foreground text-xs">
                  AI suggestion
                </th>
                {selectedTables.map((t) => (
                  <th key={t} className="text-left p-3 font-medium min-w-[160px]">
                    <span className="font-mono text-xs">{t.split(".").pop()}</span>
                    <span className="block text-[10px] text-muted-foreground font-normal truncate max-w-[150px]">
                      {t}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {columnRules.map(({ check, idx, column }) => {
                const checkDef = (check.check as Record<string, unknown>) ?? {};
                const fn = String(checkDef.function ?? "unknown");
                const tableMap = mapping.get(idx);

                return (
                  <tr key={idx} className="border-b last:border-b-0 hover:bg-muted/20 transition-colors">
                    <td className="p-3">
                      <Badge variant="secondary" className="font-mono text-xs">
                        {fn}
                      </Badge>
                    </td>
                    <td className="p-3 font-mono text-xs text-muted-foreground">
                      {column}
                    </td>
                    {selectedTables.map((t) => {
                      const cols = tableColumns.get(t) ?? [];
                      const currentValue = tableMap?.get(t) ?? "";
                      const isSkipped = currentValue === null;

                      return (
                        <td key={t} className="p-3">
                          <Select
                            value={isSkipped ? "__skip__" : (currentValue || "")}
                            onValueChange={(val) =>
                              setCell(idx, t, val === "__skip__" ? null : val)
                            }
                            disabled={disabled}
                          >
                            <SelectTrigger className={`h-8 text-xs ${!currentValue && !isSkipped ? "border-amber-400" : ""}`}>
                              <SelectValue placeholder="Pick column..." />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="__skip__" className="text-muted-foreground italic">
                                — skip —
                              </SelectItem>
                              {cols.map((col) => (
                                <SelectItem key={col} value={col} className="font-mono text-xs">
                                  {col}
                                </SelectItem>
                              ))}
                              {cols.length === 0 && (
                                <SelectItem value="" disabled>
                                  No columns found
                                </SelectItem>
                              )}
                            </SelectContent>
                          </Select>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Rules without columns — informational */}
        {checks.some((c) => getCheckColumn(c) === null) && (
          <p className="mt-3 text-xs text-muted-foreground flex items-center gap-1">
            <Info className="h-3 w-3 shrink-0" />
            {checks.filter((c) => getCheckColumn(c) === null).length} rule(s) without a specific column will be applied identically to all tables.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
