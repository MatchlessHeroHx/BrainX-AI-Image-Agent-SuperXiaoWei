import { AppShell } from "@/components/app-shell";
import { loadWorkspaceState } from "@/lib/server/store";

export const dynamic = "force-dynamic";

export default async function Home() {
  const workspace = await loadWorkspaceState();
  return <AppShell initialWorkspace={workspace} />;
}
