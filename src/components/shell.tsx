import {
  Home,
  FilePlus,
  BarChart3,
  Settings,
  Package,
  Wallet,
  MoreHorizontal,
  LogOut
} from "lucide-react";
import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { signOutUser, useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";

const desktopNav = [
  { to: "/", label: "Today", icon: Home },
  { to: "/bill", label: "Create Bill", icon: FilePlus },
  { to: "/purchase", label: "Add Stock", icon: Package },
  { to: "/money", label: "Ledger Entry", icon: Wallet },
  { to: "/reports", label: "Reports", icon: BarChart3 },
  { to: "/settings", label: "Settings", icon: Settings },
] as const;

// Pages that live behind the mobile "More" button.
const morePaths = ["/settings", "/purchase"];

export function AppShell() {
  const { user } = useAuth();
  const pathname = useLocation().pathname;
  const label = user?.displayName ?? user?.email ?? "Account";
  const [moreOpen, setMoreOpen] = useState(false);
  useEffect(() => { setMoreOpen(false); }, [pathname]);

  return (
    <div className="min-h-dvh bg-bg text-fg md:flex print:block print:min-h-0 print:bg-white">
      <aside className="hidden w-60 shrink-0 flex-col bg-coal text-coal-fg md:flex print:hidden">
        <div className="px-5 pt-6 pb-4">
          <p className="font-display text-lg leading-tight">United Coal Depot</p>
          <p className="mt-1 text-xs text-coal-fg/60">Books from 1 Sep 2026</p>
        </div>
        <nav className="flex flex-1 flex-col gap-0.5 px-3 pb-4">
          {desktopNav.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === "/"}
                className={({ isActive }) =>
                  cn(
                    "flex h-10 items-center gap-2.5 rounded-[var(--radius-sm)] px-3 text-sm font-medium",
                    isActive ? "bg-coal-fg/12 text-coal-fg" : "text-coal-fg/70 hover:bg-coal-fg/8",
                  )
                }
              >
                <Icon className="size-4" strokeWidth={1.75} />
                {item.label}
              </NavLink>
            );
          })}
        </nav>
        <div className="flex items-center justify-between gap-2 border-t border-coal-fg/10 px-4 py-3">
          <span className="truncate text-xs text-coal-fg/70">{label}</span>
          <button type="button" onClick={() => void signOutUser()} className="text-xs underline-offset-2 hover:underline">
            Sign out
          </button>
        </div>
      </aside>

      <div className="flex min-h-dvh min-w-0 flex-1 flex-col print:block print:min-h-0">
        <header className="flex items-center justify-between gap-3 border-b border-border bg-surface px-4 py-3 md:hidden print:hidden">
          <div>
            <p className="font-display text-base">United Coal Depot</p>
            <p className="text-xs text-muted">1 Sep 2026 onward</p>
          </div>
          <button type="button" onClick={() => void signOutUser()} className="text-sm text-muted underline-offset-2 hover:underline">
            Sign out
          </button>
        </header>
        <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-5 pb-24 md:px-8 md:py-8 md:pb-8 print:max-w-none print:p-0">
          <Outlet />
        </main>
        {moreOpen && (
          <div className="fixed inset-0 z-20 md:hidden print:hidden" onClick={() => setMoreOpen(false)}>
            <div
              className="absolute right-2 bottom-[calc(4rem+env(safe-area-inset-bottom))] w-56 overflow-hidden rounded-[var(--radius-md)] border border-border bg-card shadow-lg"
              onClick={(e) => e.stopPropagation()}
            >
              {(
                [
                  { to: "/purchase", label: "Add Stock (Purchase)", icon: Package },
                  { to: "/settings", label: "Settings", icon: Settings },
                ] as const
              ).map((item) => {
                const Icon = item.icon;
                return (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    onClick={() => setMoreOpen(false)}
                    className={cn("flex h-12 items-center gap-3 border-b border-border px-4 text-[15px] font-medium", pathname === item.to ? "text-primary bg-primary/10" : "text-fg")}
                  >
                    <Icon className="size-5" strokeWidth={1.75} />
                    {item.label}
                  </NavLink>
                );
              })}
              <button type="button" onClick={() => void signOutUser()} className="flex h-12 w-full items-center gap-3 px-4 text-[15px] font-medium text-danger">
                <LogOut className="size-5" strokeWidth={1.75} />
                Sign out
              </button>
            </div>
          </div>
        )}
        <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface/95 pb-[env(safe-area-inset-bottom)] md:hidden print:hidden">
          <div className="grid grid-cols-5">
            {(
              [
                { to: "/", label: "Home", icon: Home, on: pathname === "/" },
                { to: "/bill", label: "Bill", icon: FilePlus, on: pathname === "/bill" },
                { to: "/money", label: "Entry", icon: Wallet, on: pathname === "/money" },
                { to: "/reports", label: "Reports", icon: BarChart3, on: pathname === "/reports" },
              ] as const
            ).map((item) => {
              const Icon = item.icon;
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={cn(
                    "flex min-h-14 flex-col items-center justify-center gap-0.5 text-[11px] font-medium",
                    item.on ? "text-primary" : "text-muted",
                  )}
                >
                  <Icon className="size-5" strokeWidth={item.on ? 2.25 : 1.75} />
                  {item.label}
                </NavLink>
              );
            })}
            <button
              type="button"
              aria-expanded={moreOpen}
              onClick={() => setMoreOpen((v) => !v)}
              className={cn(
                "flex min-h-14 flex-col items-center justify-center gap-0.5 text-[11px] font-medium",
                moreOpen || morePaths.includes(pathname) ? "text-primary" : "text-muted",
              )}
            >
              <MoreHorizontal className="size-5" strokeWidth={1.75} />
              More
            </button>
          </div>
        </nav>
      </div>
    </div>
  );
}