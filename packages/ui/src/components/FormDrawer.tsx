"use client";

import { useEffect, useState } from "react";
import { X, Loader2, TriangleAlert, Info } from "lucide-react";
import { Button, Input, Label } from "./ui";
import { cn } from "../lib/cn";

/**
 * Slide-over create/edit form, rendered from server-supplied field
 * definitions.
 *
 * A drawer rather than a separate page on purpose: a purchase officer
 * adding twelve items in a row should never lose the list they were
 * working from. Marg's full-screen master entry is the single most
 * common complaint people have about it.
 */

interface Field {
  key: string;
  label: string;
  type: "text" | "number" | "money" | "select" | "checkbox" | "date" | "textarea" | "ref";
  required?: boolean;
  hint?: string;
  placeholder?: string;
  options?: Array<{ value: string; label: string }>;
  refResource?: string;
  span?: number;
  step?: string;
  defaultValue?: string | number | boolean;
}

interface Def {
  singular: string;
  fields: Field[];
  lookups: Record<string, Array<{ value: string; label: string }>>;
  record: Record<string, unknown> | null;
}

const SPAN: Record<number, string> = {
  2: "col-span-2", 3: "col-span-3", 4: "col-span-4", 5: "col-span-5",
  6: "col-span-6", 7: "col-span-7", 8: "col-span-8", 12: "col-span-12",
};

export default function FormDrawer({
  form,
  id,
  onClose,
  onSaved,
}: {
  form: string;
  id?: string | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [def, setDef] = useState<Def | null>(null);
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [topError, setTopError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      const res = await fetch(`/api/crud/${form}${id ? `?id=${id}` : ""}`);
      const raw = await res.text();
      if (!raw) return setTopError(`Server returned ${res.status} with no body.`);
      const body = JSON.parse(raw);
      if (!res.ok) return setTopError(body.error ?? "Could not load the form.");
      setDef(body);

      const init: Record<string, unknown> = {};
      for (const f of body.fields as Field[]) {
        init[f.key] =
          (body.record as Record<string, unknown>)?.[f.key] ??
          f.defaultValue ??
          (f.type === "checkbox" ? false : "");
      }
      setValues(init);
    })();
  }, [form, id]);

  // Esc closes — a form you can't dismiss from the keyboard is a form
  // that interrupts a keyboard-driven workflow.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [onClose]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    setTopError("");
    try {
      const res = await fetch(`/api/crud/${form}${id ? `?id=${id}` : ""}`, {
        method: id ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      const raw = await res.text();
      if (!raw) throw new Error(`Server returned ${res.status} with no body.`);
      const body = JSON.parse(raw);
      if (!res.ok) {
        if (body.errors) setErrors(body.errors);
        throw new Error(body.error ?? "Could not save.");
      }
      onSaved();
      onClose();
    } catch (e) {
      setTopError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const set = (k: string, v: unknown) => setValues((s) => ({ ...s, [k]: v }));

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-[2px]" onClick={onClose} />

      <div className="relative flex h-full w-full max-w-2xl flex-col bg-white shadow-2xl">
        <header className="flex h-16 shrink-0 items-center justify-between border-b border-slate-200 px-6">
          <div>
            <h2 className="text-lg font-semibold tracking-tight text-slate-900">
              {id ? "Edit" : "New"} {def?.singular ?? "record"}
            </h2>
            <p className="text-xs text-slate-400">
              <kbd className="rounded border border-slate-200 bg-slate-50 px-1 font-mono text-[10px]">Esc</kbd>{" "}
              to close
            </p>
          </div>
          <button
            onClick={onClose}
            className="grid size-9 place-items-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            <X className="size-4" />
          </button>
        </header>

        <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
          <div className="scrollbar-thin flex-1 overflow-y-auto p-6">
            {topError && (
              <div className="mb-5 flex gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-800 ring-1 ring-red-200">
                <TriangleAlert className="size-4 shrink-0" />
                {topError}
              </div>
            )}

            {!def ? (
              <div className="grid grid-cols-12 gap-4">
                {Array.from({ length: 8 }).map((_, i) => (
                  <div key={i} className="shimmer col-span-6 h-16 rounded-lg" />
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-12 gap-x-4 gap-y-4">
                {def.fields.map((f) => {
                  const err = errors[f.key];
                  const opts = f.type === "ref" ? def.lookups[f.refResource ?? ""] ?? [] : f.options ?? [];

                  return (
                    <div key={f.key} className={SPAN[f.span ?? 6] ?? "col-span-6"}>
                      {f.type === "checkbox" ? (
                        <label className="flex h-10 cursor-pointer items-center gap-2.5 rounded-lg px-1">
                          <input
                            type="checkbox"
                            checked={Boolean(values[f.key])}
                            onChange={(e) => set(f.key, e.target.checked)}
                            className="size-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                          />
                          <span className="text-sm text-slate-700">{f.label}</span>
                        </label>
                      ) : (
                        <>
                          <Label>
                            {f.label}
                            {f.required && <span className="ml-0.5 text-red-500">*</span>}
                          </Label>

                          {f.type === "select" || f.type === "ref" ? (
                            <select
                              value={String(values[f.key] ?? "")}
                              onChange={(e) => set(f.key, e.target.value)}
                              className={cn(
                                "h-10 w-full rounded-lg bg-white px-3 text-sm ring-1 ring-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-500",
                                err && "ring-red-400",
                              )}
                            >
                              <option value="">{f.required ? "Select…" : "— none —"}</option>
                              {opts.map((o) => (
                                <option key={o.value} value={o.value}>
                                  {o.label}
                                </option>
                              ))}
                            </select>
                          ) : f.type === "textarea" ? (
                            <textarea
                              rows={2}
                              value={String(values[f.key] ?? "")}
                              onChange={(e) => set(f.key, e.target.value)}
                              placeholder={f.placeholder}
                              className={cn(
                                "w-full rounded-lg bg-white px-3 py-2 text-sm ring-1 ring-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-500",
                                err && "ring-red-400",
                              )}
                            />
                          ) : (
                            <Input
                              type={f.type === "number" || f.type === "money" ? "number" : f.type}
                              step={f.step ?? (f.type === "money" ? "0.01" : undefined)}
                              value={String(values[f.key] ?? "")}
                              onChange={(e) => set(f.key, e.target.value)}
                              placeholder={f.placeholder}
                              className={cn(err && "ring-red-400 focus:ring-red-500")}
                            />
                          )}
                        </>
                      )}

                      {err ? (
                        <p className="mt-1 text-[11px] font-medium text-red-600">{err}</p>
                      ) : f.hint ? (
                        <p className="mt-1 flex items-start gap-1 text-[11px] text-slate-400">
                          <Info className="mt-px size-3 shrink-0" />
                          {f.hint}
                        </p>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <footer className="flex shrink-0 items-center justify-end gap-2 border-t border-slate-200 bg-slate-50 px-6 py-4">
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !def}>
              {busy && <Loader2 className="size-4 animate-spin" />}
              {id ? "Save changes" : `Create ${def?.singular ?? ""}`}
            </Button>
          </footer>
        </form>
      </div>
    </div>
  );
}
