import { NextResponse } from "next/server";
import {
  processIncomingMessage,
  type MessageStreamEvent,
} from "@/lib/server/message-service";

export const dynamic = "force-dynamic";

const encoder = new TextEncoder();

function formatSse(event: MessageStreamEvent | { type: "done" }) {
  return `data: ${JSON.stringify(event)}\n\n`;
}

type ParsedPayload = {
  text: string;
  files: File[];
  referenceAssetIds: string[];
  imageProviderId?: string;
  imageModelId?: string;
  agentProviderId?: string;
  agentModelId?: string;
  activeSkillId?: string;
};

async function parseRequest(request: Request): Promise<ParsedPayload> {
  const contentType = request.headers.get("content-type") ?? "";

  if (contentType.includes("multipart/form-data")) {
    const formData = await request.formData();
    const text = `${formData.get("text") ?? ""}`.trim();
    const rawProvider = formData.get("imageProviderId");
    const rawModel = formData.get("imageModelId");
    const rawAgentProvider = formData.get("agentProviderId");
    const rawAgentModel = formData.get("agentModelId");
    const rawActiveSkill = formData.get("activeSkillId");
    const imageProviderId =
      typeof rawProvider === "string" && rawProvider.trim() ? rawProvider.trim() : undefined;
    const imageModelId =
      typeof rawModel === "string" && rawModel.trim() ? rawModel.trim() : undefined;
    const agentProviderId =
      typeof rawAgentProvider === "string" && rawAgentProvider.trim()
        ? rawAgentProvider.trim()
        : undefined;
    const agentModelId =
      typeof rawAgentModel === "string" && rawAgentModel.trim()
        ? rawAgentModel.trim()
        : undefined;
    const activeSkillId =
      typeof rawActiveSkill === "string" && rawActiveSkill.trim()
        ? rawActiveSkill.trim()
        : undefined;
    const files = formData
      .getAll("images")
      .filter((entry): entry is File => entry instanceof File && entry.size > 0);
    const referenceAssetIds = formData
      .getAll("referenceAssetIds")
      .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0);

    return {
      text,
      files,
      referenceAssetIds,
      imageProviderId,
      imageModelId,
      agentProviderId,
      agentModelId,
      activeSkillId,
    };
  }

  const body = (await request.json().catch(() => ({}))) as {
    text?: string;
    referenceAssetIds?: string[];
    imageProviderId?: string;
    imageModelId?: string;
    agentProviderId?: string;
    agentModelId?: string;
    activeSkillId?: string;
  };
  return {
    text: body.text?.trim() ?? "",
    files: [],
    referenceAssetIds: Array.isArray(body.referenceAssetIds)
      ? body.referenceAssetIds.filter(
          (entry): entry is string => typeof entry === "string" && entry.trim().length > 0,
        )
      : [],
    imageProviderId: body.imageProviderId?.trim() || undefined,
    imageModelId: body.imageModelId?.trim() || undefined,
    agentProviderId: body.agentProviderId?.trim() || undefined,
    agentModelId: body.agentModelId?.trim() || undefined,
    activeSkillId: body.activeSkillId?.trim() || undefined,
  };
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const acceptsStream =
    request.headers.get("accept")?.includes("text/event-stream") ?? false;

  try {
    const payload = await parseRequest(request);

    if (!acceptsStream) {
      const workspace = await processIncomingMessage({
        conversationId: id,
        text: payload.text,
        files: payload.files,
        explicitReferenceAssetIds: payload.referenceAssetIds,
        imageProviderId: payload.imageProviderId,
        imageModelId: payload.imageModelId,
        agentProviderId: payload.agentProviderId,
        agentModelId: payload.agentModelId,
        activeSkillId: payload.activeSkillId,
      });

      return NextResponse.json({ ok: true, workspace });
    }

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const send = (event: MessageStreamEvent | { type: "done" }) => {
          try {
            controller.enqueue(encoder.encode(formatSse(event)));
          } catch {
            // controller may be closed if the client disconnects
          }
        };

        try {
          await processIncomingMessage({
            conversationId: id,
            text: payload.text,
            files: payload.files,
            explicitReferenceAssetIds: payload.referenceAssetIds,
            imageProviderId: payload.imageProviderId,
            imageModelId: payload.imageModelId,
            agentProviderId: payload.agentProviderId,
            agentModelId: payload.agentModelId,
            activeSkillId: payload.activeSkillId,
            onEvent: send,
          });
        } catch (error) {
          send({
            type: "error",
            error: {
              code: (error as { errorClass?: string } | undefined)?.errorClass ?? "unknown",
              message: error instanceof Error ? error.message : "Message processing failed.",
              recoverable: false,
            },
          });
        } finally {
          send({ type: "done" });
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Message processing failed.",
      },
      { status: 400 },
    );
  }
}
