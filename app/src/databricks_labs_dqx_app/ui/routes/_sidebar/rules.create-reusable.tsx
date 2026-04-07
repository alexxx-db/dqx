import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, useCallback } from "react";
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
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CatalogBrowser } from "@/components/CatalogBrowser";
import {
  Copy,
  Plus,
  Trash2,
  Save,
  Loader2,
  ArrowLeft,
  AlertCircle,
  Sparkles,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { aiAssistedChecksGeneration } from "@/lib/api";
import { useBatchSaveRules } from "@/lib/api-custom";

export const Route = createFileRoute("/_sidebar/rules/create-reusable")({
  component: CreateReusablePage,
});

const CHECK_FUNCTIONS = [
  { value: "is_not_null", label: "is_not_null", args: ["col_name"] },
  { value: "is_not_empty", label: "is_not_empty", args: ["col_name"] },
  { value: "is_not_null_and_not_empty", label: "is_not_null_and_not_empty", args: ["col_name"] },
  { value: "is_in_list", label: "is_in_list", args: ["col_name", "allowed"] },
  { value: "is_not_in_list", label: "is_not_in_list", args: ["col_name", "not_allowed"] },
  { value: "is_min", label: "is_min", args: ["col_name", "limit"] },
  { value: "is_max", label: "is_max", args: ["col_name", "limit"] },
  { value: "is_in_range", label: "is_in_range", args: ["col_name", "min_limit", "max_limit"] },
  { value: "is_valid_date", label: "is_valid_date", args: ["col_name", "date_format"] },
  { value: "is_valid_timestamp", label: "is_valid_timestamp", args: ["col_name", "timestamp_format"] },
  { value: "is_valid_regex", label: "is_valid_regex", args: ["col_name", "regex"] },
  { value: "is_unique", label: "is_unique", args: ["col_name"] },
  { value: "is_not_negative", label: "is_not_negative", args: ["col_name"] },
  { value: "sql_expression", label: "sql_expression", args: ["expression", "msg"] },
];

interface CheckDraft {
  id: string;
  fn: string;
  args: Record<string, string>;
  criticality: "warn" | "error";
}

function newCheck(): CheckDraft {
  return {
    id: crypto.randomUUID(),
    fn: "",
    args: {},
    criticality: "warn",
  };
}

function checkToDict(c: CheckDraft): Record<string, unknown> {
  const args: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(c.args)) {
    if (!v) continue;
    if (k === "allowed" || k === "not_allowed") {
      args[k] = v.split(",").map((s) => s.trim());
    } else if (k === "limit" || k === "min_limit" || k === "max_limit") {
      args[k] = Number(v) || v;
    } else {
      args[k] = v;
    }
  }
  return { criticality: c.criticality, check: { function: c.fn, arguments: args } };
}

function aiCheckToDraft(raw: Record<string, unknown>): CheckDraft | null {
  const checkObj = (raw.check as Record<string, unknown>) ?? {};
  const fn = String(checkObj.function ?? "");
  if (!fn) return null;
  const rawArgs = (checkObj.arguments as Record<string, unknown>) ?? {};
  const args: Record<string, string> = {};
  for (const [k, v] of Object.entries(rawArgs)) {
    if (Array.isArray(v)) {
      args[k] = v.join(", ");
    } else if (v != null) {
      args[k] = String(v);
    }
  }
  return {
    id: crypto.randomUUID(),
    fn,
    args,
    criticality: (raw.criticality as "warn" | "error") ?? "warn",
  };
}

function CreateReusablePage() {
  const navigate = useNavigate();
  const [checks, setChecks] = useState<CheckDraft[]>([newCheck()]);
  const [selectedTables, setSelectedTables] = useState<string[]>([]);
  const batchSave = useBatchSaveRules();

  const [aiPrompt, setAiPrompt] = useState("");
  const [aiGenerating, setAiGenerating] = useState(false);

  const addCheck = () => setChecks((prev) => [...prev, newCheck()]);

  const removeCheck = (id: string) => {
    setChecks((prev) => (prev.length <= 1 ? prev : prev.filter((c) => c.id !== id)));
  };

  const updateCheck = useCallback((id: string, patch: Partial<CheckDraft>) => {
    setChecks((prev) =>
      prev.map((c) => (c.id === id ? { ...c, ...patch } : c)),
    );
  }, []);

  const handleAiGenerate = async () => {
    if (!aiPrompt.trim()) return;
    setAiGenerating(true);
    try {
      const resp = await aiAssistedChecksGeneration({ user_input: aiPrompt.trim() });
      const generated = resp.data.checks ?? [];
      const drafts = generated
        .map((c) => aiCheckToDraft(c as Record<string, unknown>))
        .filter((d): d is CheckDraft => d !== null);
      if (drafts.length === 0) {
        toast.error("AI did not generate any valid checks. Try a different description.");
        return;
      }
      const hasOnlyEmptyDefault = checks.length === 1 && checks[0].fn === "";
      setChecks(hasOnlyEmptyDefault ? drafts : [...checks, ...drafts]);
      toast.success(`${drafts.length} check${drafts.length > 1 ? "s" : ""} generated by AI`);
      setAiPrompt("");
    } catch {
      toast.error("AI generation failed. Please try again.");
    } finally {
      setAiGenerating(false);
    }
  };

  const isValid =
    selectedTables.length > 0 &&
    checks.length > 0 &&
    checks.every((c) => c.fn !== "");

  const handleSave = async () => {
    const checkDicts = checks.map(checkToDict);
    try {
      const resp = await batchSave.mutateAsync({
        data: { table_fqns: selectedTables, checks: checkDicts },
      });
      const { saved, failed } = resp.data;
      if (saved.length > 0) {
        toast.success(`Rules saved for ${saved.length} table${saved.length > 1 ? "s" : ""}`);
      }
      if (failed.length > 0) {
        toast.error(`Failed for ${failed.length} table${failed.length > 1 ? "s" : ""}: ${failed[0].error}`);
      }
      if (saved.length > 0 && failed.length === 0) {
        navigate({ to: "/rules/drafts" });
      }
    } catch {
      toast.error("Failed to save rules");
    }
  };

  const removeTable = (fqn: string) => {
    setSelectedTables((prev) => prev.filter((t) => t !== fqn));
  };

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <PageBreadcrumb
          items={[
            { label: "Rules", to: "/rules/active" },
            { label: "Create rules", to: "/rules/create" },
          ]}
          page="Reusable rules"
        />
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate({ to: "/rules/create" })}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Reusable rules</h1>
            <p className="text-muted-foreground">
              Define checks once and apply them to multiple tables across any schema.
            </p>
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Left: Define checks */}
        <div className="space-y-4">
          {/* AI generation */}
          <Card className="border-primary/20">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Sparkles className="h-4 w-4 text-primary" />
                Generate with AI
              </CardTitle>
              <CardDescription>
                Describe your data quality requirements and AI will generate checks.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex gap-2">
                <Textarea
                  value={aiPrompt}
                  onChange={(e) => setAiPrompt(e.target.value)}
                  placeholder="e.g. All ID columns must not be null, email must be valid format, amounts must be positive"
                  className="min-h-[60px] resize-none text-sm"
                  disabled={aiGenerating}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      handleAiGenerate();
                    }
                  }}
                />
                <Button
                  onClick={handleAiGenerate}
                  disabled={aiGenerating || !aiPrompt.trim()}
                  className="shrink-0 gap-1.5"
                  size="sm"
                >
                  {aiGenerating ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Sparkles className="h-3.5 w-3.5" />
                  )}
                  {aiGenerating ? "Generating..." : "Generate"}
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Manual checks */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Copy className="h-4 w-4" />
                Checks ({checks.length})
              </CardTitle>
              <CardDescription>
                Define manually or edit AI-generated checks. These will be applied as drafts to every selected table.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {checks.map((check, idx) => (
                <CheckRow
                  key={check.id}
                  check={check}
                  index={idx}
                  onUpdate={updateCheck}
                  onRemove={removeCheck}
                  canRemove={checks.length > 1}
                />
              ))}
              <Button variant="outline" size="sm" onClick={addCheck} className="gap-1">
                <Plus className="h-3 w-3" />
                Add check
              </Button>
            </CardContent>
          </Card>
        </div>

        {/* Right: Select tables */}
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Target tables</CardTitle>
              <CardDescription>
                Browse catalogs and schemas to select tables. Selections persist when you switch schemas.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <CatalogBrowser
                onChange={() => {}}
                multiSelect
                selectedTables={selectedTables}
                onMultiChange={setSelectedTables}
              />
            </CardContent>
          </Card>

          {selectedTables.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">
                  {selectedTables.length} table{selectedTables.length > 1 ? "s" : ""} selected
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-1.5 max-h-[300px] overflow-y-auto">
                  {selectedTables.map((t) => (
                    <Badge
                      key={t}
                      variant="secondary"
                      className="text-xs font-mono gap-1 pr-1"
                    >
                      {t}
                      <button
                        type="button"
                        onClick={() => removeTable(t)}
                        className="ml-0.5 rounded-full p-0.5 hover:bg-destructive/20 hover:text-destructive transition-colors"
                      >
                        <X className="h-2.5 w-2.5" />
                      </button>
                    </Badge>
                  ))}
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="mt-2 h-7 text-xs text-destructive"
                  onClick={() => setSelectedTables([])}
                >
                  Clear all
                </Button>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* Summary + Save */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3 text-sm text-muted-foreground">
              {!isValid && (
                <>
                  <AlertCircle className="h-4 w-4 text-amber-500" />
                  {checks.every((c) => c.fn !== "")
                    ? "Select at least one target table"
                    : "Define at least one check with a function"}
                </>
              )}
              {isValid && (
                <span>
                  {checks.length} check{checks.length > 1 ? "s" : ""} &rarr;{" "}
                  {selectedTables.length} table{selectedTables.length > 1 ? "s" : ""} ={" "}
                  <strong>{checks.length * selectedTables.length}</strong> draft rules
                </span>
              )}
            </div>
            <Button
              onClick={handleSave}
              disabled={!isValid || batchSave.isPending}
              className="gap-2"
            >
              {batchSave.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              {batchSave.isPending ? "Saving..." : "Save as drafts"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ── Check row editor ────────────────────────────────────────────────────────

interface CheckRowProps {
  check: CheckDraft;
  index: number;
  onUpdate: (id: string, patch: Partial<CheckDraft>) => void;
  onRemove: (id: string) => void;
  canRemove: boolean;
}

function CheckRow({ check, index, onUpdate, onRemove, canRemove }: CheckRowProps) {
  const fnDef = CHECK_FUNCTIONS.find((f) => f.value === check.fn);
  const argFields = fnDef?.args ?? [];
  const isUnknownFn = check.fn !== "" && !fnDef;

  return (
    <div className="border rounded-lg p-4 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">Check {index + 1}</span>
        {canRemove && (
          <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-destructive" onClick={() => onRemove(check.id)}>
            <Trash2 className="h-3 w-3" />
          </Button>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label className="text-xs">Function</Label>
          <Select value={check.fn} onValueChange={(fn) => onUpdate(check.id, { fn, args: {} })}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue placeholder="Select function" />
            </SelectTrigger>
            <SelectContent>
              {CHECK_FUNCTIONS.map((f) => (
                <SelectItem key={f.value} value={f.value} className="text-xs">
                  {f.label}
                </SelectItem>
              ))}
              {isUnknownFn && (
                <SelectItem value={check.fn} className="text-xs">
                  {check.fn} (custom)
                </SelectItem>
              )}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Criticality</Label>
          <Select
            value={check.criticality}
            onValueChange={(v) => onUpdate(check.id, { criticality: v as "warn" | "error" })}
          >
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="warn" className="text-xs">warn</SelectItem>
              <SelectItem value="error" className="text-xs">error</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Show known args for known functions, or raw args for AI-generated/custom */}
      {argFields.length > 0 && (
        <div className="grid gap-2 sm:grid-cols-2">
          {argFields.map((arg) => (
            <div key={arg} className="space-y-1">
              <Label className="text-[11px] text-muted-foreground">{arg}</Label>
              <Input
                className="h-7 text-xs"
                placeholder={argHint(arg)}
                value={check.args[arg] ?? ""}
                onChange={(e) =>
                  onUpdate(check.id, { args: { ...check.args, [arg]: e.target.value } })
                }
              />
            </div>
          ))}
        </div>
      )}
      {isUnknownFn && Object.keys(check.args).length > 0 && (
        <div className="grid gap-2 sm:grid-cols-2">
          {Object.entries(check.args).map(([key, val]) => (
            <div key={key} className="space-y-1">
              <Label className="text-[11px] text-muted-foreground">{key}</Label>
              <Input
                className="h-7 text-xs"
                value={val}
                onChange={(e) =>
                  onUpdate(check.id, { args: { ...check.args, [key]: e.target.value } })
                }
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function argHint(arg: string): string {
  switch (arg) {
    case "col_name": return "e.g. id";
    case "allowed": return "comma-separated, e.g. A,B,C";
    case "not_allowed": return "comma-separated";
    case "limit": return "numeric value";
    case "min_limit": return "min value";
    case "max_limit": return "max value";
    case "regex": return "e.g. ^[A-Z]+$";
    case "date_format": return "e.g. yyyy-MM-dd";
    case "timestamp_format": return "e.g. yyyy-MM-dd HH:mm:ss";
    case "expression": return "SQL expression, e.g. col > 0";
    case "msg": return "Error message";
    default: return arg;
  }
}
