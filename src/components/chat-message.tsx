"use client";

import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { APlusBriefForm } from "@/components/a-plus-brief-form";
import {
  GenerationParamsForm,
  type GenerationFormSubmit,
} from "@/components/generation-params-form";
import type { APlusBriefValues, ConversationMessage, ImageAsset } from "@/lib/types";

type GenerationFormContext = {
  aspectRatios: string[];
  resolutions: string[];
  disabled: boolean;
  onSubmit: (messageId: string, params: GenerationFormSubmit) => void;
};

type APlusBriefFormContext = {
  disabled: boolean;
  onSubmit: (messageId: string, values: APlusBriefValues) => void;
};

type ChatMessageProps = {
  message: ConversationMessage;
  onPreviewAsset: (asset: ImageAsset) => void;
  isStreaming?: boolean;
  showDebugTrace?: boolean;
  generationFormContext?: GenerationFormContext;
  aPlusBriefFormContext?: APlusBriefFormContext;
};

export function ChatMessage({
  message,
  onPreviewAsset,
  isStreaming = false,
  showDebugTrace = false,
  generationFormContext,
  aPlusBriefFormContext,
}: ChatMessageProps) {
  const isAssistant = message.role === "assistant";
  const attachments = message.attachments ?? [];
  const agentName = "脑生科技超级小微";
  const userNote = message.userNote;
  const debugTrace = message.debugTrace;
  const reasoning = message.reasoning?.trim();
  const [isReasoningOpen, setIsReasoningOpen] = useState(isStreaming);
  const [isTraceOpen, setIsTraceOpen] = useState(false);
  const reasoningContentRef = useRef<HTMLDivElement | null>(null);
  const hasTrace = Boolean(
    debugTrace &&
      (debugTrace.referenceResolution ||
        debugTrace.planning ||
        debugTrace.generation ||
        debugTrace.errorMessage),
  );

  useEffect(() => {
    if (!isStreaming || !isReasoningOpen || !reasoningContentRef.current) {
      return;
    }
    reasoningContentRef.current.scrollTop = reasoningContentRef.current.scrollHeight;
  }, [isReasoningOpen, isStreaming, reasoning]);

  return (
    <article className={`msg-row${isAssistant ? " assistant" : " user"}`}>
      <div className={`msg-avatar ${isAssistant ? "agent" : "user"}`}>
        {isAssistant ? "AI" : "USR"}
      </div>

      <div className="msg-body">
        <div className="msg-name">
          {isAssistant ? `root@xiaowei / ${agentName}` : "user@local"} · {message.createdAt}
        </div>

        {!isAssistant && attachments.length ? (
          <div className="msg-image-strip">
            {attachments.map((asset) => (
              <button
                key={asset.id}
                className="msg-image-button"
                type="button"
                onClick={() => onPreviewAsset(asset)}
              >
                <img
                  className="msg-image-attach"
                  src={asset.url}
                  alt={asset.alt}
                  width={asset.width}
                  height={asset.height}
                />
              </button>
            ))}
          </div>
        ) : null}

        {isAssistant && (reasoning || isStreaming) ? (
          <div className={`agent-reasoning${isStreaming ? " is-streaming" : ""}`}>
            <button
              className="agent-reasoning-toggle"
              type="button"
              aria-expanded={isReasoningOpen}
              onClick={() => setIsReasoningOpen((current) => !current)}
            >
              <span className="agent-reasoning-title">
                <span className="agent-reasoning-status" aria-hidden="true" />
                {isStreaming && !message.text ? "正在思考" : "思考过程"}
              </span>
              <span>{isReasoningOpen ? "收起 −" : "展开 +"}</span>
            </button>
            {isReasoningOpen ? (
              <div
                ref={reasoningContentRef}
                className="agent-reasoning-content"
                aria-live={isStreaming ? "polite" : undefined}
              >
                {reasoning || "正在读取消息与会话上下文…"}
                {isStreaming && !message.text ? (
                  <span className="stream-caret" aria-hidden="true" />
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}

        {message.text ? (
          <div className="bubble" aria-live={isStreaming ? "polite" : undefined}>
            {isAssistant ? (
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  a: ({ children, ...props }) => (
                    <a {...props} target="_blank" rel="noreferrer">
                      {children}
                    </a>
                  ),
                }}
              >
                {message.text}
              </ReactMarkdown>
            ) : (
              <p>{message.text}</p>
            )}
            {isAssistant && isStreaming ? (
              <span className="stream-caret" aria-hidden="true" />
            ) : null}
          </div>
        ) : null}

        {isAssistant && attachments.length
          ? attachments.map((asset) => (
              <figure className="gen-image-wrap" key={asset.id}>
                <button
                  className="gen-image-button"
                  type="button"
                  onClick={() => onPreviewAsset(asset)}
                >
                  <img
                    className="gen-image"
                    src={asset.url}
                    alt={asset.alt}
                    width={asset.width}
                    height={asset.height}
                  />
                </button>
                <figcaption className="gen-image-bar">
                  <span className="gen-label">{asset.label}</span>
                  <button
                    className="gen-action"
                    type="button"
                    onClick={() => onPreviewAsset(asset)}
                  >
                    [ OPEN ]
                  </button>
                </figcaption>
              </figure>
            ))
          : null}

        {userNote ? <div className="bubble-hint">{userNote}</div> : null}

        {isAssistant && message.generationForm && generationFormContext ? (
          <GenerationParamsForm
            form={message.generationForm}
            aspectRatios={generationFormContext.aspectRatios}
            resolutions={generationFormContext.resolutions}
            disabled={generationFormContext.disabled}
            onSubmit={(params) => generationFormContext.onSubmit(message.id, params)}
          />
        ) : null}

        {isAssistant && message.aPlusBriefForm && aPlusBriefFormContext ? (
          <APlusBriefForm
            form={message.aPlusBriefForm}
            disabled={aPlusBriefFormContext.disabled}
            onSubmit={(values) => aPlusBriefFormContext.onSubmit(message.id, values)}
          />
        ) : null}

        {showDebugTrace && hasTrace ? (
          <div className="agent-trace">
            <button
              className="agent-trace-toggle"
              type="button"
              onClick={() => setIsTraceOpen((current) => !current)}
            >
              {isTraceOpen ? "[-] CLOSE_TRACE" : "[+] OPEN_TRACE"}
            </button>
            {isTraceOpen ? (
              <pre className="agent-trace-detail">
                {JSON.stringify(debugTrace, null, 2)}
              </pre>
            ) : null}
          </div>
        ) : null}
      </div>
    </article>
  );
}
