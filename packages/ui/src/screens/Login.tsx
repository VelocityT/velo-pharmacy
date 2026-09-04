"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, TriangleAlert, Monitor, Lock, Mail } from "lucide-react";
import { Button, Input, Label, Card } from "../components/ui";

/**
 * Login + counter selection.
 *
 * The store and nodeKey chosen here are what make a counter
 * offline-capable, so they're written to localStorage — a
 * disconnected session cannot go back and ask the server which
 * counter it is.
 */
/** Client-side twin of AUTH_DISABLED — see AppShell.tsx. */
const AUTH_OFF = process.env.NEXT_PUBLIC_AUTH_DISABLED === "true";

export default function LoginPage() {
  const router = useRouter();

  // With the bypass on, this page has nothing to do. Anyone who lands
  // here (bookmark, old tab, direct URL) goes straight through.
  useEffect(() => {
    if (AUTH_OFF) router.replace("/dashboard");
  }, [router]);

  const [email, setEmail] = useState("pharmacist@velocare.in");
  const [password, setPassword] = useState("Demo@12345");
  const [nodeKey, setNodeKey] = useState("COUNTER-01");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, nodeKey: nodeKey || undefined }),
      });

      // A crashed route handler returns 500 with an EMPTY body, and
      // res.json() then throws "Unexpected end of JSON input" — which
      // hides the real error. Read as text first.
      const raw = await res.text();
      if (!raw) {
        throw new Error(
          `Server returned ${res.status} with no body. The real error is in the terminal running 'npm run dev:cloud'.`,
        );
      }

      let body;
      try {
        body = JSON.parse(raw);
      } catch {
        throw new Error(`Server returned ${res.status}: ${raw.slice(0, 250)}`);
      }
      if (!res.ok) throw new Error(body.error ?? `Login failed (${res.status}).`);

      const billing = body.stores.find((s: { canBillPatient: boolean }) => s.canBillPatient);
      const store = billing ?? body.stores[0];
      if (!store) throw new Error("This user has no store access. Ask an admin to assign one.");

      localStorage.setItem(
        "vp_session",
        JSON.stringify({
          user: body.user,
          storeId: store.id,
          storeCode: store.code,
          storeName: store.name,
          nodeId: body.nodeId,
          nodeKey,
        }),
      );
      router.push("/dashboard");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Login failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative grid min-h-screen place-items-center overflow-hidden bg-slate-950 p-4">
      {/* ambient background */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -left-40 -top-40 size-[500px] rounded-full bg-brand-600/20 blur-[120px]" />
        <div className="absolute -bottom-40 -right-40 size-[500px] rounded-full bg-emerald-500/10 blur-[120px]" />
      </div>

      <div className="relative w-full max-w-[400px]">
        <div className="mb-8 flex flex-col items-center">
          <div className="mb-4 grid size-14 place-items-center rounded-2xl bg-gradient-to-br from-brand-400 to-brand-600 text-xl font-bold text-white shadow-xl shadow-brand-600/30">
            V
          </div>
          <h1 className="text-xl font-semibold tracking-tight text-white">Velocare Pharmacy</h1>
          <p className="mt-1 text-sm text-slate-400">Sign in to the dispensing counter</p>
        </div>

        <Card className="p-6 ring-white/10">
          <form onSubmit={submit} className="space-y-4">
            <div>
              <Label htmlFor="email">Email</Label>
              <div className="relative">
                <Mail className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
                <Input
                  id="email"
                  type="email"
                  required
                  autoComplete="username"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="pl-9.5"
                />
              </div>
            </div>

            <div>
              <Label htmlFor="pw">Password</Label>
              <div className="relative">
                <Lock className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
                <Input
                  id="pw"
                  type="password"
                  required
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="pl-9.5"
                />
              </div>
            </div>

            <div>
              <Label htmlFor="node">
                Counter ID
                <span className="ml-1.5 font-normal text-slate-400">
                  identifies this machine for offline billing
                </span>
              </Label>
              <div className="relative">
                <Monitor className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
                <Input
                  id="node"
                  value={nodeKey}
                  onChange={(e) => setNodeKey(e.target.value)}
                  placeholder="COUNTER-01"
                  className="pl-9.5 font-mono text-[13px]"
                />
              </div>
            </div>

            {error && (
              <div className="flex gap-2 rounded-lg bg-red-50 p-3 text-xs leading-relaxed text-red-800 ring-1 ring-red-200">
                <TriangleAlert className="size-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <Button type="submit" size="lg" className="w-full" disabled={busy}>
              {busy && <Loader2 className="size-4 animate-spin" />}
              {busy ? "Signing in…" : "Sign in"}
            </Button>
          </form>
        </Card>

        <p className="mt-6 text-center text-[11px] text-slate-500">
          Velocare Pharmacy · Velocity Tech
        </p>
      </div>
    </div>
  );
}
