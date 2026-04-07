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
  ShieldCheck,
  Plus,
  Tag,
  ChevronDown,
  ChevronRight,
  Database,
} from "lucide-react";
import { FadeIn } from "@/components/anim/FadeIn";
import {
  useListRules,
  getTableTags,
  type RuleCatalogEntryOut,
} from "@/lib/api";
import { usePermissions } from "@/hooks/use-permissions";

export const Route = createFileRoute("/_sidebar/rules/active")({
  component: () => (
    <Suspense fallback={<ActiveRulesSkeleton />}>
      <ActiveRulesPage />
    </Suspense>
  ),
});

function ActiveRulesSkeleton() {
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

function parseFqn(fqn: string) {
  const parts = fqn.split(".");
  return { catalog: parts[0] || "", schema: parts[1] || "", table: parts[2] || "" };
}

type ViewMode = "by-table" | "by-rule" | "sql-checks";

function ActiveRulesPage() {
  const navigate = useNavigate();
  const [viewMode, setViewMode] = useState<ViewMode>("by-table");
  const [catalogFilter, setCatalogFilter] = useState("all");
  const [schemaFilter, setSchemaFilter] = useState("all");
  const [tagFilter, setTagFilter] = useState("all");
  const [expandedTables, setExpandedTables] = useState<Set<string>>(new Set());

  const { canCreateRules } = usePermissions();

  const { data: rulesResp, isLoading, error } = useListRules({ status: "approved" });
  const allRules: RuleCatalogEntryOut[] = Array.isArray(rulesResp?.data) ? rulesResp.data : [];

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

  const filteredRules = useMemo(() => {
    return allRules.filter((rule) => {
      const { catalog, schema } = parseFqn(rule.table_fqn);
      if (catalogFilter !== "all" && catalog !== catalogFilter) return false;
      if (schemaFilter !== "all" && schema !== schemaFilter) return false;
      if (tagFilter !== "all") {
        const ruleTags = tagsMap[rule.table_fqn] || [];
        if (!ruleTags.includes(tagFilter)) return false;
      }
      return true;
    });
  }, [allRules, catalogFilter, schemaFilter, tagFilter, tagsMap]);

  const availableSchemas = catalogFilter !== "all" ? schemasByCatalog[catalogFilter] || [] : [];

  const handleCatalogChange = (value: string) => {
    setCatalogFilter(value);
    setSchemaFilter("all");
  };

  const toggleTable = (fqn: string) => {
    setExpandedTables((prev) => {
      const next = new Set(prev);
      next.has(fqn) ? next.delete(fqn) : next.add(fqn);
      return next;
    });
  };

  const allChecks = useMemo(() => {
    return filteredRules.flatMap((rule) =>
      rule.checks.map((check) => ({ ...check, _tableFqn: rule.table_fqn, _version: rule.version })),
    );
  }, [filteredRules]);

  const totalCheckCount = allRules.reduce((sum, r) => sum + r.checks.length, 0);

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <PageBreadcrumb items={[{ label: "Rules", to: "/rules/active" }]} page="Active rules" />
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Active rules</h1>
            <p className="text-muted-foreground">
              Approved rules currently enforced on your tables.
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
                  <ShieldCheck className="h-5 w-5" />
                  Approved rule sets
                </CardTitle>
                <CardDescription>
                  {isLoading
                    ? "Loading..."
                    : `${filteredRules.length} table${filteredRules.length !== 1 ? "s" : ""} · ${totalCheckCount} total checks`}
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

              {(catalogFilter !== "all" || schemaFilter !== "all" || tagFilter !== "all") && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-9 text-xs"
                  onClick={() => { setCatalogFilter("all"); setSchemaFilter("all"); setTagFilter("all"); }}
                >
                  Clear filters
                </Button>
              )}

              <div className="ml-auto flex items-center gap-1 border rounded-md p-0.5">
                {(
                  [
                    { key: "by-table", label: "By table" },
                    { key: "by-rule", label: "By rule" },
                    { key: "sql-checks", label: "SQL checks" },
                  ] as const
                ).map((mode) => (
                  <button
                    key={mode.key}
                    type="button"
                    onClick={() => setViewMode(mode.key)}
                    className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${
                      viewMode === mode.key
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:bg-muted"
                    }`}
                  >
                    {mode.label}
                  </button>
                ))}
              </div>
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

          {!isLoading && !error && filteredRules.length > 0 && (
            <FadeIn duration={0.3}>
              {viewMode === "by-table" && (
                <ByTableView
                  rules={filteredRules}
                  tagsMap={tagsMap}
                  expandedTables={expandedTables}
                  onToggle={toggleTable}
                  onNavigate={(fqn) => navigate({ to: "/rules/generate", search: { table: fqn } })}
                />
              )}
              {viewMode === "by-rule" && (
                <ByRuleView checks={allChecks} />
              )}
              {viewMode === "sql-checks" && (
                <SqlChecksView checks={allChecks} />
              )}
            </FadeIn>
          )}

          {!isLoading && !error && filteredRules.length === 0 && (
            <EmptyState canCreate={canCreateRules} onNavigate={() => navigate({ to: "/rules/create" })} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ── By table view: collapsible per-table groups ─────────────────────────────

interface ByTableViewProps {
  rules: RuleCatalogEntryOut[];
  tagsMap: Record<string, string[]>;
  expandedTables: Set<string>;
  onToggle: (fqn: string) => void;
  onNavigate: (fqn: string) => void;
}

function ByTableView({ rules, tagsMap, expandedTables, onToggle, onNavigate }: ByTableViewProps) {
  return (
    <div className="space-y-2">
      {rules.map((rule) => {
        const isOpen = expandedTables.has(rule.table_fqn);
        return (
          <div key={rule.table_fqn} className="border rounded-lg overflow-hidden">
            <button
              type="button"
              className="w-full flex items-center gap-3 p-3 text-sm hover:bg-muted/30 transition-colors text-left"
              onClick={() => onToggle(rule.table_fqn)}
            >
              {isOpen ? (
                <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
              ) : (
                <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
              )}
              <code className="font-mono text-xs font-medium flex-1">{rule.table_fqn}</code>
              <div className="flex items-center gap-2">
                {(tagsMap[rule.table_fqn] || []).slice(0, 2).map((tag) => (
                  <Badge key={tag} variant="outline" className="text-[10px] py-0 px-1.5 font-normal">
                    {tag}
                  </Badge>
                ))}
                <span className="text-xs text-muted-foreground">
                  {rule.checks.length} rule{rule.checks.length !== 1 ? "s" : ""} · v{rule.version}
                </span>
              </div>
            </button>
            {isOpen && (
              <div className="border-t">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-muted/30">
                      <th className="text-left p-2 px-4 font-medium text-xs text-muted-foreground">Function</th>
                      <th className="text-left p-2 px-4 font-medium text-xs text-muted-foreground">Column(s)</th>
                      <th className="text-left p-2 px-4 font-medium text-xs text-muted-foreground">Criticality</th>
                      <th className="text-left p-2 px-4 font-medium text-xs text-muted-foreground">Source</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rule.checks.map((check, idx) => {
                      const c = check as Record<string, unknown>;
                      const checkObj = (c.check as Record<string, unknown>) ?? {};
                      const args = (checkObj.arguments as Record<string, unknown>) ?? {};
                      const fn = String(checkObj.function ?? "—");
                      const col = String(args.column ?? checkObj.for_each_column ?? "—");
                      const criticality = String(c.criticality ?? "warn");
                      const isSqlQuery = fn === "sql_query";
                      return (
                        <tr key={idx} className="border-t border-border/50 hover:bg-muted/20">
                          <td className="p-2 px-4 font-mono text-xs">{fn}</td>
                          <td className="p-2 px-4 text-xs text-muted-foreground">{col}</td>
                          <td className="p-2 px-4">
                            <Badge
                              variant="outline"
                              className={`text-[10px] ${criticality === "error" ? "border-red-500 text-red-600" : "border-amber-500 text-amber-600"}`}
                            >
                              {criticality}
                            </Badge>
                          </td>
                          <td className="p-2 px-4">
                            <Badge variant="secondary" className="text-[10px]">
                              {isSqlQuery ? "SQL" : "Single"}
                            </Badge>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <div className="border-t p-2 px-4 flex justify-end">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => onNavigate(rule.table_fqn)}
                  >
                    View / edit rules
                  </Button>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── By rule view: flat list of all checks across tables ─────────────────────

interface CheckWithMeta {
  _tableFqn: string;
  _version: number;
  [key: string]: unknown;
}

function ByRuleView({ checks }: { checks: CheckWithMeta[] }) {
  const nonSqlChecks = checks.filter((c) => {
    const checkObj = (c.check as Record<string, unknown>) ?? {};
    return String(checkObj.function ?? "") !== "sql_query";
  });

  if (nonSqlChecks.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground text-sm">
        No column / dataset rules found. Switch to "SQL checks" to view query-based rules.
      </div>
    );
  }

  return (
    <div className="border rounded-lg overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-muted/50">
            <th className="text-left p-3 font-medium">Function</th>
            <th className="text-left p-3 font-medium">Column(s)</th>
            <th className="text-left p-3 font-medium">Table</th>
            <th className="text-left p-3 font-medium">Criticality</th>
          </tr>
        </thead>
        <tbody>
          {nonSqlChecks.map((check, idx) => {
            const checkObj = (check.check as Record<string, unknown>) ?? {};
            const args = (checkObj.arguments as Record<string, unknown>) ?? {};
            const fn = String(checkObj.function ?? "—");
            const col = String(args.column ?? checkObj.for_each_column ?? "—");
            const criticality = String(check.criticality ?? "warn");
            return (
              <tr key={idx} className="border-b last:border-b-0 hover:bg-muted/30">
                <td className="p-3 font-mono text-xs">{fn}</td>
                <td className="p-3 text-xs text-muted-foreground">{col}</td>
                <td className="p-3 font-mono text-xs">{check._tableFqn}</td>
                <td className="p-3">
                  <Badge
                    variant="outline"
                    className={`text-[10px] ${criticality === "error" ? "border-red-500 text-red-600" : "border-amber-500 text-amber-600"}`}
                  >
                    {criticality}
                  </Badge>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── SQL checks view ─────────────────────────────────────────────────────────

function SqlChecksView({ checks }: { checks: CheckWithMeta[] }) {
  const sqlChecks = checks.filter((c) => {
    const checkObj = (c.check as Record<string, unknown>) ?? {};
    return String(checkObj.function ?? "") === "sql_query";
  });

  if (sqlChecks.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <Database className="h-10 w-10 mx-auto mb-3 opacity-40" />
        <p className="text-sm font-medium">No SQL checks</p>
        <p className="text-xs mt-1">SQL query-based dataset checks will appear here once created and approved.</p>
      </div>
    );
  }

  return (
    <div className="border rounded-lg overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-muted/50">
            <th className="text-left p-3 font-medium">Name</th>
            <th className="text-left p-3 font-medium">Mode</th>
            <th className="text-left p-3 font-medium">Table</th>
            <th className="text-left p-3 font-medium">Criticality</th>
          </tr>
        </thead>
        <tbody>
          {sqlChecks.map((check, idx) => {
            const checkObj = (check.check as Record<string, unknown>) ?? {};
            const args = (checkObj.arguments as Record<string, unknown>) ?? {};
            const name = String(check.name ?? args.name ?? "sql_query");
            const mergeColumns = args.merge_columns as string[] | undefined;
            const mode = mergeColumns && mergeColumns.length > 0 ? "Row-level" : "Dataset-level";
            const criticality = String(check.criticality ?? "warn");
            return (
              <tr key={idx} className="border-b last:border-b-0 hover:bg-muted/30">
                <td className="p-3 font-mono text-xs">{name}</td>
                <td className="p-3">
                  <Badge variant="secondary" className="text-[10px]">{mode}</Badge>
                </td>
                <td className="p-3 font-mono text-xs">{check._tableFqn}</td>
                <td className="p-3">
                  <Badge
                    variant="outline"
                    className={`text-[10px] ${criticality === "error" ? "border-red-500 text-red-600" : "border-amber-500 text-amber-600"}`}
                  >
                    {criticality}
                  </Badge>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── Empty state ─────────────────────────────────────────────────────────────

function EmptyState({ canCreate, onNavigate }: { canCreate: boolean; onNavigate: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-6">
        <ShieldCheck className="h-8 w-8 text-muted-foreground" />
      </div>
      <h3 className="text-lg font-medium text-muted-foreground">No active rules</h3>
      <p className="text-muted-foreground/70 text-sm mt-1 max-w-md">
        {canCreate
          ? "Create and approve rules to see them here. Active rules are enforced during quality runs."
          : "No rules have been approved yet. Check Drafts & review for pending rule sets."}
      </p>
      {canCreate && (
        <Button onClick={onNavigate} className="mt-4 gap-2">
          <Plus className="h-4 w-4" />
          Create rules
        </Button>
      )}
    </div>
  );
}
