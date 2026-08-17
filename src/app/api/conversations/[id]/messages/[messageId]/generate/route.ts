import { NextResponse } from "next/server";
import {
  runGenerationFromForm,
  type MessageStreamEvent,
} from "@/lib/server/message-service";

export const dynamic = "force-dynamic";

const encoder = new TextEncoder();

function formatSse(event: MessageStreamEvent | { type: "done" }) {
  return `data: ${JSON.stringify(event)}\n\n`;
}

type ParsedPayload = {
  aspectRatio?: string;
  resolution?: string;
  outputCount?: number;
  imageProviderId?: string;
  imageModelId?: string;
};

const asTrimmed = (value: unknown) =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;

const asCount = (value: unknown) => {
  const parsed = typeof value === "string" ? Number(value) : (value as number);
  return typeof parsed === "number" && Number.isFinite(parsed) ? parsed : undefined;
};

async function parseRequest(request: Request): Promise<ParsedPayload> {
  const contentType = request.headers.get("content-type") ?? "";

  if (contentType.includes("application/json")) {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    return {
      aspectRatio: asTrimmed(body.aspectRatio),
      resolution: asTrimmed(body.resolution),
      outputCount: asCount(body.outputCount),
      imageProviderId: asTrimmed(body.imageProviderId),
      imageModelId: asTrimmed(body.imageModelId),
    };
  }

  const formData = await request.formData();
  return {
    aspectRatio: asTrimmed(formData.get("aspectRatio")),
    resolution: asTrimmed(formData.get("resolution")),
    outputCount: asCount(formData.get("outputCount")),
    imageProviderId: asTrimmed(formData.get("imageProviderId")),
    imageModelId: asTrimmed(formData.get("imageModelId")),
  };
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string; messageId: string }> },
) {
  const { id, messageId } = await context.params;
  const acceptsStream =
    request.headers.get("accept")?.includes("text/event-stream") ?? false;

  try {
    const payload = await parseRequest(request);

    if (!acceptsStream) {
      const workspace = await runGenerationFromForm({
        conversationId: id,
        messageId,
        formParams: {
          aspectRatio: payload.aspectRatio,
          resolution: payload.resolution,
          outputCount: payload.outputCount,
        },
        imageProviderId: payload.imageProviderId,
        imageModelId: payload.imageModelId,
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
          await runGenerationFromForm({
            conversationId: id,
            messageId,
            formParams: {
              aspectRatio: payload.aspectRatio,
              resolution: payload.resolution,
              outputCount: payload.outputCount,
            },
            imageProviderId: payload.imageProviderId,
            imageModelId: payload.imageModelId,
            onEvent: send,
          });
        } catch (error) {
          send({
            type: "error",
            error: {
              code: (error as { errorClass?: string } | undefined)?.errorClass ?? "unknown",
              message: error instanceof Error ? error.message : "Image generation failed.",
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
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Image generation failed.",
      },
      { status: 400 },
    );
  }
}
