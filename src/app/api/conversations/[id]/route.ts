import { NextResponse } from "next/server";
import {
  deleteConversation,
  loadConversationWorkspace,
  updateConversationSkill,
} from "@/lib/server/store";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;

  try {
    const workspace = await loadConversationWorkspace(id);
    return NextResponse.json({
      ok: true,
      workspace,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Conversation lookup failed.",
      },
      { status: 404 },
    );
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;

  try {
    const workspace = await deleteConversation(id);
    return NextResponse.json({
      ok: true,
      workspace,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Conversation delete failed.",
      },
      { status: 404 },
    );
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;

  try {
    const body = (await request.json().catch(() => ({}))) as { activeSkillId?: unknown };
    const rawSkillId = body.activeSkillId;
    const activeSkillId =
      typeof rawSkillId === "string" && rawSkillId.trim() ? rawSkillId.trim() : undefined;
    const workspace = await updateConversationSkill(id, activeSkillId);

    return NextResponse.json({
      ok: true,
      workspace,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Conversation update failed.";
    const status = message.includes("Conversation not found") ? 404 : 400;

    return NextResponse.json(
      {
        ok: false,
        error: message,
      },
      { status },
    );
  }
}
