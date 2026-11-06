import { redirect } from "next/navigation";

// The proxy sends unauthenticated visitors on to /login?next=%2Fdashboard.
export default function Home() {
  redirect("/dashboard");
}
