"use client";

import * as React from "react";
import { cn } from "../lib/cn";

/**
 * UI primitives in the shadcn idiom — owned in-repo rather than
 * pulled from a component library, so there is no version to fight
 * and the on-prem build has no extra runtime dependency.
 */

// ── Card ──────────────────────────────────────────────────────
export function Card({ className, ...p }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "rounded-xl bg-white ring-1 ring-slate-200/70 shadow-sm shadow-slate-900/[0.03]",
        className,
      )}
      {...p}
    />
  );
}

export function CardHeader({ className, ...p }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex items-start justify-between gap-4 px-5 pt-4 pb-3", className)} {...p} />;
}

export function CardTitle({ className, ...p }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cn("text-sm font-semibold tracking-tight text-slate-800", className)} {...p} />;
}

export function CardDescription({ className, ...p }: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn("text-xs text-slate-500", className)} {...p} />;
}

export function CardContent({ className, ...p }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("px-5 pb-5", className)} {...p} />;
}

// ── Button ────────────────────────────────────────────────────
type Variant = "primary" | "secondary" | "ghost" | "danger" | "success";
type Size = "sm" | "md" | "lg";

const VARIANT: Record<Variant, string> = {
  primary:
    "bg-brand-600 text-white hover:bg-brand-700 active:bg-brand-800 shadow-sm shadow-brand-600/25",
  secondary:
    "bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50 active:bg-slate-100",
  ghost: "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
  danger: "bg-red-600 text-white hover:bg-red-700 shadow-sm shadow-red-600/25",
  success:
    "bg-emerald-600 text-white hover:bg-emerald-700 active:bg-emerald-800 shadow-sm shadow-emerald-600/25",
};

const SIZE: Record<Size, string> = {
  sm: "h-8 px-3 text-xs gap-1.5",
  md: "h-9.5 px-4 text-sm gap-2",
  lg: "h-11 px-5 text-[15px] gap-2",
};

export function Button({
  className,
  variant = "primary",
  size = "md",
  ...p
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size }) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center rounded-lg font-medium transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 focus-visible:ring-offset-1",
        "disabled:opacity-45 disabled:pointer-events-none",
        VARIANT[variant],
        SIZE[size],
        className,
      )}
      {...p}
    />
  );
}

// ── Badge ─────────────────────────────────────────────────────
export type Tone = "neutral" | "brand" | "good" | "warn" | "bad";

const TONE: Record<Tone, string> = {
  neutral: "bg-slate-100 text-slate-600 ring-slate-200",
  brand: "bg-brand-50 text-brand-700 ring-brand-200",
  good: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  warn: "bg-amber-50 text-amber-700 ring-amber-200",
  bad: "bg-red-50 text-red-700 ring-red-200",
};

export function Badge({
  tone = "neutral",
  className,
  ...p
}: React.HTMLAttributes<HTMLSpanElement> & { tone?: Tone }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset whitespace-nowrap",
        TONE[tone],
        className,
      )}
      {...p}
    />
  );
}

/**
 * Status → colour. Centralised so "EXPIRED" is the same red on the
 * dashboard, the stock list and the ledger — inconsistent status
 * colours are how people learn to ignore them.
 */
export function toneFor(value: string): Tone {
  const s = value.toUpperCase();
  if (["CANCELLED", "EXPIRED", "REJECTED", "NARCOTIC", "X", "FAILED"].includes(s)) return "bad";
  if (["H1", "OFFLINE", "DRAFT", "SUBMITTED", "PARTIALLY_ISSUED", "PENDING", "H"].includes(s))
    return "warn";
  if (["POSTED", "RECEIVED", "ISSUED", "APPROVED", "ACTIVE", "YES"].includes(s)) return "good";
  if (["NONE", "NO", "—"].includes(s)) return "neutral";
  return "brand";
}

// ── Input ─────────────────────────────────────────────────────
export const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(function Input({ className, ...p }, ref) {
  return (
    <input
      ref={ref}
      className={cn(
        "h-10 w-full rounded-lg bg-white px-3.5 text-sm text-slate-900 ring-1 ring-slate-200",
        "placeholder:text-slate-400 transition-shadow",
        "focus:outline-none focus:ring-2 focus:ring-brand-500",
        "disabled:bg-slate-50 disabled:text-slate-400",
        className,
      )}
      {...p}
    />
  );
});

export function Label({ className, ...p }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      className={cn("block text-xs font-semibold text-slate-700 mb-1.5", className)}
      {...p}
    />
  );
}

// ── Table ─────────────────────────────────────────────────────
export function Table({ className, ...p }: React.TableHTMLAttributes<HTMLTableElement>) {
  return <table className={cn("w-full border-collapse text-sm", className)} {...p} />;
}

export function Th({
  className,
  align,
  ...p
}: React.ThHTMLAttributes<HTMLTableCellElement> & { align?: "left" | "right" }) {
  return (
    <th
      className={cn(
        "sticky top-0 z-10 bg-slate-50/95 backdrop-blur px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500",
        "border-b border-slate-200 whitespace-nowrap",
        align === "right" ? "text-right" : "text-left",
        className,
      )}
      {...p}
    />
  );
}

export function Td({
  className,
  align,
  ...p
}: React.TdHTMLAttributes<HTMLTableCellElement> & { align?: "left" | "right" }) {
  return (
    <td
      className={cn(
        "border-b border-slate-100 px-4 py-2.5 whitespace-nowrap",
        align === "right" && "text-right tabular",
        className,
      )}
      {...p}
    />
  );
}

// ── Skeleton ──────────────────────────────────────────────────
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("shimmer rounded-md", className)} />;
}

// ── Empty state ───────────────────────────────────────────────
export function EmptyState({
  icon: Icon,
  title,
  hint,
}: {
  icon?: React.ComponentType<{ className?: string }>;
  title: string;
  hint?: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
      {Icon && (
        <div className="mb-1 grid size-11 place-items-center rounded-full bg-slate-100">
          <Icon className="size-5 text-slate-400" />
        </div>
      )}
      <p className="text-sm font-medium text-slate-600">{title}</p>
      {hint && <p className="max-w-sm text-xs text-slate-400">{hint}</p>}
    </div>
  );
}
