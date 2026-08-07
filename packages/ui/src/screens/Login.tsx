"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Login + counter selection.
 *
 * The store and nodeKey chosen here are what make the counter
 * offline-capable, so they are persisted to localStorage — an offline
 * session cannot re-ask the server which counter it is.
 */
export default function LoginPage() {
  const router = useRouter();
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
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Login failed.");

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
      router.push("/billing");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Login failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="wrap">
      <form onSubmit={submit} className="card">
        <h1>Velocare Pharmacy</h1>
        <p className="sub">Sign in to the dispensing counter</p>

        <label>Email</label>
        <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" required />

        <label>Password</label>
        <input
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          type="password"
          required
        />

        <label>
          Counter ID <small>identifies this machine for offline billing</small>
        </label>
        <input value={nodeKey} onChange={(e) => setNodeKey(e.target.value)} placeholder="COUNTER-01" />

        {error && <p className="err">{error}</p>}

        <button disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
      </form>

      <style jsx>{`
        .wrap { min-height: 100vh; display: grid; place-items: center; font: 14px/1.5 system-ui, sans-serif; }
        .card { width: 340px; background: #fff; padding: 28px; border: 1px solid #e3e6ea; border-radius: 12px; display: flex; flex-direction: column; }
        h1 { margin: 0; font-size: 20px; }
        .sub { margin: 4px 0 20px; color: #8a929c; }
        label { font-size: 12px; font-weight: 600; margin-top: 12px; margin-bottom: 4px; }
        label small { font-weight: 400; color: #8a929c; }
        input { padding: 10px 12px; border: 1px solid #d6dae0; border-radius: 8px; font-size: 14px; }
        button { margin-top: 20px; padding: 12px; border: 0; border-radius: 8px; background: #2563eb; color: #fff; font-weight: 700; font-size: 15px; cursor: pointer; }
        button:disabled { background: #b8c2d1; cursor: not-allowed; }
        .err { margin: 12px 0 0; padding: 9px 12px; background: #fdecec; color: #b4232a; border-radius: 8px; font-size: 13px; }
      `}</style>
    </div>
  );
}
