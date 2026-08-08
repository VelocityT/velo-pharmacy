"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Stethoscope, Plus, Trash2, Loader2, CheckCircle2, TriangleAlert, Search, ShieldAlert,
} from "lucide-react";
import AppShell from "../components/AppShell";
import { Card, Button, Input, Label, Badge, toneFor, Skeleton } from "../components/ui";
import { cn } from "../lib/cn";

/**
 * Prescription entry.
 *
 * Not a nice-to-have. The sale service refuses to dispense Schedule H1
 * and narcotic drugs without a linked prescription carrying the
 * prescriber's registration number — correct under the Drugs and
 * Cosmetics Rules and the NDPS Act — so without this screen those
 * drugs can never be sold at all.
 */

interface Doctor { id: string; name: string; registrationNo: string | null; department: string | null }
interface Patient { id: string; name: string; uhid: string | null; phone: string | null }
interface Item { id: string; code: string; name: string; schedule: string; unitOfSale: string }
interface Line { key: string; itemId: string; itemName: string; schedule: string; unit: string; qty: string; dosage: string; days: string }

const blank = (): Line => ({
  key: crypto.randomUUID(), itemId: "", itemName: "", schedule: "NONE",
  unit: "", qty: "", dosage: "", days: "",
});

const DOSAGES = ["1-0-1 after food", "1-1-1 after food", "0-0-1 at bedtime", "1-0-0 before food", "SOS"];

export default function PrescriptionNew() {
  const router = useRouter();
  const [ref, setRef] = useState<{ doctors: Doctor[]; patients: Patient[]; items: Item[] } | null>(null);
  const [patientId, setPatientId] = useState("");
  const [doctorId, setDoctorId] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<Line[]>([blank()]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState<string | null>(null);
  const [picker, setPicker] = useState<{ key: string; q: string } | null>(null);
  const pickerRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    (async () => {
      const res = await fetch("/api/prescription");
      const raw = await res.text();
      if (!raw) return setError(`Server returned ${res.status} with no body.`);
      const body = JSON.parse(raw);
      if (!res.ok) return setError(body.error ?? "Could not load reference data.");
      setRef(body);
    })();
  }, []);

  useEffect(() => { if (picker) pickerRef.current?.focus(); }, [picker]);

  const doctor = ref?.doctors.find((d) => d.id === doctorId);
  const hasScheduled = lines.some((l) => ["H1", "NARCOTIC", "X"].includes(l.schedule));
  const blockedByRegNo = hasScheduled && doctor && !doctor.registrationNo;

  const matches = useMemo(() => {
    if (!picker || !ref) return [];
    const q = picker.q.trim().toLowerCase();
    if (q.length < 2) return [];
    return ref.items
      .filter((i) => i.name.toLowerCase().includes(q) || i.code.toLowerCase().includes(q))
      .slice(0, 12);
  }, [picker, ref]);

  const setLine = (key: string, patch: Partial<Line>) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  async function submit() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/prescription", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          patientId,
          doctorId,
          notes: notes || undefined,
          lines: lines
            .filter((l) => l.itemId && l.qty)
            .map((l) => ({
              itemId: l.itemId,
              qty: l.qty,
              dosage: l.dosage || undefined,
              days: l.days ? Number(l.days) : undefined,
            })),
        }),
      });
      const raw = await res.text();
      if (!raw) throw new Error(`Server returned ${res.status} with no body.`);
      const body = JSON.parse(raw);
      if (!res.ok) throw new Error(body.error ?? "Could not save the prescription.");
      setDone(body.prescription.rxNo);
      setTimeout(() => router.push("/billing"), 2200);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const ready = patientId && doctorId && !blockedByRegNo && lines.some((l) => l.itemId && l.qty);

  if (done) {
    return (
      <AppShell>
        <div className="grid place-items-center py-32 text-center">
          <CheckCircle2 className="mb-4 size-14 text-emerald-500" />
          <h1 className="text-2xl font-semibold tracking-tight">Prescription saved</h1>
          <p className="mt-1 font-mono text-sm text-slate-500">{done}</p>
          <p className="mt-3 max-w-md text-sm text-slate-500">
            Scheduled drugs on this prescription can now be dispensed. Taking you to the counter…
          </p>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="mx-auto max-w-5xl space-y-4">
        <div>
          <h1 className="flex items-center gap-2.5 text-2xl font-semibold tracking-tight text-slate-900">
            <Stethoscope className="size-6 text-brand-500" />
            New Prescription
          </h1>
          <p className="mt-0.5 text-sm text-slate-500">
            Required before Schedule H1 or narcotic drugs can be dispensed.
          </p>
        </div>

        {error && (
          <Card className="flex gap-2.5 border-l-4 border-l-red-500 bg-red-50/50 p-4 ring-red-200">
            <TriangleAlert className="size-5 shrink-0 text-red-500" />
            <p className="text-sm text-red-800">{error}</p>
          </Card>
        )}

        <Card className="p-5">
          {!ref ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <Skeleton className="h-16" />
              <Skeleton className="h-16" />
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label>Patient <span className="text-red-500">*</span></Label>
                <select
                  value={patientId}
                  onChange={(e) => setPatientId(e.target.value)}
                  className="h-10 w-full rounded-lg bg-white px-3 text-sm ring-1 ring-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-500"
                >
                  <option value="">Select patient…</option>
                  {ref.patients.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}{p.uhid ? ` · ${p.uhid}` : ""}{p.phone ? ` · ${p.phone}` : ""}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-[11px] text-slate-400">
                  Not listed? Add them in Masters → Patients.
                </p>
              </div>

              <div>
                <Label>Prescriber <span className="text-red-500">*</span></Label>
                <select
                  value={doctorId}
                  onChange={(e) => setDoctorId(e.target.value)}
                  className={cn(
                    "h-10 w-full rounded-lg bg-white px-3 text-sm ring-1 focus:outline-none focus:ring-2",
                    blockedByRegNo ? "ring-red-400 focus:ring-red-500" : "ring-slate-200 focus:ring-brand-500",
                  )}
                >
                  <option value="">Select doctor…</option>
                  {ref.doctors.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}{d.department ? ` · ${d.department}` : ""}
                      {d.registrationNo ? "" : "  ⚠ no reg. no."}
                    </option>
                  ))}
                </select>
                {doctor && (
                  <p className="mt-1 text-[11px] text-slate-400">
                    Reg. No: {doctor.registrationNo ?? "— missing —"}
                  </p>
                )}
              </div>

              <div className="sm:col-span-2">
                <Label>Notes</Label>
                <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Diagnosis or instructions" />
              </div>
            </div>
          )}
        </Card>

        {blockedByRegNo && (
          <Card className="flex gap-2.5 border-l-4 border-l-red-500 bg-red-50/50 p-4 ring-red-200">
            <ShieldAlert className="size-5 shrink-0 text-red-500" />
            <div className="text-sm text-red-800">
              <p className="font-semibold">
                {doctor?.name} has no registration number on record.
              </p>
              <p className="mt-0.5">
                A prescriber&apos;s registration number is a mandatory column of the Schedule H1
                register, so scheduled drugs cannot be prescribed without it. Add it in
                Masters → Doctors.
              </p>
            </div>
          </Card>
        )}

        <Card className="overflow-visible">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/80">
                {["Drug", "Qty", "Unit", "Dosage", "Days", ""].map((h, i) => (
                  <th
                    key={h || i}
                    className={cn(
                      "px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500",
                      i === 1 || i === 4 ? "text-right" : "text-left",
                    )}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.key} className="border-b border-slate-100 last:border-0">
                  <td className="relative px-4 py-2">
                    <button
                      onClick={() => setPicker({ key: l.key, q: "" })}
                      className={cn(
                        "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-slate-50",
                        l.itemId ? "font-medium text-slate-800" : "text-slate-400",
                      )}
                    >
                      {!l.itemId && <Search className="size-3.5" />}
                      {l.itemName || "Select drug…"}
                      {l.schedule !== "NONE" && (
                        <Badge tone={toneFor(l.schedule)} className="ml-1">{l.schedule}</Badge>
                      )}
                    </button>

                    {picker?.key === l.key && (
                      <div className="absolute left-4 top-full z-30 w-96 rounded-xl bg-white p-2 shadow-xl ring-1 ring-slate-200">
                        <input
                          ref={pickerRef}
                          value={picker.q}
                          onChange={(e) => setPicker({ ...picker, q: e.target.value })}
                          onKeyDown={(e) => {
                            if (e.key === "Escape") setPicker(null);
                            if (e.key === "Enter" && matches[0]) {
                              const m = matches[0];
                              setLine(l.key, { itemId: m.id, itemName: m.name, schedule: m.schedule, unit: m.unitOfSale });
                              setPicker(null);
                            }
                          }}
                          placeholder="Type drug name or code…"
                          className="h-9 w-full rounded-lg bg-slate-50 px-3 text-sm ring-1 ring-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-500"
                        />
                        <ul className="mt-1 max-h-64 overflow-auto">
                          {matches.map((m) => (
                            <li key={m.id}>
                              <button
                                onClick={() => {
                                  setLine(l.key, { itemId: m.id, itemName: m.name, schedule: m.schedule, unit: m.unitOfSale });
                                  setPicker(null);
                                }}
                                className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left hover:bg-brand-50"
                              >
                                <span className="min-w-0 flex-1 truncate text-sm">{m.name}</span>
                                {m.schedule !== "NONE" && (
                                  <Badge tone={toneFor(m.schedule)}>{m.schedule}</Badge>
                                )}
                              </button>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-2">
                    <input
                      type="number"
                      step="0.001"
                      value={l.qty}
                      onChange={(e) => setLine(l.key, { qty: e.target.value })}
                      className="tabular h-9 w-full rounded-md bg-white px-2 text-right text-sm ring-1 ring-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-500"
                    />
                  </td>
                  <td className="px-4 py-2 text-xs text-slate-400">{l.unit || "—"}</td>
                  <td className="px-4 py-2">
                    <input
                      list="dosages"
                      value={l.dosage}
                      onChange={(e) => setLine(l.key, { dosage: e.target.value })}
                      placeholder="1-0-1 after food"
                      className="h-9 w-full rounded-md bg-white px-2 text-sm ring-1 ring-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-500"
                    />
                  </td>
                  <td className="px-4 py-2">
                    <input
                      type="number"
                      value={l.days}
                      onChange={(e) => setLine(l.key, { days: e.target.value })}
                      className="tabular h-9 w-16 rounded-md bg-white px-2 text-right text-sm ring-1 ring-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-500"
                    />
                  </td>
                  <td className="px-2 py-2 text-right">
                    <button
                      onClick={() => setLines((ls) => (ls.length === 1 ? [blank()] : ls.filter((x) => x.key !== l.key)))}
                      className="grid size-7 place-items-center rounded-md text-slate-300 hover:bg-red-50 hover:text-red-600"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <datalist id="dosages">
            {DOSAGES.map((d) => <option key={d} value={d} />)}
          </datalist>
          <div className="border-t border-slate-100 px-4 py-3">
            <Button variant="secondary" size="sm" onClick={() => setLines((ls) => [...ls, blank()])}>
              <Plus className="size-3.5" /> Add drug
            </Button>
          </div>
        </Card>

        <div className="flex justify-end">
          <Button size="lg" disabled={!ready || busy} onClick={() => void submit()}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Stethoscope className="size-4" />}
            {busy ? "Saving…" : "Save Prescription"}
          </Button>
        </div>
      </div>

      {picker && <div className="fixed inset-0 z-20" onClick={() => setPicker(null)} />}
    </AppShell>
  );
}
