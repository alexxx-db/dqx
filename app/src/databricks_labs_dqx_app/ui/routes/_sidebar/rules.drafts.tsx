import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, Suspense, useMemo } from "react";
import { useQueries } from "@tanstack/react-query";
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
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ClipboardCheck,
  Plus,
  Trash2,
  SendHorizonal,
  CheckCircle2,
  XCircle,
  Clock,
  FileEdit,
  Tag,
  User,
} from "lucide-react";
import { FadeIn } from "@/components/anim/FadeIn";
import { toast } from "sonner";
import {
  useListRules,
  useDeleteRules,
  useSubmitRulesForApproval,
  useApproveRules,
  useRejectRules,
  getTableTags,
  type RuleCatalogEntryOut,
  type User as UserType,
} from "@/lib/api";
import { usePermissions } from "@/hooks/use-permissions";
import { useCurrentUserSuspense } from "@/hooks/use-suspense-queries";
import selector from "@/lib/selector";

export const Route = createFileRoute("/_sidebar/rules/drafts")({
  component: () => (
    <Suspense fallback={<DraftsSkeleton />}>
      <DraftsPage />
    </Suspense>
  ),
});

function DraftsSkeleton() {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Skeleton className="h-6 w-24" />
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-64" />
      </div>
      <Skeleton className="h-64 w-full" />
    </div>
  );
}

const STATUS_OPTIONS = [
  { value: "all", label: "All Statuses" },
  { value: "draft", label: "Draft" },
  { value: "pending_approval", label: "Pending Approval" },
  { value: "rejected", label: "Rejected" },
];

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

function parseFqn(fqn: string) {
  const parts = fqn.split(".");
  return { catalog: parts[0] || "", schema: parts[1] || "", table: parts[2] || "" };
}

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "—";
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function DraftsPage() {
  const navigate = useNavigate();
  const [statusFilter, setStatusFilter] = useState("all");
  const [catalogFilter, setCatalogFilter] = useState("all");
  const [schemaFilter, setSchemaFilter] = useState("all");
  const [tagFilter, setTagFilter] = useState("all");
  const [mySubmissionsOnly, setMySubmissionsOnly] = useState(false);
  const [pendingAction, setPendingAction] = useState<string | null>(null);

  const { canCreateRules, canEditRules, canSubmitRules, canApproveRules } = usePermissions();
  const { data: currentUser } = useCurrentUserSuspense(selector<UserType>());
  const currentUserEmail = currentUser?.user_name ?? "";

  const { data: rulesResp, isLoading, error, refetch } = useListRules(
    statusFilter === "all" ? {} : { status: statusFilter },
  );
  const allRulesRaw: RuleCatalogEntryOut[] = Array.isArray(rulesResp?.data) ? rulesResp.data : [];

  const allRules = useMemo(
    () => allRulesRaw.filter((r) => r.status !== "approved"),
    [allRulesRaw],
  );

  const { catalogs, schemasByCatalog } = useMemo(() => {
    const catalogSet = new Set<string>();
    const schemaMap = new Map<string, Set<string>>();
    for (const rule of allRules) {
      const { catalog, schema } = parseFqn(rule.table_fqn);
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
  }, [allRules]);

  const tagQueries = useQueries({
    queries: allRules.map((rule) => {
      const { catalog, schema, table } = parseFqn(rule.table_fqn);
      return {
        queryKey: ["tableTags", catalog, schema, table],
        queryFn: () => getTableTags(catalog, schema, table),
        enabled: !!catalog && !!schema && !!table,
        staleTime: 5 * 60 * 1000,
        retry: false,
      };
    }),
  });

  const tagsMap = useMemo(() => {
    const map: Record<string, string[]> = {};
    tagQueries.forEach((query, idx) => {
      if (query.data?.data) {
        const tableFqn = allRules[idx]?.table_fqn;
        if (tableFqn) {
          const allTags = [
            ...(query.data.data.table_tags || []),
            ...Object.values(query.data.data.column_tags || {}).flat(),
          ];
          map[tableFqn] = [...new Set(allTags)];
        }
      }
    });
    return map;
  }, [tagQueries, allRules]);

  const allUniqueTags = useMemo(() => {
    const tagSet = new Set<string>();
    Object.values(tagsMap).forEach((tags) => tags.forEach((tag) => tagSet.add(tag)));
    return Array.from(tagSet).sort();
  }, [tagsMap]);

  const rules = useMemo(() => {
    return allRules.filter((rule) => {
      const { catalog, schema } = parseFqn(rule.table_fqn);
      if (catalogFilter !== "all" && catalog !== catalogFilter) return false;
      if (schemaFilter !== "all" && schema !== schemaFilter) return false;
      if (tagFilter !== "all") {
        const ruleTags = tagsMap[rule.table_fqn] || [];
        if (!ruleTags.includes(tagFilter)) return false;
      }
      if (mySubmissionsOnly && currentUserEmail) {
        const submitter = rule.updated_by ?? rule.created_by ?? "";
        if (submitter !== currentUserEmail) return false;
      }
      return true;
    });
  }, [allRules, catalogFilter, schemaFilter, tagFilter, tagsMap, mySubmissionsOnly, currentUserEmail]);

  const availableSchemas = catalogFilter !== "all" ? schemasByCatalog[catalogFilter] || [] : [];

  const handleCatalogChange = (value: string) => {
    setCatalogFilter(value);
    setSchemaFilter("all");
  };

  const deleteRulesMutation = useDeleteRules();
  const submitMutation = useSubmitRulesForApproval();
  const approveMutation = useApproveRules();
  const rejectMutation = useRejectRules();

  const isBusy = pendingAction !== null;

  const handleDelete = async (tableFqn: string) => {
    if (isBusy) return;
    if (!confirm(`Delete rules for ${tableFqn}?`)) return;
    setPendingAction(tableFqn);
    try {
      await deleteRulesMutation.mutateAsync({ tableFqn });
      toast.success(`Rules deleted for ${tableFqn}`);
      refetch();
    } catch {
      toast.error("Failed to delete rules");
    } finally {
      setPendingAction(null);
    }
  };

  const handleSubmit = async (tableFqn: string, version: number) => {
    if (isBusy) return;
    setPendingAction(tableFqn);
    try {
      await submitMutation.mutateAsync({
        tableFqn,
        data: { status: "pending_approval", expected_version: version },
      });
      toast.success("Submitted for approval");
      refetch();
    } catch {
      toast.error("Failed to submit for approval");
    } finally {
      setPendingAction(null);
    }
  };

  const handleApprove = async (tableFqn: string, version: number) => {
    if (isBusy) return;
    setPendingAction(tableFqn);
    try {
      await approveMutation.mutateAsync({
        tableFqn,
        data: { status: "approved", expected_version: version },
      });
      toast.success("Rules approved — moved to Active rules");
      refetch();
    } catch {
      toast.error("Failed to approve rules");
    } finally {
      setPendingAction(null);
    }
  };

  const handleReject = async (tableFqn: string, version: number) => {
    if (isBusy) return;
    setPendingAction(tableFqn);
    try {
      await rejectMutation.mutateAsync({
        tableFqn,
        data: { status: "rejected", expected_version: version },
      });
      toast.success("Rules rejected");
      refetch();
    } catch {
      toast.error("Failed to reject rules");
    } finally {
      setPendingAction(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <PageBreadcrumb items={[{ label: "Rules", to: "/rules/active" }]} page="Drafts & review" />
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Drafts & review</h1>
            <p className="text-muted-foreground">
              Rule sets awaiting review, recently created drafts, and rejected sets.
            </p>
          </div>
          {canCreateRules && (
            <Button onClick={() => navigate({ to: "/rules/create" })} className="gap-2">
              <Plus className="h-4 w-4" />
              Create rules
            </Button>
          )}
        </div>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <ClipboardCheck className="h-5 w-5" />
                  Rule sets
                </CardTitle>
                <CardDescription>
                  {isLoading
                    ? "Loading..."
                    : `${rules.length} rule set${rules.length !== 1 ? "s" : ""}${
                        rules.length !== allRules.length ? ` (filtered from ${allRules.length})` : ""
                      }`}
                </CardDescription>
              </div>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
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

              <Select value={tagFilter} onValueChange={setTagFilter}>
                <SelectTrigger className="w-[180px]">
                  <div className="flex items-center gap-1.5">
                    <Tag className="h-3.5 w-3.5 text-muted-foreground" />
                    <SelectValue placeholder="All Tags" />
                  </div>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Tags</SelectItem>
                  {allUniqueTags.map((tag) => (
                    <SelectItem key={tag} value={tag}>{tag}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-[160px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Button
                variant={mySubmissionsOnly ? "default" : "outline"}
                size="sm"
                className="h-9 gap-1.5 text-xs"
                onClick={() => setMySubmissionsOnly((prev) => !prev)}
              >
                <User className="h-3.5 w-3.5" />
                My submissions
              </Button>

              {(catalogFilter !== "all" || schemaFilter !== "all" || tagFilter !== "all" || statusFilter !== "all" || mySubmissionsOnly) && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-9 text-xs"
                  onClick={() => {
                    setCatalogFilter("all");
                    setSchemaFilter("all");
                    setTagFilter("all");
                    setStatusFilter("all");
                    setMySubmissionsOnly(false);
                  }}
                >
                  Clear filters
                </Button>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading && (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => <Skeleton key={i} className="h-14 w-full" />)}
            </div>
          )}

          {error && (
            <p className="text-destructive text-sm">Failed to load rules: {(error as Error).message}</p>
          )}

          {!isLoading && !error && rules.length > 0 && (
            <FadeIn duration={0.3}>
              <div className="border rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/50">
                      <th className="text-left p-3 font-medium">Table</th>
                      <th className="text-left p-3 font-medium">Tags</th>
                      <th className="text-left p-3 font-medium">Status</th>
                      <th className="text-left p-3 font-medium">Submitted by</th>
                      <th className="text-left p-3 font-medium">Version</th>
                      <th className="text-left p-3 font-medium">Rules</th>
                      <th className="text-left p-3 font-medium">Modified</th>
                      <th className="text-right p-3 font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rules.map((rule) => (
                      <tr
                        key={rule.table_fqn}
                        className="border-b last:border-b-0 hover:bg-muted/30 transition-colors cursor-pointer"
                        onClick={() =>
                          navigate({ to: "/rules/generate", search: { table: rule.table_fqn } })
                        }
                      >
                        <td className="p-3 font-mono text-xs">{rule.table_fqn}</td>
                        <td className="p-3">
                          <div className="flex flex-wrap gap-1 max-w-[200px]">
                            {(tagsMap[rule.table_fqn] || []).slice(0, 3).map((tag) => (
                              <Badge
                                key={tag}
                                variant="outline"
                                className="text-[10px] py-0 px-1.5 font-normal"
                              >
                                {tag}
                              </Badge>
                            ))}
                            {(tagsMap[rule.table_fqn]?.length ?? 0) > 3 && (
                              <Badge variant="secondary" className="text-[10px] py-0 px-1.5 font-normal">
                                +{(tagsMap[rule.table_fqn]?.length ?? 0) - 3}
                              </Badge>
                            )}
                            {!tagsMap[rule.table_fqn]?.length && (
                              <span className="text-xs text-muted-foreground">—</span>
                            )}
                          </div>
                        </td>
                        <td className="p-3">{statusBadge(rule.status)}</td>
                        <td className="p-3 text-xs text-muted-foreground truncate max-w-[180px]" title={rule.updated_by ?? rule.created_by ?? ""}>
                          {rule.updated_by ?? rule.created_by ?? "—"}
                        </td>
                        <td className="p-3 tabular-nums">v{rule.version}</td>
                        <td className="p-3 tabular-nums">{rule.checks.length}</td>
                        <td className="p-3 text-muted-foreground text-xs whitespace-nowrap" title={rule.updated_at ?? rule.created_at ?? ""}>
                          {formatDate(rule.updated_at ?? rule.created_at)}
                        </td>
                        <td className="p-3 text-right">
                          <div
                            className="flex items-center justify-end gap-1"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {rule.status === "draft" && canSubmitRules && (
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={isBusy}
                                onClick={() => handleSubmit(rule.table_fqn, rule.version)}
                                className="gap-1 h-7 text-xs"
                                title="Send this draft rule set for review and approval"
                              >
                                <SendHorizonal className="h-3 w-3 shrink-0" />
                                {pendingAction === rule.table_fqn ? "Submitting..." : "Submit for approval"}
                              </Button>
                            )}
                            {rule.status === "pending_approval" && canApproveRules && (
                              <>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  disabled={isBusy}
                                  onClick={() => handleApprove(rule.table_fqn, rule.version)}
                                  className="gap-1 h-7 text-xs text-green-600"
                                >
                                  <CheckCircle2 className="h-3 w-3" />
                                  {pendingAction === rule.table_fqn ? "Approving..." : "Approve"}
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  disabled={isBusy}
                                  onClick={() => handleReject(rule.table_fqn, rule.version)}
                                  className="gap-1 h-7 text-xs text-red-600"
                                >
                                  <XCircle className="h-3 w-3" />
                                  {pendingAction === rule.table_fqn ? "Rejecting..." : "Reject"}
                                </Button>
                              </>
                            )}
                            {canEditRules && (
                              <Button
                                size="sm"
                                variant="ghost"
                                disabled={isBusy}
                                onClick={() => handleDelete(rule.table_fqn)}
                                className="h-7 text-xs text-destructive"
                              >
                                <Trash2 className="h-3 w-3" />
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </FadeIn>
          )}

          {!isLoading && !error && rules.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-6">
                <ClipboardCheck className="h-8 w-8 text-muted-foreground" />
              </div>
              <h3 className="text-lg font-medium text-muted-foreground">No drafts or pending rules</h3>
              <p className="text-muted-foreground/70 text-sm mt-1 max-w-md">
                {canCreateRules
                  ? "Newly created rules appear here for review before they become active."
                  : "No rules are awaiting review."}
              </p>
              {canCreateRules && (
                <Button onClick={() => navigate({ to: "/rules/create" })} className="mt-4 gap-2">
                  <Plus className="h-4 w-4" />
                  Create rules
                </Button>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
