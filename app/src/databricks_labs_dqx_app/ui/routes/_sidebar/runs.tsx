import {
  createFileRoute,
  Link,
  useNavigate,
  useParams,
} from "@tanstack/react-router";
import { PageBreadcrumb } from "@/components/apx/PageBreadcrumb";
import {
  useConfig,
  useSaveRunConfig,
  useDeleteRunConfig,
  useListRules,
  useSubmitDryRun,
  RunConfig,
  type ConfigOut,
  type RuleCatalogEntryOut,
  type User as UserType,
} from "@/lib/api";
import {
  useListValidationRuns,
  getListValidationRunsQueryKey,
  type ValidationRunSummaryOut,
} from "@/lib/api-custom";
import { useConfigSuspense, useCurrentUserSuspense } from "@/hooks/use-suspense-queries";
import selector from "@/lib/selector";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Plus,
  Trash2,
  Save,
  FileCode,
  AlertCircle,
  RotateCcw,
  Loader2,
  FormInput,
  Play,
  History,
  Settings2,
  CheckCircle2,
  XCircle,
  Clock,
  User,
  Search,
} from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useState, useEffect, Suspense, useMemo } from "react";
import yaml from "js-yaml";
import { useQueryClient, QueryErrorResetBoundary } from "@tanstack/react-query";
import { ErrorBoundary } from "react-error-boundary";
import { useAIAssistant } from "@/components/AIAssistantProvider";
import { FadeIn } from "@/components/anim/FadeIn";

export const Route = createFileRoute("/_sidebar/runs")({
  component: RunsPage,
});

// ---------------------------------------------------------------------------
// Main page — two top-level tabs: History (default) and Configurations
// ---------------------------------------------------------------------------

function RunsPage() {
  const navigate = useNavigate();
  const params = useParams({ strict: false }) as { runName?: string };
  const currentRunName = params.runName;
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isDeletingRun, setIsDeletingRun] = useState(false);
  const queryClient = useQueryClient();

  const { data: configData } = useConfig(selector());
  const { mutateAsync: saveRun } = useSaveRunConfig();

  const existingRunNames =
    configData?.config?.run_configs?.map((r) => r.name || "") || [];

  const handleCreateRun = async (name: string) => {
    const newRun: RunConfig = { name };
    try {
      await saveRun({ data: { config: newRun } });
      await queryClient.refetchQueries({ queryKey: ["/api/config"] });
      toast.success(`Run "${name}" created`);
      navigate({ to: "/runs/$runName", params: { runName: name } });
      setIsCreateOpen(false);
    } catch (error) {
      toast.error("Failed to create new run");
      console.error(error);
      throw error;
    }
  };

  const activeTab = currentRunName ? "configurations" : "history";

  return (
    <div className="flex flex-col h-full">
      <PageBreadcrumb
        items={currentRunName ? [{ label: "Runs", to: "/runs" }] : []}
        page={currentRunName || "Runs"}
      />

      <Tabs value={activeTab} className="flex-1 flex flex-col mt-4 overflow-hidden">
        <div className="flex items-center justify-between shrink-0 mb-4">
          <TabsList>
            <TabsTrigger value="history" className="gap-2" asChild>
              <Link to="/runs">
                <History className="h-4 w-4" />
                Run History
              </Link>
            </TabsTrigger>
            <TabsTrigger value="configurations" className="gap-2" asChild>
              <Link to="/runs">
                <Settings2 className="h-4 w-4" />
                Configurations
              </Link>
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="history" className="flex-1 overflow-hidden mt-0">
          <QueryErrorResetBoundary>
            {({ reset }) => (
              <ErrorBoundary onReset={reset} fallbackRender={RunHistoryError}>
                <Suspense fallback={<RunHistorySkeleton />}>
                  <RunHistoryTab />
                </Suspense>
              </ErrorBoundary>
            )}
          </QueryErrorResetBoundary>
        </TabsContent>

        <TabsContent value="configurations" className="flex-1 overflow-hidden mt-0">
          <div className="flex flex-1 gap-6 overflow-hidden h-full">
            <aside className="w-72 shrink-0 flex flex-col border-r border-border/50 pr-4 overflow-hidden">
              <div className="flex items-center justify-between mb-4 shrink-0">
                <h2 className="font-semibold text-lg text-foreground">
                  Run Configurations
                </h2>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => setIsCreateOpen(true)}
                  disabled={!configData}
                  title="Add New Run"
                  className="h-9 w-9"
                >
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
              <div className="flex-1 overflow-y-auto space-y-1">
                <QueryErrorResetBoundary>
                  {({ reset }) => (
                    <ErrorBoundary onReset={reset} fallbackRender={RunsListError}>
                      <Suspense fallback={<RunsListSkeleton />}>
                        <RunsSidebarList
                          currentRunName={currentRunName}
                          isDeleting={isDeletingRun}
                        />
                      </Suspense>
                    </ErrorBoundary>
                  )}
                </QueryErrorResetBoundary>
              </div>
            </aside>
            <main className="flex-1 overflow-hidden flex flex-col">
              <QueryErrorResetBoundary>
                {({ reset }) => (
                  <ErrorBoundary onReset={reset} fallbackRender={RunEditorError}>
                    <Suspense fallback={<RunEditorSkeleton />}>
                      <RunEditorContainer
                        currentRunName={currentRunName}
                        onAddRun={() => setIsCreateOpen(true)}
                        onDeletingChange={setIsDeletingRun}
                      />
                    </Suspense>
                  </ErrorBoundary>
                )}
              </QueryErrorResetBoundary>
            </main>
          </div>
        </TabsContent>
      </Tabs>

      <CreateRunDialog
        open={isCreateOpen}
        onOpenChange={setIsCreateOpen}
        existingNames={existingRunNames}
        onCreate={handleCreateRun}
      />
    </div>
  );
}

// ===========================================================================
// Run History Tab
// ===========================================================================

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "—";
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function parseFqn(fqn: string) {
  const parts = fqn.split(".");
  return { catalog: parts[0] || "", schema: parts[1] || "", table: parts[2] || "" };
}

function statusBadge(status: string | null) {
  switch (status) {
    case "SUCCESS":
      return (
        <Badge variant="outline" className="gap-1 border-green-500 text-green-600">
          <CheckCircle2 className="h-3 w-3" />
          Success
        </Badge>
      );
    case "FAILED":
      return (
        <Badge variant="outline" className="gap-1 border-red-500 text-red-600">
          <XCircle className="h-3 w-3" />
          Failed
        </Badge>
      );
    case "RUNNING":
      return (
        <Badge variant="outline" className="gap-1 border-amber-500 text-amber-600">
          <Clock className="h-3 w-3 animate-spin" />
          Running
        </Badge>
      );
    default:
      return <Badge variant="secondary">{status ?? "Unknown"}</Badge>;
  }
}

function RunHistoryTab() {
  const { data: currentUser } = useCurrentUserSuspense(selector<UserType>());
  const currentUserEmail = currentUser?.user_name ?? "";

  const [catalogFilter, setCatalogFilter] = useState("all");
  const [schemaFilter, setSchemaFilter] = useState("all");
  const [tableSearch, setTableSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [myRunsOnly, setMyRunsOnly] = useState(false);
  const [isRunDialogOpen, setIsRunDialogOpen] = useState(false);

  const { data: runsResp, isLoading, error, refetch } = useListValidationRuns();
  const allRuns: ValidationRunSummaryOut[] = Array.isArray(runsResp?.data) ? runsResp.data : [];

  const { catalogs, schemasByCatalog } = useMemo(() => {
    const catalogSet = new Set<string>();
    const schemaMap = new Map<string, Set<string>>();
    for (const run of allRuns) {
      const { catalog, schema } = parseFqn(run.source_table_fqn);
      if (catalog) {
        catalogSet.add(catalog);
        if (!schemaMap.has(catalog)) schemaMap.set(catalog, new Set());
        if (schema) schemaMap.get(catalog)!.add(schema);
      }
    }
    return {
      catalogs: Array.from(catalogSet).sort(),
      schemasByCatalog: Object.fromEntries(
        Array.from(schemaMap.entries()).map(([cat, schemas]) => [cat, Array.from(schemas).sort()]),
      ),
    };
  }, [allRuns]);

  const runs = useMemo(() => {
    return allRuns.filter((run) => {
      const { catalog, schema, table } = parseFqn(run.source_table_fqn);
      if (catalogFilter !== "all" && catalog !== catalogFilter) return false;
      if (schemaFilter !== "all" && schema !== schemaFilter) return false;
      if (tableSearch && !table.toLowerCase().includes(tableSearch.toLowerCase()) && !run.source_table_fqn.toLowerCase().includes(tableSearch.toLowerCase())) return false;
      if (statusFilter !== "all" && run.status !== statusFilter) return false;
      if (myRunsOnly && currentUserEmail && run.requesting_user !== currentUserEmail) return false;
      return true;
    });
  }, [allRuns, catalogFilter, schemaFilter, tableSearch, statusFilter, myRunsOnly, currentUserEmail]);

  const availableSchemas = catalogFilter !== "all" ? schemasByCatalog[catalogFilter] || [] : [];

  const handleCatalogChange = (value: string) => {
    setCatalogFilter(value);
    setSchemaFilter("all");
  };

  const hasActiveFilters = catalogFilter !== "all" || schemaFilter !== "all" || tableSearch !== "" || statusFilter !== "all" || myRunsOnly;

  return (
    <div className="space-y-4 h-full overflow-y-auto">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold tracking-tight">Run History</h2>
          <p className="text-muted-foreground text-sm">
            View past rule validation results and trigger new runs.
          </p>
        </div>
        <Button onClick={() => setIsRunDialogOpen(true)} className="gap-2">
          <Play className="h-4 w-4" />
          Run rules
        </Button>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <History className="h-4 w-4" />
                Validation runs
              </CardTitle>
              <CardDescription>
                {isLoading
                  ? "Loading..."
                  : `${runs.length} run${runs.length !== 1 ? "s" : ""}${
                      runs.length !== allRuns.length ? ` (filtered from ${allRuns.length})` : ""
                    }`}
              </CardDescription>
            </div>
            <Button variant="ghost" size="sm" onClick={() => refetch()} className="gap-1.5 text-xs">
              <RotateCcw className="h-3.5 w-3.5" />
              Refresh
            </Button>
          </div>

          <div className="flex items-center gap-2 flex-wrap pt-2">
            <Select value={catalogFilter} onValueChange={handleCatalogChange}>
              <SelectTrigger className="w-[160px]">
                <SelectValue placeholder="All Catalogs" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Catalogs</SelectItem>
                {catalogs.map((cat) => (
                  <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={schemaFilter} onValueChange={setSchemaFilter} disabled={catalogFilter === "all"}>
              <SelectTrigger className="w-[160px]">
                <SelectValue placeholder="All Schemas" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Schemas</SelectItem>
                {availableSchemas.map((sch) => (
                  <SelectItem key={sch} value={sch}>{sch}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                value={tableSearch}
                onChange={(e) => setTableSearch(e.target.value)}
                placeholder="Search table..."
                className="w-[180px] h-9 pl-8 text-sm"
              />
            </div>

            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[140px]">
                <SelectValue placeholder="All Statuses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                <SelectItem value="SUCCESS">Success</SelectItem>
                <SelectItem value="FAILED">Failed</SelectItem>
                <SelectItem value="RUNNING">Running</SelectItem>
              </SelectContent>
            </Select>

            <Button
              variant={myRunsOnly ? "default" : "outline"}
              size="sm"
              className="h-9 gap-1.5 text-xs"
              onClick={() => setMyRunsOnly((prev) => !prev)}
            >
              <User className="h-3.5 w-3.5" />
              My runs
            </Button>

            {hasActiveFilters && (
              <Button
                variant="ghost"
                size="sm"
                className="h-9 text-xs"
                onClick={() => {
                  setCatalogFilter("all");
                  setSchemaFilter("all");
                  setTableSearch("");
                  setStatusFilter("all");
                  setMyRunsOnly(false);
                }}
              >
                Clear filters
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {isLoading && (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => <Skeleton key={i} className="h-14 w-full" />)}
            </div>
          )}

          {error && (
            <p className="text-destructive text-sm">Failed to load run history: {(error as Error).message}</p>
          )}

          {!isLoading && !error && runs.length > 0 && (
            <FadeIn duration={0.3}>
              <div className="border rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/50">
                      <th className="text-left p-3 font-medium">Table</th>
                      <th className="text-left p-3 font-medium">Status</th>
                      <th className="text-left p-3 font-medium">Requested by</th>
                      <th className="text-right p-3 font-medium">Total</th>
                      <th className="text-right p-3 font-medium">Valid</th>
                      <th className="text-right p-3 font-medium">Invalid</th>
                      <th className="text-left p-3 font-medium">Run date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {runs.map((run) => {
                      const invalidPct =
                        run.total_rows && run.invalid_rows
                          ? ((run.invalid_rows / run.total_rows) * 100).toFixed(1)
                          : null;
                      return (
                        <tr
                          key={run.run_id}
                          className="border-b last:border-b-0 hover:bg-muted/30 transition-colors"
                        >
                          <td className="p-3 font-mono text-xs">{run.source_table_fqn}</td>
                          <td className="p-3">{statusBadge(run.status)}</td>
                          <td className="p-3 text-xs text-muted-foreground truncate max-w-[180px]" title={run.requesting_user ?? ""}>
                            {run.requesting_user ?? "—"}
                          </td>
                          <td className="p-3 text-right tabular-nums">{run.total_rows?.toLocaleString() ?? "—"}</td>
                          <td className="p-3 text-right tabular-nums text-green-600">
                            {run.valid_rows?.toLocaleString() ?? "—"}
                          </td>
                          <td className="p-3 text-right tabular-nums">
                            {run.invalid_rows != null ? (
                              <span className={run.invalid_rows > 0 ? "text-red-600 font-medium" : ""}>
                                {run.invalid_rows.toLocaleString()}
                                {invalidPct && run.invalid_rows > 0 && (
                                  <span className="text-muted-foreground font-normal ml-1">({invalidPct}%)</span>
                                )}
                              </span>
                            ) : (
                              "—"
                            )}
                          </td>
                          <td className="p-3 text-xs text-muted-foreground whitespace-nowrap" title={run.created_at ?? ""}>
                            {formatDate(run.created_at)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </FadeIn>
          )}

          {!isLoading && !error && runs.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-6">
                <History className="h-8 w-8 text-muted-foreground" />
              </div>
              <h3 className="text-lg font-medium text-muted-foreground">
                {hasActiveFilters ? "No matching runs" : "No runs yet"}
              </h3>
              <p className="text-muted-foreground/70 text-sm mt-1 max-w-md">
                {hasActiveFilters
                  ? "Try adjusting your filters to find runs."
                  : "Run your approved rules against tables to see validation results here."}
              </p>
              {!hasActiveFilters && (
                <Button onClick={() => setIsRunDialogOpen(true)} className="mt-4 gap-2">
                  <Play className="h-4 w-4" />
                  Run rules
                </Button>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <RunRulesDialog
        open={isRunDialogOpen}
        onOpenChange={setIsRunDialogOpen}
        onSuccess={() => refetch()}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Run Rules Dialog — pick an approved rule set and trigger a dry run
// ---------------------------------------------------------------------------

function RunRulesDialog({
  open,
  onOpenChange,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}) {
  const [selectedTable, setSelectedTable] = useState("");
  const [sampleSize, setSampleSize] = useState(1000);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const queryClient = useQueryClient();

  const { data: rulesResp, isLoading: rulesLoading } = useListRules(
    { status: "approved" },
    { query: { enabled: open } },
  );
  const approvedRules: RuleCatalogEntryOut[] = Array.isArray(rulesResp?.data)
    ? rulesResp.data.filter((r) => r.status === "approved")
    : [];

  const submitDryRun = useSubmitDryRun();

  useEffect(() => {
    if (open) {
      setSelectedTable("");
      setSampleSize(1000);
      setIsSubmitting(false);
    }
  }, [open]);

  const selectedRule = approvedRules.find((r) => r.table_fqn === selectedTable);

  const handleRun = async () => {
    if (!selectedRule) return;
    setIsSubmitting(true);
    try {
      await submitDryRun.mutateAsync({
        data: {
          table_fqn: selectedRule.table_fqn,
          checks: selectedRule.checks,
          sample_size: sampleSize,
        },
      });
      toast.success(`Validation run started for ${selectedRule.table_fqn}`);
      onOpenChange(false);
      queryClient.invalidateQueries({ queryKey: getListValidationRunsQueryKey() });
      onSuccess();
    } catch (err) {
      toast.error(`Failed to start run: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Run Rules</DialogTitle>
          <DialogDescription>
            Select an approved rule set to validate against its table.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <Label>Approved rule set</Label>
            {rulesLoading ? (
              <Skeleton className="h-10 w-full" />
            ) : approvedRules.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No approved rules found. Approve rules in Drafts & review first.
              </p>
            ) : (
              <Select value={selectedTable} onValueChange={setSelectedTable}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a table..." />
                </SelectTrigger>
                <SelectContent>
                  {approvedRules.map((rule) => (
                    <SelectItem key={rule.table_fqn} value={rule.table_fqn}>
                      <span className="font-mono text-xs">{rule.table_fqn}</span>
                      <span className="text-muted-foreground ml-2">({rule.checks.length} rules)</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
          <div className="grid gap-2">
            <Label htmlFor="sample-size">Sample size</Label>
            <Input
              id="sample-size"
              type="number"
              min={1}
              max={10000}
              value={sampleSize}
              onChange={(e) => setSampleSize(Number(e.target.value))}
            />
            <p className="text-xs text-muted-foreground">Max 10,000 rows</p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleRun} disabled={!selectedRule || isSubmitting} className="gap-2">
            {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            {isSubmitting ? "Starting..." : "Run"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ===========================================================================
// Skeletons / Error states for Run History
// ===========================================================================

function RunHistorySkeleton() {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <Skeleton className="h-7 w-32" />
          <Skeleton className="h-4 w-64" />
        </div>
        <Skeleton className="h-9 w-28" />
      </div>
      <Skeleton className="h-64 w-full" />
    </div>
  );
}

function RunHistoryError({ resetErrorBoundary }: { resetErrorBoundary: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <AlertCircle className="h-12 w-12 text-destructive/30 mb-3" />
      <p className="text-muted-foreground text-sm mb-1">Failed to load run history</p>
      <p className="text-muted-foreground/70 text-xs mb-3">
        The validation runs table may not exist yet. Run some rules first.
      </p>
      <Button variant="outline" size="sm" onClick={resetErrorBoundary} className="gap-2">
        <RotateCcw className="h-3 w-3" />
        Retry
      </Button>
    </div>
  );
}

// ===========================================================================
// Configurations Tab (preserved from original runs.tsx)
// ===========================================================================

function CreateRunDialog({
  open,
  onOpenChange,
  existingNames,
  onCreate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  existingNames: string[];
  onCreate: (name: string) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setName("");
      setIsSubmitting(false);
    }
  }, [open]);

  const isConflict = existingNames.includes(name);
  const isValid = name.trim().length > 0 && !isConflict;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isValid) return;
    setIsSubmitting(true);
    try {
      await onCreate(name);
    } catch {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Create New Run</DialogTitle>
          <DialogDescription>
            Enter a unique name for the new run configuration.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className={cn(isConflict && "border-destructive focus-visible:ring-destructive")}
                placeholder="e.g. daily_sales_check"
                autoFocus
                autoComplete="off"
              />
              {isConflict && (
                <p className="text-xs text-destructive">This run name already exists.</p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={!isValid || isSubmitting}>
              {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Create
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function RunsListSkeleton() {
  return (
    <div className="space-y-2">
      {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-10 w-full" />)}
    </div>
  );
}

function RunEditorSkeleton() {
  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between pb-4 border-b border-border/50">
        <div className="space-y-2">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-4 w-64" />
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-9 w-20" />
          <Skeleton className="h-9 w-20" />
          <Skeleton className="h-9 w-9" />
        </div>
      </div>
      <div className="flex-1 mt-4">
        <Skeleton className="h-full w-full rounded-lg" />
      </div>
    </div>
  );
}

function RunsListError({ resetErrorBoundary }: { resetErrorBoundary: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-8 text-center">
      <AlertCircle className="h-12 w-12 text-destructive/30 mb-3" />
      <p className="text-muted-foreground text-sm mb-1">Failed to load runs</p>
      <p className="text-muted-foreground/70 text-xs mb-3">
        Please check your configuration settings
      </p>
      <Button variant="outline" size="sm" onClick={resetErrorBoundary} className="gap-2">
        <RotateCcw className="h-3 w-3" />
        Retry
      </Button>
    </div>
  );
}

function RunEditorError({ resetErrorBoundary }: { resetErrorBoundary: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center h-full text-center">
      <AlertCircle className="h-16 w-16 text-destructive/30 mb-4" />
      <h3 className="text-lg font-semibold mb-2">Failed to load run editor</h3>
      <p className="text-muted-foreground text-sm mb-4">
        Please check your configuration settings
      </p>
      <Button variant="outline" onClick={resetErrorBoundary} className="gap-2">
        <RotateCcw className="h-4 w-4" />
        Retry
      </Button>
    </div>
  );
}

function RunsSidebarList({
  currentRunName,
  isDeleting,
}: {
  currentRunName?: string;
  isDeleting?: boolean;
}) {
  const { data: configData } = useConfigSuspense(selector<ConfigOut>());
  const runConfigs = configData.config.run_configs || [];
  const hasRuns = runConfigs.length > 0;

  if (isDeleting) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!hasRuns) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-center">
        <FileCode className="h-12 w-12 text-muted-foreground/30 mb-3" />
        <p className="text-muted-foreground text-sm mb-1">No runs configured</p>
        <p className="text-muted-foreground/70 text-xs">
          Click the + button to create your first run
        </p>
      </div>
    );
  }

  return (
    <>
      {runConfigs.map((run) => (
        <div
          key={run.name}
          className={cn(
            "group flex items-center gap-2 rounded-lg transition-all duration-200",
            currentRunName === run.name
              ? "bg-primary/10 ring-1 ring-primary/20"
              : "hover:bg-muted/50",
          )}
        >
          <Link
            to="/runs/$runName"
            params={{ runName: run.name || "" }}
            className={cn(
              "flex-1 flex items-center gap-3 px-3 py-2.5 text-sm font-medium",
              currentRunName === run.name
                ? "text-primary"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <FileCode className="h-4 w-4 shrink-0" />
            <span className="truncate">{run.name}</span>
          </Link>
        </div>
      ))}
    </>
  );
}

function RunEditorContainer({
  currentRunName,
  onAddRun,
  onDeletingChange,
}: {
  currentRunName?: string;
  onAddRun: () => void;
  onDeletingChange: (isDeleting: boolean) => void;
}) {
  const { data: configData, refetch } = useConfigSuspense(selector<ConfigOut>());
  const { mutateAsync: saveRun, isPending: isSaving } = useSaveRunConfig();
  const { mutateAsync: deleteRun, isPending: isDeleting } = useDeleteRunConfig();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { setRunContext } = useAIAssistant();

  const [isDeleteOpen, setIsDeleteOpen] = useState(false);

  useEffect(() => {
    onDeletingChange(isDeleting);
  }, [isDeleting, onDeletingChange]);

  const runConfigs = configData.config.run_configs || [];
  const selectedRun = currentRunName
    ? runConfigs.find((r) => r.name === currentRunName)
    : undefined;

  const hasRuns = runConfigs.length > 0;
  const runNotFound = currentRunName && !selectedRun;

  const [yamlContent, setYamlContent] = useState("");
  const [isDirty, setIsDirty] = useState(false);

  useEffect(() => {
    if (selectedRun) {
      try {
        const dump = yaml.dump(selectedRun);
        setYamlContent(dump);
        setIsDirty(false);
      } catch (e) {
        console.error("Error converting config to YAML", e);
        toast.error("Error parsing run configuration");
      }
    } else {
      setYamlContent("");
      setIsDirty(false);
    }
  }, [selectedRun, currentRunName]);

  useEffect(() => {
    if (currentRunName && yamlContent) {
      setRunContext({ runName: currentRunName, yaml: yamlContent });
    } else {
      setRunContext(null);
    }
  }, [currentRunName, yamlContent, setRunContext]);

  useEffect(() => () => setRunContext(null), [setRunContext]);

  const handleSave = async () => {
    if (!currentRunName) return;
    try {
      const parsedConfig = yaml.load(yamlContent) as RunConfig;
      if (typeof parsedConfig !== "object" || !parsedConfig) throw new Error("Invalid YAML content");
      if (!parsedConfig.name) throw new Error("Run name is required");
      await saveRun({ data: { config: parsedConfig } });
      toast.success("Run configuration saved successfully");
      setIsDirty(false);
      if (parsedConfig.name !== currentRunName) {
        navigate({ to: "/runs/$runName", params: { runName: parsedConfig.name } });
      }
      await refetch();
    } catch (error) {
      console.error("Save error", error);
      const message = error instanceof Error ? error.message : "Check YAML syntax or validation errors.";
      toast.error(`Failed to save: ${message}`);
    }
  };

  const handleDelete = async () => {
    if (!currentRunName) return;
    setIsDeleteOpen(false);
    const deletedRunName = currentRunName;

    queryClient.setQueryData(["/api/config"], (oldData: any) => {
      if (!oldData?.data?.config?.run_configs) return oldData;
      return {
        ...oldData,
        data: {
          ...oldData.data,
          config: {
            ...oldData.data.config,
            run_configs: oldData.data.config.run_configs.filter(
              (run: RunConfig) => run.name !== deletedRunName,
            ),
          },
        },
      };
    });

    navigate({ to: "/runs" });

    try {
      await deleteRun({ name: deletedRunName });
      await queryClient.refetchQueries({ queryKey: ["/api/config"] });
      toast.success(`Run "${deletedRunName}" deleted`);
    } catch (error) {
      console.error("Delete error", error);
      toast.error("Failed to delete run");
      await queryClient.refetchQueries({ queryKey: ["/api/config"] });
    }
  };

  const handleReset = () => {
    if (selectedRun) {
      try {
        const dump = yaml.dump(selectedRun);
        setYamlContent(dump);
        setIsDirty(false);
        toast.info("Changes discarded");
      } catch (e) {
        console.error("Error converting config to YAML", e);
      }
    }
  };

  if (isDeleting) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!hasRuns) return <EmptyState onAddRun={onAddRun} />;
  if (runNotFound) return <RunNotFoundState runName={currentRunName!} onAddRun={onAddRun} />;
  if (!selectedRun) return <SelectRunState />;

  return (
    <RunEditor
      runName={currentRunName!}
      yamlContent={yamlContent}
      setYamlContent={setYamlContent}
      isDirty={isDirty}
      setIsDirty={setIsDirty}
      onSave={handleSave}
      onReset={handleReset}
      onDelete={handleDelete}
      isSaving={isSaving}
      isDeleting={isDeleting}
      isDeleteOpen={isDeleteOpen}
      setIsDeleteOpen={setIsDeleteOpen}
    />
  );
}

function EmptyState({ onAddRun }: { onAddRun: () => void }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center text-center p-8">
      <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mb-6">
        <FileCode className="h-8 w-8 text-primary" />
      </div>
      <h3 className="text-xl font-semibold mb-2">No Run Configurations</h3>
      <p className="text-muted-foreground mb-6 max-w-md">
        Run configurations define how DQX processes your data quality checks.
        Create your first run to get started.
      </p>
      <Button onClick={onAddRun} className="gap-2">
        <Plus className="h-4 w-4" />
        Create Your First Run
      </Button>
    </div>
  );
}

function RunNotFoundState({ runName, onAddRun }: { runName: string; onAddRun: () => void }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center text-center p-8">
      <div className="w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center mb-6">
        <AlertCircle className="h-8 w-8 text-destructive" />
      </div>
      <h3 className="text-xl font-semibold mb-2">Run Not Found</h3>
      <p className="text-muted-foreground mb-6 max-w-md">
        The run configuration{" "}
        <code className="px-1.5 py-0.5 bg-muted rounded text-sm font-mono">{runName}</code>{" "}
        does not exist. It may have been deleted or renamed.
      </p>
      <div className="flex gap-3">
        <Button variant="outline" asChild>
          <Link to="/runs">View All Runs</Link>
        </Button>
        <Button onClick={onAddRun} className="gap-2">
          <Plus className="h-4 w-4" />
          Create New Run
        </Button>
      </div>
    </div>
  );
}

function SelectRunState() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center text-center p-8">
      <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-6">
        <FileCode className="h-8 w-8 text-muted-foreground" />
      </div>
      <h3 className="text-lg font-medium text-muted-foreground">Select a Run</h3>
      <p className="text-muted-foreground/70 text-sm mt-1">
        Choose a run configuration from the list to view and edit
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Run Editor with Form and YAML modes
// ---------------------------------------------------------------------------

interface RunEditorProps {
  runName: string;
  yamlContent: string;
  setYamlContent: (content: string) => void;
  isDirty: boolean;
  setIsDirty: (dirty: boolean) => void;
  onSave: () => void;
  onReset: () => void;
  onDelete: () => void;
  isSaving: boolean;
  isDeleting: boolean;
  isDeleteOpen: boolean;
  setIsDeleteOpen: (open: boolean) => void;
}

function RunEditor({
  runName,
  yamlContent,
  setYamlContent,
  isDirty,
  setIsDirty,
  onSave,
  onReset,
  onDelete,
  isSaving,
  isDeleting,
  isDeleteOpen,
  setIsDeleteOpen,
}: RunEditorProps) {
  const isLocked = isSaving || isDeleting;
  const [editorMode, setEditorMode] = useState<"form" | "yaml">("form");

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="flex items-center justify-between pb-4 border-b border-border/50">
        <div className="flex-1">
          <h2 className="text-2xl font-bold tracking-tight">{runName}</h2>
          <p className="text-muted-foreground text-sm mt-0.5">
            Edit configuration using {editorMode === "form" ? "form" : "YAML editor"}
            {isDirty && <span className="text-amber-500 ml-2">• Unsaved changes</span>}
          </p>
        </div>
        <div className="flex items-center gap-4">
          <Tabs value={editorMode} onValueChange={(v) => setEditorMode(v as "form" | "yaml")}>
            <TabsList>
              <TabsTrigger value="form" className="gap-2">
                <FormInput className="h-4 w-4" />
                Form
              </TabsTrigger>
              <TabsTrigger value="yaml" className="gap-2">
                <FileCode className="h-4 w-4" />
                YAML
              </TabsTrigger>
            </TabsList>
          </Tabs>
          <div className="h-8 w-px bg-border" />
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon" onClick={onReset} disabled={!isDirty || isLocked} title="Reset changes">
              <RotateCcw className="h-4 w-4" />
            </Button>
            <Button onClick={onSave} variant="default" size="icon" disabled={!isDirty || isLocked} title="Save changes">
              {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            </Button>
            <AlertDialog open={isDeleteOpen} onOpenChange={setIsDeleteOpen}>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" size="icon" disabled={isDeleting || isLocked} title="Delete Run">
                  <Trash2 className="h-4 w-4" />
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete Run Configuration</AlertDialogTitle>
                  <AlertDialogDescription>
                    Are you sure you want to delete the run configuration{" "}
                    <span className="font-mono font-medium">{runName}</span>? This action cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={(e) => { e.preventDefault(); if (!isDeleting) onDelete(); }}
                    disabled={isDeleting}
                    className="bg-destructive text-foreground hover:bg-destructive/90"
                  >
                    {isDeleting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                    Delete
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>
      </div>
      <div className="flex-1 min-h-0 mt-4">
        {editorMode === "form" ? (
          <FormEditor yamlContent={yamlContent} setYamlContent={setYamlContent} setIsDirty={setIsDirty} isLocked={isLocked} />
        ) : (
          <YamlEditor yamlContent={yamlContent} setYamlContent={setYamlContent} setIsDirty={setIsDirty} isLocked={isLocked} />
        )}
      </div>
    </div>
  );
}

function YamlEditor({
  yamlContent, setYamlContent, setIsDirty, isLocked,
}: { yamlContent: string; setYamlContent: (c: string) => void; setIsDirty: (d: boolean) => void; isLocked: boolean }) {
  return (
    <div className="h-full relative">
      <div className="absolute inset-0 rounded-lg border border-border/50 bg-muted/30 overflow-hidden">
        <textarea
          value={yamlContent}
          onChange={(e) => { setYamlContent(e.target.value); setIsDirty(true); }}
          disabled={isLocked}
          className={cn(
            "w-full h-full resize-none p-4",
            "font-mono text-sm leading-relaxed",
            "bg-transparent focus:outline-none",
            "placeholder:text-muted-foreground/50",
            isLocked && "opacity-50 cursor-not-allowed",
          )}
          spellCheck={false}
          placeholder="# Run configuration YAML..."
        />
      </div>
    </div>
  );
}

function FormEditor({
  yamlContent, setYamlContent, setIsDirty, isLocked,
}: { yamlContent: string; setYamlContent: (c: string) => void; setIsDirty: (d: boolean) => void; isLocked: boolean }) {
  const [formData, setFormData] = useState<RunConfig | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);

  useEffect(() => {
    try {
      const parsed = yaml.load(yamlContent) as RunConfig;
      setFormData(parsed);
      setParseError(null);
    } catch (e) {
      setParseError(e instanceof Error ? e.message : "Failed to parse YAML");
      setFormData(null);
    }
  }, [yamlContent]);

  const updateFormData = (updates: Partial<RunConfig>) => {
    if (!formData) return;
    const updated = { ...formData, ...updates };
    setFormData(updated);
    try {
      const newYaml = yaml.dump(updated);
      setYamlContent(newYaml);
      setIsDirty(true);
    } catch {
      toast.error("Failed to convert form data to YAML");
    }
  };

  if (parseError) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center">
          <AlertCircle className="h-12 w-12 text-destructive mx-auto mb-3" />
          <p className="text-destructive font-medium mb-1">Invalid YAML</p>
          <p className="text-muted-foreground text-sm">{parseError}</p>
          <p className="text-muted-foreground text-xs mt-2">Switch to YAML mode to fix the syntax</p>
        </div>
      </div>
    );
  }

  if (!formData) {
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-4xl space-y-8 pr-4">
        <section>
          <h3 className="text-lg font-semibold mb-4">Basic Configuration</h3>
          <div className="space-y-4">
            <div className="grid gap-2">
              <Label htmlFor="name">Name</Label>
              <Input id="name" value={formData.name || ""} onChange={(e) => updateFormData({ name: e.target.value })} disabled={isLocked} placeholder="e.g., daily_check" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="checks_location">Checks Location</Label>
              <Input id="checks_location" value={formData.checks_location || ""} onChange={(e) => updateFormData({ checks_location: e.target.value })} disabled={isLocked} placeholder="e.g., checks.yml or table_name" />
              <p className="text-xs text-muted-foreground">Workspace file path, table name, volume path, or Delta table name</p>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="warehouse_id">Warehouse ID</Label>
              <Input id="warehouse_id" value={formData.warehouse_id || ""} onChange={(e) => updateFormData({ warehouse_id: e.target.value })} disabled={isLocked} placeholder="Optional warehouse ID" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="checks_user_requirements">Checks User Requirements (AI-Assisted)</Label>
              <Textarea id="checks_user_requirements" value={formData.checks_user_requirements || ""} onChange={(e) => updateFormData({ checks_user_requirements: e.target.value })} disabled={isLocked} placeholder="Describe requirements for AI-assisted rule generation..." rows={3} />
            </div>
          </div>
        </section>

        <section>
          <h3 className="text-lg font-semibold mb-4">Input Configuration</h3>
          <ConfigSection title="Input Config" config={formData.input_config} onUpdate={(config) => updateFormData({ input_config: config })} isLocked={isLocked} type="input" />
        </section>

        <section>
          <h3 className="text-lg font-semibold mb-4">Output Configurations</h3>
          <div className="space-y-6">
            <ConfigSection title="Output Config" config={formData.output_config} onUpdate={(config) => updateFormData({ output_config: config })} isLocked={isLocked} type="output" />
            <ConfigSection title="Quarantine Config" config={formData.quarantine_config} onUpdate={(config) => updateFormData({ quarantine_config: config })} isLocked={isLocked} type="output" />
            <ConfigSection title="Metrics Config" config={formData.metrics_config} onUpdate={(config) => updateFormData({ metrics_config: config })} isLocked={isLocked} type="output" />
          </div>
        </section>

        <section>
          <h3 className="text-lg font-semibold mb-4">Profiler Configuration</h3>
          <ProfilerConfigSection config={formData.profiler_config} onUpdate={(config) => updateFormData({ profiler_config: config })} isLocked={isLocked} />
        </section>

        <section>
          <h3 className="text-lg font-semibold mb-4">Lakebase Configuration</h3>
          <div className="space-y-4">
            <div className="grid gap-2">
              <Label htmlFor="lakebase_instance_name">Instance Name</Label>
              <Input id="lakebase_instance_name" value={formData.lakebase_instance_name || ""} onChange={(e) => updateFormData({ lakebase_instance_name: e.target.value })} disabled={isLocked} placeholder="Optional Lakebase instance name" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="lakebase_client_id">Client ID</Label>
              <Input id="lakebase_client_id" value={formData.lakebase_client_id || ""} onChange={(e) => updateFormData({ lakebase_client_id: e.target.value })} disabled={isLocked} placeholder="Optional Lakebase Client ID" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="lakebase_port">Port</Label>
              <Input id="lakebase_port" value={formData.lakebase_port || ""} onChange={(e) => updateFormData({ lakebase_port: e.target.value })} disabled={isLocked} placeholder="Optional Lakebase port" />
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

function ConfigSection({
  title, config, onUpdate, isLocked, type,
}: { title: string; config: any; onUpdate: (config: any) => void; isLocked: boolean; type: "input" | "output" }) {
  const [isEnabled, setIsEnabled] = useState(!!config);

  const handleToggle = (enabled: boolean) => {
    setIsEnabled(enabled);
    if (enabled) {
      onUpdate({
        location: "",
        format: "delta",
        ...(type === "input" ? { is_streaming: false } : { mode: "append" }),
        options: {},
        ...(type === "output" && { trigger: {} }),
      });
    } else {
      onUpdate(null);
    }
  };

  const updateConfig = (updates: any) => {
    onUpdate({ ...config, ...updates });
  };

  return (
    <div className="border border-border/50 rounded-lg p-4 space-y-4">
      <div className="flex items-center justify-between">
        <Label htmlFor={`${title}-toggle`} className="font-medium">{title}</Label>
        <Switch id={`${title}-toggle`} checked={isEnabled} onCheckedChange={handleToggle} disabled={isLocked} />
      </div>
      {isEnabled && config && (
        <div className="space-y-3 pl-4 border-l-2 border-border/30">
          <div className="grid gap-2">
            <Label htmlFor={`${title}-location`}>Location</Label>
            <Input id={`${title}-location`} value={config.location || ""} onChange={(e) => updateConfig({ location: e.target.value })} disabled={isLocked} placeholder="Table name or file path" />
          </div>
          <div className="grid gap-2">
            <Label htmlFor={`${title}-format`}>Format</Label>
            <Select value={config.format || "delta"} onValueChange={(value) => updateConfig({ format: value })} disabled={isLocked}>
              <SelectTrigger id={`${title}-format`}><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="delta">Delta</SelectItem>
                <SelectItem value="parquet">Parquet</SelectItem>
                <SelectItem value="csv">CSV</SelectItem>
                <SelectItem value="json">JSON</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {type === "input" && (
            <div className="flex items-center space-x-2">
              <Switch id={`${title}-streaming`} checked={config.is_streaming || false} onCheckedChange={(checked) => updateConfig({ is_streaming: checked })} disabled={isLocked} />
              <Label htmlFor={`${title}-streaming`}>Is Streaming</Label>
            </div>
          )}
          {type === "output" && (
            <div className="grid gap-2">
              <Label htmlFor={`${title}-mode`}>Mode</Label>
              <Select value={config.mode || "append"} onValueChange={(value) => updateConfig({ mode: value })} disabled={isLocked}>
                <SelectTrigger id={`${title}-mode`}><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="append">Append</SelectItem>
                  <SelectItem value="overwrite">Overwrite</SelectItem>
                  <SelectItem value="errorifexists">Error If Exists</SelectItem>
                  <SelectItem value="ignore">Ignore</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ProfilerConfigSection({
  config, onUpdate, isLocked,
}: { config: any; onUpdate: (config: any) => void; isLocked: boolean }) {
  const updateConfig = (updates: any) => {
    onUpdate({ ...config, ...updates });
  };

  return (
    <div className="border border-border/50 rounded-lg p-4 space-y-4">
      <div className="grid gap-2">
        <Label htmlFor="profiler-summary-file">Summary Stats File</Label>
        <Input id="profiler-summary-file" value={config?.summary_stats_file || "profile_summary_stats.yml"} onChange={(e) => updateConfig({ summary_stats_file: e.target.value })} disabled={isLocked} placeholder="profile_summary_stats.yml" />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="profiler-sample-fraction">Sample Fraction</Label>
        <Input id="profiler-sample-fraction" type="number" step="0.1" min="0" max="1" value={config?.sample_fraction || 0.3} onChange={(e) => updateConfig({ sample_fraction: parseFloat(e.target.value) })} disabled={isLocked} placeholder="0.3" />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="profiler-limit">Limit</Label>
        <Input id="profiler-limit" type="number" value={config?.limit || 1000} onChange={(e) => updateConfig({ limit: parseInt(e.target.value) })} disabled={isLocked} placeholder="1000" />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="profiler-sample-seed">Sample Seed</Label>
        <Input id="profiler-sample-seed" type="number" value={config?.sample_seed || ""} onChange={(e) => updateConfig({ sample_seed: e.target.value ? parseInt(e.target.value) : null })} disabled={isLocked} placeholder="Optional seed for sampling" />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="profiler-filter">Filter</Label>
        <Input id="profiler-filter" value={config?.filter || ""} onChange={(e) => updateConfig({ filter: e.target.value || null })} disabled={isLocked} placeholder="Optional filter expression" />
      </div>
    </div>
  );
}
