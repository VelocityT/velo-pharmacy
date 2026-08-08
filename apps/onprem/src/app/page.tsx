import { redirect } from "next/navigation";

/** Land on the dashboard; AppShell bounces to /login if there's no session. */
export default function Home() {
  redirect("/dashboard");
}
