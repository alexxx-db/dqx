import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { PageBreadcrumb } from "@/components/apx/PageBreadcrumb";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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
import {
  Database,
  Save,
  Loader2,
  ArrowLeft,
  AlertCircle,
  Plus,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { useSaveRules } from "@/lib/api";

export const Route = createFileRoute("/_sidebar/rules/create-sql")({
  component: CreateSqlCheckPage,
});

const SQL_CHECK_PREFIX = "__sql_check__/";

interface SqlCheckDraft {
  id: string;
  name: string;
  query: string;
  criticality: "warn" | "error";
}

function newSqlCheck(): SqlCheckDraft {
  return {
    id: crypto.randomUUID(),
    name: "",
    query: "",
    criticality: "warn",
  };
}

function CreateSqlCheckPage() {
  const navigate = useNavigate();
  const [checks, setChecks] = useState<SqlCheckDraft[]>([newSqlCheck()]);
  const saveMutation = useSaveRules();

  const addCheck = () => setChecks((prev) => [...prev, newSqlCheck()]);

  const removeCheck = (id: string) => {
    setChecks((prev) => (prev.length <= 1 ? prev : prev.filter((c) => c.id !== id)));
  };

  const updateCheck = (id: string, patch: Partial<SqlCheckDraft>) => {
    setChecks((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  };

  const isValid = checks.every((c) => c.name.trim() !== "" && c.query.trim() !== "");

  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    let successCount = 0;
    let failCount = 0;

    for (const check of checks) {
      const tableFqn = `${SQL_CHECK_PREFIX}${check.name.trim().replace(/\s+/g, "_").toLowerCase()}`;
      const checkPayload = [
        {
          name: check.name.trim(),
          criticality: check.criticality,
          check: {
            function: "sql_query",
            arguments: {
              query: check.query.trim(),
            },
          },
        },
      ];
      try {
        await saveMutation.mutateAsync({
          data: { table_fqn: tableFqn, checks: checkPayload },
        });
        successCount++;
      } catch {
        failCount++;
      }
    }

    setSaving(false);

    if (successCount > 0) {
      toast.success(`${successCount} SQL check${successCount > 1 ? "s" : ""} saved as draft`);
    }
    if (failCount > 0) {
      toast.error(`${failCount} check${failCount > 1 ? "s" : ""} failed to save`);
    }
    if (successCount > 0 && failCount === 0) {
      navigate({ to: "/rules/drafts" });
    }
  };

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <PageBreadcrumb
          items={[
            { label: "Rules", to: "/rules/active" },
            { label: "Create rules", to: "/rules/create" },
          ]}
          page="SQL checks"
        />
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate({ to: "/rules/create" })}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Cross-table SQL checks</h1>
            <p className="text-muted-foreground">
              Write SQL queries that validate data across tables or run dataset-level aggregation checks.
            </p>
          </div>
        </div>
      </div>

      <div className="space-y-4">
        {checks.map((check, idx) => (
          <Card key={check.id}>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Database className="h-4 w-4" />
                  SQL check {checks.length > 1 ? `#${idx + 1}` : ""}
                </CardTitle>
                {checks.length > 1 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0 text-destructive"
                    onClick={() => removeCheck(check.id)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
              <CardDescription>
                The query should return rows that violate the check (i.e., bad rows).
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor={`name-${check.id}`}>Name</Label>
                  <Input
                    id={`name-${check.id}`}
                    placeholder="e.g. orders_total_matches_line_items"
                    value={check.name}
                    onChange={(e) => updateCheck(check.id, { name: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Criticality</Label>
                  <Select
                    value={check.criticality}
                    onValueChange={(v) =>
                      updateCheck(check.id, { criticality: v as "warn" | "error" })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="warn">warn</SelectItem>
                      <SelectItem value="error">error</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor={`query-${check.id}`}>SQL query</Label>
                <Textarea
                  id={`query-${check.id}`}
                  className="font-mono text-sm min-h-[140px]"
                  placeholder={`SELECT o.order_id, o.total, SUM(li.amount) AS line_total\nFROM catalog.schema.orders o\nJOIN catalog.schema.line_items li ON li.order_id = o.order_id\nGROUP BY o.order_id, o.total\nHAVING o.total != line_total`}
                  value={check.query}
                  onChange={(e) => updateCheck(check.id, { query: e.target.value })}
                />
                <p className="text-xs text-muted-foreground">
                  Use fully qualified table names (catalog.schema.table). Returned rows are treated as violations.
                </p>
              </div>
            </CardContent>
          </Card>
        ))}

        <Button variant="outline" size="sm" onClick={addCheck} className="gap-1">
          <Plus className="h-3 w-3" />
          Add another SQL check
        </Button>
      </div>

      {/* Save bar */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3 text-sm text-muted-foreground">
              {!isValid && (
                <>
                  <AlertCircle className="h-4 w-4 text-amber-500" />
                  Every check needs a name and a SQL query
                </>
              )}
              {isValid && (
                <span>{checks.length} SQL check{checks.length > 1 ? "s" : ""} ready to save</span>
              )}
            </div>
            <Button
              onClick={handleSave}
              disabled={!isValid || saving}
              className="gap-2"
            >
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              {saving ? "Saving..." : "Save as drafts"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
