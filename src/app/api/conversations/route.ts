import { NextResponse } from "next/server";
import { createConversation, loadWorkspaceState } from "@/lib/server/store";

export const dynamic = "force-dynamic";

export async function GET() {
  const workspace = await loadWorkspaceState();
  return NextResponse.json({
    ok: true,
    workspace,
  });
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { title?: string };
  const workspace = await createConversation(body.title);
  return NextResponse.json({
    ok: true,
    workspace,
  });
}
