import { redirect } from "next/navigation";

/**
 * Root. Without this the deployment's home page is a 404, which looks
 * broken to anyone you send the link to before they reach /login.
 */
export default function Home() {
  redirect("/login");
}
