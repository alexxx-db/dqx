import SidebarLayout from "@/components/apx/SidebarLayout";
import { createFileRoute, Link, useLocation } from "@tanstack/react-router";
import { useState } from "react";
import { cn } from "@/lib/utils";
import {
  BookCheck,
  Search,
  BarChart3,
  PlayCircle,
  ShieldCheck,
  PenLine,
  ClipboardCheck,
  ChevronDown,
} from "lucide-react";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubItem,
  SidebarMenuSubButton,
} from "@/components/ui/sidebar";

export const Route = createFileRoute("/_sidebar")({
  component: () => <Layout />,
});

function Layout() {
  const location = useLocation();
  const rulesExpanded = location.pathname.startsWith("/rules") || location.pathname.startsWith("/runs");
  const [rulesOpen, setRulesOpen] = useState(rulesExpanded);

  const rulesChildren = [
    {
      to: "/rules/active",
      label: "Active rules",
      icon: <ShieldCheck size={14} />,
      match: (path: string) => path === "/rules/active" || path === "/rules",
    },
    {
      to: "/rules/create",
      label: "Create rules",
      icon: <PenLine size={14} />,
      match: (path: string) => path.startsWith("/rules/create") || path.startsWith("/rules/generate"),
    },
    {
      to: "/rules/drafts",
      label: "Drafts & review",
      icon: <ClipboardCheck size={14} />,
      match: (path: string) => path === "/rules/drafts",
    },
    {
      to: "/runs",
      label: "Runs",
      icon: <PlayCircle size={14} />,
      match: (path: string) => path.startsWith("/runs"),
    },
  ];

  const isRulesActive = location.pathname.startsWith("/rules") || location.pathname.startsWith("/runs");

  return (
    <SidebarLayout>
      <SidebarGroup>
        <SidebarGroupContent>
          <SidebarMenu>
            {/* Rules — expandable section */}
            <SidebarMenuItem>
              <button
                type="button"
                onClick={() => setRulesOpen((prev) => !prev)}
                className={cn(
                  "flex w-full items-center gap-2 p-2 rounded-lg text-sm font-medium transition-colors",
                  isRulesActive
                    ? "text-sidebar-accent-foreground"
                    : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                )}
              >
                <BookCheck size={16} />
                <span className="flex-1 text-left">Rules</span>
                <ChevronDown
                  size={14}
                  className={cn(
                    "text-muted-foreground transition-transform duration-200",
                    rulesOpen && "rotate-180",
                  )}
                />
              </button>
              {rulesOpen && (
                <SidebarMenuSub>
                  {rulesChildren.map((child) => (
                    <SidebarMenuSubItem key={child.to}>
                      <SidebarMenuSubButton
                        asChild
                        isActive={child.match(location.pathname)}
                      >
                        <Link to={child.to} className="flex items-center gap-2">
                          {child.icon}
                          <span>{child.label}</span>
                        </Link>
                      </SidebarMenuSubButton>
                    </SidebarMenuSubItem>
                  ))}
                </SidebarMenuSub>
              )}
            </SidebarMenuItem>

            {/* Profiler */}
            <SidebarMenuItem>
              <Link
                to="/profiler"
                className={cn(
                  "flex items-center gap-2 p-2 rounded-lg",
                  location.pathname.startsWith("/profiler")
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                )}
              >
                <BarChart3 size={16} />
                <span>Profiler</span>
              </Link>
            </SidebarMenuItem>

            {/* Discovery */}
            <SidebarMenuItem>
              <Link
                to="/discovery"
                className={cn(
                  "flex items-center gap-2 p-2 rounded-lg",
                  location.pathname.startsWith("/discovery")
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                )}
              >
                <Search size={16} />
                <span>Discovery</span>
              </Link>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>
    </SidebarLayout>
  );
}
