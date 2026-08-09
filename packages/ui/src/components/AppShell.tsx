"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import {
  LayoutDashboard, ScanBarcode, ReceiptText, Stethoscope, Boxes, Hourglass,
  ScrollText, ArrowLeftRight, SlidersHorizontal, PackagePlus, Factory,
  ClipboardList, Scale, Lock, Percent, Pill, Users, UserRound, Store,
  KeyRound, PanelLeftClose, PanelLeft, LogOut, Wifi, WifiOff, ChevronRight,
  FileSpreadsheet, Landmark, BookOpen, Wallet, Warehouse, Undo2, PackageX,
  ShieldAlert, FileText,
} from "lucide-react";
import { cn } from "../lib/cn";

interface NavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  soon?: boolean;
}

/**
 * Grouped the way a pharmacy works, not the way the database is
 * shaped: what you touch every hour at the top, masters and settings
 * at the bottom. Unbuilt modules stay visible but disabled — hiding
 * them undersells the product, faking them is worse.
 */
const NAV: Array<{ group: string; items: NavItem[] }> = [
  {
    group: "Daily",
    items: [
      { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
      { href: "/billing", label: "Billing Counter", icon: ScanBarcode },
      { href: "/sales", label: "Bills", icon: ReceiptText },
      { href: "/prescriptions", label: "Prescriptions", icon: Stethoscope },
      { href: "/returns/sale", label: "Sale Return", icon: Undo2 },
      { href: "/salereturns", label: "Credit Notes", icon: FileText },
    ],
  },
  {
    group: "Inventory",
    items: [
      { href: "/stock", label: "Stock on Hand", icon: Boxes },
      { href: "/expiry", label: "Expiry Watch", icon: Hourglass },
      { href: "/ledger", label: "Stock Ledger", icon: ScrollText },
      { href: "/indents", label: "Ward Indents", icon: ArrowLeftRight },
      { href: "/adjustments", label: "Stock Adjustments", icon: SlidersHorizontal },
      { href: "/recall", label: "Batch Recall Trace", icon: ShieldAlert },
    ],
  },
  {
    group: "Purchase",
    items: [
      { href: "/grns", label: "Goods Receipt", icon: PackagePlus },
      { href: "/suppliers", label: "Suppliers", icon: Factory },
      { href: "/returns/purchase", label: "Purchase Return", icon: PackageX },
      { href: "/purchasereturns", label: "Debit Notes", icon: FileText },
      { href: "/purchase-orders", label: "Purchase Orders", icon: ClipboardList, soon: true },
    ],
  },
  {
    group: "Compliance",
    items: [
      { href: "/h1register", label: "Schedule H1", icon: Scale },
      { href: "/narcotics", label: "Narcotic Register", icon: Lock },
    ],
  },
  {
    group: "Reports",
    items: [
      { href: "/reports/gstr1-b2c", label: "GSTR-1 Summary", icon: Percent },
      { href: "/reports/hsn-summary", label: "HSN Summary", icon: FileSpreadsheet },
      { href: "/reports/purchase-register", label: "Purchase Register", icon: Landmark },
      { href: "/reports/day-book", label: "Day Book", icon: BookOpen },
      { href: "/reports/supplier-outstanding", label: "Supplier Outstanding", icon: Wallet },
      { href: "/reports/stock-valuation", label: "Stock Valuation", icon: Warehouse },
    ],
  },
  {
    group: "Masters",
    items: [
      { href: "/items", label: "Item Master", icon: Pill },
      { href: "/patients", label: "Patients", icon: Users },
      { href: "/doctors", label: "Doctors", icon: UserRound },
    ],
  },
  {
    group: "Settings",
    items: [
      { href: "/stores", label: "Stores & Counters", icon: Store },
      { href: "/users", label: "Users", icon: KeyRound },
    ],
  },
];

interface Session {
  user: { name: string; role: string };
  storeName: string;
  storeCode: string;
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [session, setSession] = useState<Session | null>(null);
  const [online, setOnline] = useState(true);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    const raw = localStorage.getItem("vp_session");
    if (!raw) return router.replace("/login");
    try {
      setSession(JSON.parse(raw));
    } catch {
      router.replace("/login");
    }
    setCollapsed(localStorage.getItem("vp_nav_collapsed") === "1");
  }, [router]);

  useEffect(() => {
    const sync = () => setOnline(navigator.onLine);
    sync();
    addEventListener("online", sync);
    addEventListener("offline", sync);
    return () => {
      removeEventListener("online", sync);
      removeEventListener("offline", sync);
    };
  }, []);

  function toggle() {
    setCollapsed((c) => {
      localStorage.setItem("vp_nav_collapsed", c ? "0" : "1");
      return !c;
    });
  }

  function signOut() {
    localStorage.removeItem("vp_session");
    document.cookie = "vp_token=; Max-Age=0; path=/";
    router.replace("/login");
  }

  if (!session) {
    return (
      <div className="grid min-h-screen place-items-center">
        <div className="shimmer size-10 rounded-full" />
      </div>
    );
  }

  const crumb =
    NAV.flatMap((g) => g.items).find((i) => i.href === pathname)?.label ?? "Dashboard";

  return (
    <div className="flex min-h-screen">
      {/* ── Sidebar ─────────────────────────────────────────── */}
      <aside
        className={cn(
          "sticky top-0 flex h-screen shrink-0 flex-col bg-sidebar transition-[width] duration-200",
          collapsed ? "w-[68px]" : "w-64",
        )}
      >
        <div className="flex h-16 items-center gap-3 px-4">
          <div className="grid size-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-brand-400 to-brand-600 text-[15px] font-bold text-white shadow-lg shadow-brand-900/30">
            V
          </div>
          {!collapsed && (
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-white">Velocare</p>
              <p className="truncate text-[11px] text-sidebar-muted">Pharmacy ERP</p>
            </div>
          )}
        </div>

        <nav className="scrollbar-thin flex-1 overflow-y-auto px-2.5 pb-4">
          {NAV.map((g) => (
            <div key={g.group} className="mb-1">
              {!collapsed && (
                <p className="px-2.5 pt-4 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.09em] text-sidebar-muted">
                  {g.group}
                </p>
              )}
              {collapsed && <div className="my-2.5 border-t border-white/[0.07]" />}

              {g.items.map(({ href, label, icon: Icon, soon }) => {
                const active = pathname === href;
                const base =
                  "group relative flex items-center gap-3 rounded-lg px-2.5 py-2 text-[13px] transition-colors";

                if (soon) {
                  return (
                    <span
                      key={href}
                      title={`${label} — not built yet`}
                      className={cn(base, "cursor-not-allowed text-sidebar-muted/60")}
                    >
                      <Icon className="size-[18px] shrink-0" />
                      {!collapsed && (
                        <>
                          <span className="truncate">{label}</span>
                          <span className="ml-auto rounded bg-white/[0.06] px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide">
                            soon
                          </span>
                        </>
                      )}
                    </span>
                  );
                }

                return (
                  <Link
                    key={href}
                    href={href}
                    title={collapsed ? label : undefined}
                    className={cn(
                      base,
                      active
                        ? "bg-sidebar-active font-medium text-white"
                        : "text-sidebar-fg hover:bg-sidebar-hover hover:text-white",
                    )}
                  >
                    {active && (
                      <span className="absolute -left-2.5 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full bg-brand-400" />
                    )}
                    <Icon className={cn("size-[18px] shrink-0", active && "text-brand-300")} />
                    {!collapsed && <span className="truncate">{label}</span>}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        <button
          onClick={toggle}
          className="flex items-center gap-2.5 border-t border-white/[0.07] px-4 py-3 text-xs text-sidebar-muted transition-colors hover:text-white"
        >
          {collapsed ? <PanelLeft className="size-4" /> : <PanelLeftClose className="size-4" />}
          {!collapsed && "Collapse"}
        </button>
      </aside>

      {/* ── Main ────────────────────────────────────────────── */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-16 items-center gap-4 border-b border-slate-200 bg-white/85 px-6 backdrop-blur-md">
          <div className="flex min-w-0 items-center gap-2 text-sm">
            <span className="font-semibold text-slate-800">{session.storeName}</span>
            <Badge>{session.storeCode}</Badge>
            <ChevronRight className="size-3.5 text-slate-300" />
            <span className="truncate text-slate-500">{crumb}</span>
          </div>

          <div className="ml-auto flex items-center gap-3">
            <span
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1 ring-inset",
                online
                  ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
                  : "bg-amber-50 text-amber-700 ring-amber-200",
              )}
            >
              {online ? <Wifi className="size-3" /> : <WifiOff className="size-3" />}
              {online ? "Online" : "Offline — billing continues"}
            </span>

            <div className="hidden text-right sm:block">
              <p className="text-[13px] font-medium leading-tight text-slate-800">
                {session.user.name}
              </p>
              <p className="text-[11px] capitalize leading-tight text-slate-400">
                {session.user.role.replace(/_/g, " ").toLowerCase()}
              </p>
            </div>

            <div className="grid size-9 place-items-center rounded-full bg-brand-100 text-xs font-bold text-brand-700">
              {session.user.name.slice(0, 2).toUpperCase()}
            </div>

            <button
              onClick={signOut}
              title="Sign out"
              className="grid size-9 place-items-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
            >
              <LogOut className="size-4" />
            </button>
          </div>
        </header>

        <main className="flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-md bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-slate-500">
      {children}
    </span>
  );
}
