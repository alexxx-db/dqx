import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { PageBreadcrumb } from "@/components/apx/PageBreadcrumb";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Table2, Copy, Database } from "lucide-react";

export const Route = createFileRoute("/_sidebar/rules/create")({
  component: CreateRulesPage,
});

const SCENARIOS = [
  {
    id: "single",
    title: "Single-table rules",
    description:
      "Generate or hand-write checks scoped to one table. Use AI to suggest rules based on column profiling, then refine them.",
    icon: Table2,
    to: "/rules/generate",
  },
  {
    id: "reusable",
    title: "Reusable rules",
    description:
      "Define a rule once and apply it to every table that contains the target column(s). Ideal for org-wide standards like not-null on IDs.",
    icon: Copy,
    to: "/rules/create-reusable",
  },
  {
    id: "sql",
    title: "Cross-table SQL checks",
    description:
      "Write free-form SQL queries that validate data across multiple tables or run dataset-level aggregation checks.",
    icon: Database,
    to: "/rules/create-sql",
  },
];

function CreateRulesPage() {
  const navigate = useNavigate();

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <PageBreadcrumb items={[{ label: "Rules", to: "/rules/active" }]} page="Create rules" />
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Create rules</h1>
          <p className="text-muted-foreground">
            Choose how you want to define data quality rules.
          </p>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        {SCENARIOS.map((scenario) => {
          const Icon = scenario.icon;
          return (
            <Card
              key={scenario.id}
              className="relative cursor-pointer transition-all hover:border-primary hover:shadow-md"
              onClick={() => navigate({ to: scenario.to as string })}
            >
              <CardHeader className="pt-8 pb-6">
                <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center mb-3">
                  <Icon className="h-6 w-6 text-primary" />
                </div>
                <CardTitle className="text-base">{scenario.title}</CardTitle>
                <CardDescription className="text-sm leading-relaxed">
                  {scenario.description}
                </CardDescription>
              </CardHeader>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
