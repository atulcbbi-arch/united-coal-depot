import {
  Home,
  FilePlus,
  BarChart3,
  Settings,
  Package,
  Wallet
} from "lucide-react";
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

const morePaths = ["/settings", "/reports"];

export function AppShell() {
  const { user } = useAuth();
  const pathname = useLocation().pathname;
  const label = user?.displayName ?? user?.email ?? "Account";

  return (
    <div className="min-h-dvh bg-bg text-fg md:flex">
      <aside className="hidden w-60 shrink-0 flex-col bg-coal text-coal-fg md:flex">
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

      <div className="flex min-h-dvh min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between gap-3 border-b border-border bg-surface px-4 py-3 md:hidden">
          <div>
            <p className="font-display text-base">United Coal Depot</p>
            <p className="text-xs text-muted">1 Sep 2026 onward</p>
          </div>
          <button type="button" onClick={() => void signOutUser()} className="text-sm text-muted underline-offset-2 hover:underline">
            Sign out
          </button>
        </header>
        <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-5 pb-24 md:px-8 md:py-8 md:pb-8">
          <Outlet />
        </main>
        <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-surface/95 pb-[env(safe-area-inset-bottom)] md:hidden">
          <div className="grid grid-cols-5">
            {(
              [
                { to: "/", label: "Home", icon: Home, on: pathname === "/" },
                { to: "/bill", label: "Bill", icon: FilePlus, on: pathname === "/bill" },
                { to: "/purchase", label: "Stock", icon: Package, on: pathname === "/purchase" },
                { to: "/money", label: "Ledger", icon: Wallet, on: pathname === "/money" },
                { to: "/settings", label: "More", icon: Settings, on: morePaths.includes(pathname) },
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
                  <Icon className="size-5" strokeWidth={1.75} />
                  {item.label}
                </NavLink>
              );
            })}
          </div>
        </nav>
      </div>
    </div>
  );
}