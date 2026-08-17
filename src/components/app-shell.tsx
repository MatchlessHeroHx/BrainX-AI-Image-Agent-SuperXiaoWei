"use client";

import { useEffect, useRef, useState, type DragEvent } from "react";
import { ChatComposer } from "@/components/chat-composer";
import { ChatMessage } from "@/components/chat-message";
import type { GenerationFormSubmit } from "@/components/generation-params-form";
import { GeneratedHistory, type HistoryFilter } from "@/components/generated-history";
import { ImagePreviewModal } from "@/components/image-preview-modal";
import { SessionSidebar } from "@/components/session-sidebar";
import { IMAGE_AGENT_UI_PROMPTS } from "@/lib/agent/ui-prompt-config";
import type {
  APlusBriefValues,
  ConversationMessage,
  ImageAsset,
  WorkspaceState,
} from "@/lib/types";

type AppShellProps = {
  initialWorkspace: WorkspaceState;
};

type WorkspaceResponse = {
  ok: boolean;
  workspace?: WorkspaceState;
  error?: string;
};

type PendingAttachment = {
  id: string;
  name: string;
  url: string;
};

type PendingSubmission = {
  id: string;
  text: string;
  attachments: PendingAttachment[];
};

type StreamingAssistantState = {
  reasoning: string;
  text: string;
};

type ProgressStep = {
  label: string;
  detail: string;
};

type ProgressFact = {
  label: string;
  value: string;
};

type AgentWorkKind =
  | "session"
  | "receiving"
  | "thinking"
  | "planning"
  | "responding"
  | "generating"
  | "saving";

type AgentWorkStatus = {
  kind: AgentWorkKind;
  title: string;
  detail: string;
  facts?: ProgressFact[];
  steps: ProgressStep[];
  activeStep: number;
  visual: "compact" | "image-generation";
};

const INITIAL_PROMPTS = IMAGE_AGENT_UI_PROMPTS.initialPrompts;
const REFERENCE_PROMPTS = IMAGE_AGENT_UI_PROMPTS.referencePrompts;

const AGENT_DISPLAY_NAME = "脑生科技超级小微";
const IMAGE_MODEL_PREFERENCE_STORAGE_KEY = "image-agent.image-model-preference";
const AGENT_MODEL_PREFERENCE_STORAGE_KEY = "image-agent.agent-model-preference";

type ModelPreference = {
  providerId: string;
  modelId: string;
};

type ImageModelPreference = ModelPreference;
type AgentModelPreference = ModelPreference;

type ImageModelOption = ImageModelPreference & {
  providerName: string;
  modelName: string;
  configured: boolean;
};

type AgentModelOption = AgentModelPreference & {
  providerName: string;
  modelName: string;
  configured: boolean;
  supportsVision: boolean;
};

const fetchWorkspace = async (input: RequestInfo | URL, init?: RequestInit) => {
  const response = await fetch(input, init);
  const payload = (await response.json()) as WorkspaceResponse;

  if (!response.ok || !payload.ok || !payload.workspace) {
    throw new Error(payload.error ?? "Workspace request failed.");
  }

  return payload.workspace;
};

type StreamEvent =
  | {
      type: "plan_step";
      step: "receive" | "resolve_references" | "plan" | "generate" | "persist";
      status: "start" | "end";
      detail?: string;
    }
  | {
      type: "image_ready";
      asset: ImageAsset;
      index: number;
      total: number;
    }
  | { type: "reasoning_delta"; delta: string }
  | { type: "text_delta"; delta: string }
  | { type: "workspace_state"; state: WorkspaceState }
  | { type: "error"; error: { code: string; message: string; recoverable: boolean } }
  | { type: "done" };

const parseSseChunks = (buffer: string): { events: StreamEvent[]; remainder: string } => {
  const events: StreamEvent[] = [];
  let cursor = 0;

  while (true) {
    const boundary = buffer.indexOf("\n\n", cursor);
    if (boundary === -1) {
      break;
    }
    const chunk = buffer.slice(cursor, boundary);
    cursor = boundary + 2;

    const dataLines = chunk
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim());

    if (!dataLines.length) {
      continue;
    }

    try {
      const event = JSON.parse(dataLines.join("\n")) as StreamEvent;
      events.push(event);
    } catch {
      // skip malformed events
    }
  }

  return { events, remainder: buffer.slice(cursor) };
};

const PLAN_STEP_COPY: Record<string, { start: string; end: string }> = {
  receive: {
    start: "正在接收这条消息和上传图。",
    end: "上传图已就位。",
  },
  resolve_references: {
    start: "正在判断你说的「上一张/原图」指的是哪一张。",
    end: "已确定本轮参考关系。",
  },
  plan: {
    start: "正在理解本轮意图、组织思路。",
    end: "已想清楚下一步要做什么。",
  },
  generate: {
    start: "正在调用图像模型生成结果。",
    end: "图像生成阶段已完成。",
  },
  persist: {
    start: "正在落地到对话记录。",
    end: "结果已写回对话。",
  },
};

const describePlanStep = (
  step: keyof typeof PLAN_STEP_COPY,
  status: "start" | "end",
) => {
  return PLAN_STEP_COPY[step]?.[status];
};

const submitMessageStream = async (
  url: string,
  formData: FormData,
  onEvent: (event: StreamEvent) => void,
): Promise<void> => {
  const response = await fetch(url, {
    method: "POST",
    headers: { Accept: "text/event-stream" },
    body: formData,
  });

  if (!response.ok || !response.body) {
    let detail = "Message stream request failed.";
    try {
      const fallback = await response.json();
      detail = fallback?.error ?? detail;
    } catch {
      // ignore parse error
    }
    throw new Error(detail);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    const { events, remainder } = parseSseChunks(buffer);
    buffer = remainder;
    for (const event of events) {
      onEvent(event);
      if (event.type === "done") {
        return;
      }
    }
  }

  buffer += decoder.decode();
  const tail = parseSseChunks(buffer);
  for (const event of tail.events) {
    onEvent(event);
  }
};

const buildAPlusBriefSubmissionText = (values: APlusBriefValues) =>
  [
    "电商图方案信息已确认：",
    values.productName ? `产品名称：${values.productName}` : undefined,
    values.sellingPoints ? `重点突出的卖点：${values.sellingPoints}` : undefined,
    values.targetCountry ? `目标国家 / 地区：${values.targetCountry}` : undefined,
    values.salesPlatform ? `销售平台：${values.salesPlatform}` : undefined,
    Object.values(values).some(Boolean)
      ? "请先基于这些信息生成电商图方案。"
      : "用户未补充额外字段，请基于已有产品图、上下文和可调整假设生成电商图方案。",
  ]
    .filter(Boolean)
    .join("\n");

const genericProgress = (title: string, detail: string): AgentWorkStatus => ({
  kind: "session",
  title,
  detail,
  activeStep: 0,
  visual: "compact",
  steps: [
    {
      label: title,
      detail,
    },
  ],
});

function AgentProgressCard({ progress }: { progress: AgentWorkStatus }) {
  const isGenerating = progress.kind === "generating" || progress.visual === "image-generation";
  const phaseLabel = isGenerating ? "正在生图" : "正在思考";

  return (
    <div className="msg-row assistant">
      <div className="msg-avatar agent">AI</div>
      <div className="msg-body">
        <div className="msg-name">root@xiaowei · {phaseLabel}</div>
        <div
          className={`bubble agent-progress-bubble${isGenerating ? " is-generating" : " is-thinking"}`}
          aria-live="polite"
        >
          <div className="agent-progress-head">
            <div>
              <span className={`agent-phase-tag ${isGenerating ? "generating" : "thinking"}`}>
                {isGenerating ? "[RENDER]" : "[PROCESS]"}
              </span>
              <strong>{progress.title}</strong>
              <span>{progress.detail}</span>
            </div>
            <div className="typing" aria-hidden="true">
              <span />
              <span />
              <span />
            </div>
          </div>

          {progress.facts?.length ? (
            <dl className="agent-progress-facts">
              {progress.facts.map((fact) => (
                <div key={fact.label}>
                  <dt>{fact.label}</dt>
                  <dd>{fact.value}</dd>
                </div>
              ))}
            </dl>
          ) : null}

          <ol className="agent-progress-steps">
            {progress.steps.map((step, index) => (
              <li
                key={step.label}
                className={
                  index < progress.activeStep
                    ? "done"
                    : index === progress.activeStep
                      ? "active"
                      : ""
                }
              >
                <span className="agent-progress-dot" />
                <div>
                  <strong>{step.label}</strong>
                  <span>{index === progress.activeStep ? step.detail : ""}</span>
                </div>
              </li>
            ))}
          </ol>

          {progress.visual === "image-generation" ? (
            <div className="agent-generation-status">
              <strong>图片生成已开始</strong>
              <span>生成完成后会自动保存，并展示在对话和右侧历史里。</span>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function PendingUserMessage({ submission }: { submission: PendingSubmission }) {
  return (
    <article className="msg-row user pending-user-message">
      <div className="msg-avatar user">USR</div>
      <div className="msg-body">
        <div className="msg-name">user@local · [TX_PENDING]</div>

        {submission.attachments.length ? (
          <div className="msg-image-strip">
            {submission.attachments.map((attachment) => (
              <div className="msg-image-button pending" key={attachment.id}>
                <img
                  className="msg-image-attach"
                  src={attachment.url}
                  alt={attachment.name}
                />
              </div>
            ))}
          </div>
        ) : null}

        {submission.text ? (
          <div className="bubble">
            <p>{submission.text}</p>
          </div>
        ) : null}
      </div>
    </article>
  );
}

function buildImageModelOptions(workspace: WorkspaceState): ImageModelOption[] {
  return workspace.runtime.imageProviders.flatMap((provider) =>
    provider.models.map((model) => ({
      providerId: provider.id,
      providerName: provider.displayName,
      modelId: model.id,
      modelName: model.displayName,
      configured: Boolean(provider.configured),
    })),
  );
}

function buildAgentModelOptions(workspace: WorkspaceState): AgentModelOption[] {
  return workspace.runtime.agentProviders.flatMap((provider) =>
    provider.models.map((model) => ({
      providerId: provider.id,
      providerName: provider.displayName,
      modelId: model.id,
      modelName: model.displayName,
      configured: Boolean(provider.configured),
      supportsVision: model.capabilities.vision,
    })),
  );
}

function isSameModelPreference(a: ModelPreference, b: ModelPreference) {
  return a.providerId === b.providerId && a.modelId === b.modelId;
}

function ModelPreferenceModal({
  disabled,
  agentOptions,
  agentValue,
  imageOptions,
  imageValue,
  onClose,
  onSelectAgent,
  onSelectImage,
}: {
  disabled: boolean;
  agentOptions: AgentModelOption[];
  agentValue: AgentModelPreference;
  imageOptions: ImageModelOption[];
  imageValue: ImageModelPreference;
  onClose: () => void;
  onSelectAgent: (nextValue: AgentModelPreference) => void;
  onSelectImage: (nextValue: ImageModelPreference) => void;
}) {
  return (
    <div className="settings-mask" role="presentation" onMouseDown={onClose}>
      <section
        aria-label="模型偏好设置"
        className="settings-panel"
        role="dialog"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="settings-head">
          <div>
            <strong>{"// MODEL_CONFIG"}</strong>
            <span>选择 Agent 基础模型和图像渲染引擎</span>
          </div>
          <button className="settings-close" type="button" aria-label="关闭" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="model-options">
          <div className="model-section-title">$ list --agent-models</div>
          {agentOptions.map((option) => {
            const selected = isSameModelPreference(agentValue, option);

            return (
              <button
                className={`model-option${selected ? " selected" : ""}`}
                disabled={disabled || !option.configured}
                key={`${option.providerId}:${option.modelId}`}
                type="button"
                onClick={() => onSelectAgent(option)}
              >
                <span className="model-radio" aria-hidden="true" />
                <span className="model-option-main">
                  <strong>{option.modelName}</strong>
                  <span>
                    {option.providerName} · {option.supportsVision ? "可直接看图" : "文本规划"}
                  </span>
                </span>
                <span
                  className={`model-status${option.configured ? " ready" : ""}`}
                  title={
                    option.configured
                      ? "已配置密钥，可选用；不代表本次调用一定成功"
                      : "未检测到该服务商的 API 密钥，无法使用"
                  }
                >
                  {option.configured ? "已配置" : "未配置"}
                </span>
              </button>
            );
          })}

          <div className="model-section-title">$ list --image-models</div>
          {imageOptions.map((option) => {
            const selected = isSameModelPreference(imageValue, option);

            return (
              <button
                className={`model-option${selected ? " selected" : ""}`}
                disabled={disabled}
                key={`${option.providerId}:${option.modelId}`}
                type="button"
                onClick={() => onSelectImage(option)}
              >
                <span className="model-radio" aria-hidden="true" />
                <span className="model-option-main">
                  <strong>{option.modelName}</strong>
                  <span>{option.providerName}</span>
                </span>
                <span
                  className={`model-status${option.configured ? " ready" : ""}`}
                  title={
                    option.configured
                      ? "已配置密钥，可选用；不代表本次调用一定成功"
                      : "未检测到该服务商的 API 密钥，无法使用"
                  }
                >
                  {option.configured ? "已配置" : "未配置"}
                </span>
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
}

export function AppShell({ initialWorkspace }: AppShellProps) {
  const [workspace, setWorkspace] = useState(initialWorkspace);
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [agentProgress, setAgentProgress] = useState<AgentWorkStatus | null>(null);
  const [pendingSubmission, setPendingSubmission] = useState<PendingSubmission | null>(null);
  const [streamingAssistant, setStreamingAssistant] =
    useState<StreamingAssistantState | null>(null);
  const [selectedReferenceIds, setSelectedReferenceIds] = useState<string[]>([]);
  const [previewAsset, setPreviewAsset] = useState<ImageAsset | null>(null);
  const [prefillPrompt, setPrefillPrompt] = useState<{ id: number; text: string } | null>(null);
  const [incomingFiles, setIncomingFiles] = useState<{ id: number; files: File[] } | null>(null);
  const [activeHistoryFilter, setActiveHistoryFilter] = useState<HistoryFilter>("all");
  const [isDraggingFiles, setIsDraggingFiles] = useState(false);
  const [isModelSettingsOpen, setIsModelSettingsOpen] = useState(false);
  const [showDebugTrace, setShowDebugTrace] = useState(false);
  const [imageModelPreference, setImageModelPreference] = useState<ImageModelPreference>({
    providerId: initialWorkspace.runtime.imageProviderId,
    modelId: initialWorkspace.runtime.imageModelId,
  });
  const [agentModelPreference, setAgentModelPreference] = useState<AgentModelPreference>({
    providerId: initialWorkspace.runtime.agentProviderId,
    modelId: initialWorkspace.runtime.agentModelId,
  });
  const dragDepthRef = useRef(0);
  const pendingAttachmentUrlsRef = useRef<string[]>([]);
  const progressTimersRef = useRef<Array<ReturnType<typeof setTimeout>>>([]);
  const chatEndRef = useRef<HTMLDivElement | null>(null);

  const selectedReferences = workspace.history.filter((entry) =>
    selectedReferenceIds.includes(entry.asset.id),
  );
  const imageModelOptions = buildImageModelOptions(workspace);
  const agentModelOptions = buildAgentModelOptions(workspace);
  const selectedImageModel =
    imageModelOptions.find((option) => isSameModelPreference(option, imageModelPreference)) ??
    imageModelOptions.find(
      (option) =>
        option.providerId === workspace.runtime.imageProviderId &&
        option.modelId === workspace.runtime.imageModelId,
    ) ??
    imageModelOptions[0];
  const selectedAgentModel =
    agentModelOptions.find((option) => isSameModelPreference(option, agentModelPreference)) ??
    agentModelOptions.find(
      (option) =>
        option.providerId === workspace.runtime.agentProviderId &&
        option.modelId === workspace.runtime.agentModelId,
    ) ??
    agentModelOptions[0];
  const selectedApiConfigured = selectedImageModel?.configured ?? workspace.runtime.apiKeyConfigured;
  // Capabilities of the currently-selected image model drive the parameter form
  // options, so the form always reflects what the active model can actually do.
  const selectedModelCapabilities = (() => {
    const provider = workspace.runtime.imageProviders.find(
      (entry) => entry.id === selectedImageModel?.providerId,
    );
    const model = provider?.models.find((entry) => entry.id === selectedImageModel?.modelId);
    return {
      aspectRatios: model?.capabilities.aspectRatios ?? ["1:1"],
      resolutions: model?.capabilities.resolutions ?? [],
    };
  })();
  const quickPrompts = selectedReferences.length ? REFERENCE_PROMPTS : INITIAL_PROMPTS;
  const activeSkill = workspace.availableSkills.find(
    (skill) => skill.id === workspace.currentSession.activeSkillId,
  );
  const hasUserMessages = workspace.currentSession.messages.some((message) => message.role === "user");
  const showWelcome = !hasUserMessages && workspace.history.length === 0 && !pendingSubmission;
  const visibleMessages = showWelcome
    ? workspace.currentSession.messages.filter((message) => message.role !== "assistant")
    : workspace.currentSession.messages;
  const streamingMessage: ConversationMessage | null = streamingAssistant
    ? {
        id: "streaming-assistant",
        role: "assistant",
        text: streamingAssistant.text,
        reasoning: streamingAssistant.reasoning,
        createdAt: "LIVE",
        mode: "discuss",
      }
    : null;
  const previewIsHistoryAsset = previewAsset
    ? workspace.history.some((entry) => entry.asset.id === previewAsset.id)
    : false;
  const previewIsSelected = previewAsset
    ? selectedReferenceIds.includes(previewAsset.id)
    : false;

  useEffect(() => {
    return () => {
      pendingAttachmentUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
      progressTimersRef.current.forEach((timer) => clearTimeout(timer));
    };
  }, []);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(IMAGE_MODEL_PREFERENCE_STORAGE_KEY);

      if (!raw) {
        return;
      }

      const saved = JSON.parse(raw) as Partial<ImageModelPreference>;
      const savedPreference = {
        providerId: saved.providerId ?? "",
        modelId: saved.modelId ?? "",
      };

      if (
        buildImageModelOptions(initialWorkspace).some((option) =>
          isSameModelPreference(option, savedPreference),
        )
      ) {
        setImageModelPreference(savedPreference);
      }
    } catch {
      window.localStorage.removeItem(IMAGE_MODEL_PREFERENCE_STORAGE_KEY);
    }
  }, [initialWorkspace]);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(AGENT_MODEL_PREFERENCE_STORAGE_KEY);

      if (!raw) {
        return;
      }

      const saved = JSON.parse(raw) as Partial<AgentModelPreference>;
      const savedPreference = {
        providerId: saved.providerId ?? "",
        modelId: saved.modelId ?? "",
      };

      const savedOption = buildAgentModelOptions(initialWorkspace).find((option) =>
        isSameModelPreference(option, savedPreference),
      );

      if (savedOption?.configured) {
        setAgentModelPreference(savedPreference);
      } else {
        window.localStorage.removeItem(AGENT_MODEL_PREFERENCE_STORAGE_KEY);
      }
    } catch {
      window.localStorage.removeItem(AGENT_MODEL_PREFERENCE_STORAGE_KEY);
    }
  }, [initialWorkspace]);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem("image-agent.debug-trace");
      if (stored === "1") {
        setShowDebugTrace(true);
      }
    } catch {
      // ignore localStorage failures (private browsing, etc.)
    }
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Cmd/Ctrl + Shift + D toggles developer trace panel
      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === "d") {
        event.preventDefault();
        setShowDebugTrace((current) => {
          const next = !current;
          try {
            window.localStorage.setItem("image-agent.debug-trace", next ? "1" : "0");
          } catch {
            // ignore
          }
          return next;
        });
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  useEffect(() => {
    if (!selectedImageModel) {
      return;
    }

    if (!isSameModelPreference(selectedImageModel, imageModelPreference)) {
      setImageModelPreference({
        providerId: selectedImageModel.providerId,
        modelId: selectedImageModel.modelId,
      });
    }
  }, [imageModelPreference, selectedImageModel]);

  useEffect(() => {
    if (!selectedAgentModel) {
      return;
    }

    if (!isSameModelPreference(selectedAgentModel, agentModelPreference)) {
      setAgentModelPreference({
        providerId: selectedAgentModel.providerId,
        modelId: selectedAgentModel.modelId,
      });
    }
  }, [agentModelPreference, selectedAgentModel]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ block: "end" });
  }, [
    workspace.currentSession.id,
    workspace.currentSession.messages.length,
    pendingSubmission?.id,
    agentProgress?.activeStep,
    streamingAssistant?.reasoning.length,
    streamingAssistant?.text.length,
  ]);

  const clearProgressTimers = () => {
    progressTimersRef.current.forEach((timer) => clearTimeout(timer));
    progressTimersRef.current = [];
  };

  const clearPendingSubmission = () => {
    pendingAttachmentUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    pendingAttachmentUrlsRef.current = [];
    setPendingSubmission(null);
  };

  const startPendingSubmission = (text: string, files: File[]) => {
    clearPendingSubmission();
    const attachments = files.map((file, index) => {
      const url = URL.createObjectURL(file);
      pendingAttachmentUrlsRef.current.push(url);
      return {
        id: `${file.name}-${file.size}-${file.lastModified}-${index}`,
        name: file.name || `上传图片 ${index + 1}`,
        url,
      };
    });

    setPendingSubmission({
      id: `${Date.now()}-${Math.random()}`,
      text,
      attachments,
    });
  };

  const startMessageProgress = () => {
    setAgentProgress(null);
    setStreamingAssistant({ reasoning: "", text: "" });
  };

  const applyAssistantStreamDelta = (event: StreamEvent) => {
    if (event.type !== "reasoning_delta" && event.type !== "text_delta") {
      return false;
    }

    setStreamingAssistant((current) => {
      const next = current ?? { reasoning: "", text: "" };
      return event.type === "reasoning_delta"
        ? { ...next, reasoning: next.reasoning + event.delta }
        : { ...next, text: next.text + event.delta };
    });
    return true;
  };

  const runTask = async (
    task: () => Promise<WorkspaceState>,
    options: {
      progress?: AgentWorkStatus;
      onStartProgress?: () => void;
    } = {},
  ) => {
    setIsBusy(true);
    setError(null);
    clearProgressTimers();
    if (options.onStartProgress) {
      options.onStartProgress();
    } else {
      setAgentProgress(options.progress ?? null);
    }

    try {
      const nextWorkspace = await task();
      const validReferenceIds = new Set(nextWorkspace.history.map((entry) => entry.asset.id));
      setWorkspace(nextWorkspace);
      setSelectedReferenceIds((current) =>
        current.filter((assetId) => validReferenceIds.has(assetId)),
      );
      return true;
    } catch (taskError) {
      setError(taskError instanceof Error ? taskError.message : "Unknown request error.");
      return false;
    } finally {
      clearProgressTimers();
      setAgentProgress(null);
      setIsBusy(false);
    }
  };

  const queuePrompt = (text: string) => {
    setPrefillPrompt({ id: Date.now() + Math.random(), text });
  };

  const pushFilesToComposer = (files: File[]) => {
    if (!files.length) {
      return;
    }

    setIncomingFiles({
      id: Date.now() + Math.random(),
      files,
    });
  };

  const selectImageModelPreference = (nextValue: ImageModelPreference) => {
    setImageModelPreference(nextValue);
    window.localStorage.setItem(IMAGE_MODEL_PREFERENCE_STORAGE_KEY, JSON.stringify(nextValue));
  };

  const selectAgentModelPreference = (nextValue: AgentModelPreference) => {
    setAgentModelPreference(nextValue);
    window.localStorage.setItem(AGENT_MODEL_PREFERENCE_STORAGE_KEY, JSON.stringify(nextValue));
  };

  const selectConversationSkill = (skillId?: string) => {
    const normalizedSkillId = skillId?.trim() || undefined;

    if (normalizedSkillId === workspace.currentSession.activeSkillId) {
      return;
    }

    void runTask(() =>
      fetchWorkspace(`/api/conversations/${workspace.currentSession.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ activeSkillId: normalizedSkillId ?? null }),
      }),
      {
        progress: genericProgress(
          normalizedSkillId ? "正在启用 Skill" : "正在关闭 Skill",
          normalizedSkillId
            ? "正在把这个 Skill 加载到当前会话。"
            : "正在恢复为通用 Agent 会话。",
        ),
      },
    );
  };

  const hasDraggedFiles = (event: DragEvent<HTMLElement>) =>
    Array.from(event.dataTransfer.types).includes("Files");

  const submitGenerationForm = async (messageId: string, params: GenerationFormSubmit) => {
    setIsBusy(true);
    setError(null);
    clearProgressTimers();
    setAgentProgress({
      kind: "generating",
      title: IMAGE_AGENT_UI_PROMPTS.generatingStatus.title,
      detail: IMAGE_AGENT_UI_PROMPTS.generatingStatus.detail,
      steps: [
        {
          label: IMAGE_AGENT_UI_PROMPTS.generatingStatus.title,
          detail: IMAGE_AGENT_UI_PROMPTS.generatingStatus.detail,
        },
      ],
      activeStep: 0,
      visual: "image-generation",
    });

    const body = new FormData();
    body.set("aspectRatio", params.aspectRatio);
    body.set("resolution", params.resolution);
    body.set("outputCount", String(params.outputCount));
    if (selectedImageModel) {
      body.set("imageProviderId", selectedImageModel.providerId);
      body.set("imageModelId", selectedImageModel.modelId);
    }

    let receivedWorkspace: WorkspaceState | null = null;
    let streamError: string | null = null;

    try {
      await submitMessageStream(
        `/api/conversations/${workspace.currentSession.id}/messages/${messageId}/generate`,
        body,
        (event) => {
          if (event.type === "image_ready") {
            setAgentProgress((current) =>
              current
                ? {
                    ...current,
                    kind: "generating",
                    detail: `第 ${event.index + 1} 张图片已出（共 ${event.total} 张）。`,
                    visual: "image-generation",
                  }
                : current,
            );
          } else if (event.type === "workspace_state") {
            receivedWorkspace = event.state;
          } else if (event.type === "error") {
            streamError = event.error.message;
          }
        },
      );
    } catch (taskError) {
      streamError = taskError instanceof Error ? taskError.message : "Unknown request error.";
    } finally {
      clearProgressTimers();
      setAgentProgress(null);
      setIsBusy(false);
    }

    if (receivedWorkspace) {
      const nextWorkspace: WorkspaceState = receivedWorkspace;
      const validReferenceIds = new Set(nextWorkspace.history.map((entry) => entry.asset.id));
      setWorkspace(nextWorkspace);
      setSelectedReferenceIds((current) =>
        current.filter((assetId) => validReferenceIds.has(assetId)),
      );
    }

    if (streamError) {
      setError(streamError);
    }
  };

  const submitAPlusBriefForm = async (_messageId: string, values: APlusBriefValues) => {
    const text = buildAPlusBriefSubmissionText(values);

    startPendingSubmission(text, []);
    setIsBusy(true);
    setError(null);
    clearProgressTimers();
    startMessageProgress();

    const formData = new FormData();
    formData.set("text", text);
    for (const assetId of selectedReferenceIds) {
      formData.append("referenceAssetIds", assetId);
    }
    if (selectedImageModel) {
      formData.set("imageProviderId", selectedImageModel.providerId);
      formData.set("imageModelId", selectedImageModel.modelId);
    }
    if (selectedAgentModel) {
      formData.set("agentProviderId", selectedAgentModel.providerId);
      formData.set("agentModelId", selectedAgentModel.modelId);
    }
    if (activeSkill) {
      formData.set("activeSkillId", activeSkill.id);
    }

    let receivedWorkspace: WorkspaceState | null = null;
    let streamError: string | null = null;

    try {
      await submitMessageStream(
        `/api/conversations/${workspace.currentSession.id}/messages`,
        formData,
        (event) => {
          if (applyAssistantStreamDelta(event)) {
            return;
          }
          if (event.type === "plan_step") {
            setAgentProgress((current) => {
              if (!current) {
                return current;
              }
              const stepLabel = describePlanStep(event.step, event.status);
              return stepLabel ? { ...current, detail: stepLabel } : current;
            });
          } else if (event.type === "workspace_state") {
            receivedWorkspace = event.state;
          } else if (event.type === "error") {
            streamError = event.error.message;
          }
        },
      );
    } catch (taskError) {
      streamError = taskError instanceof Error ? taskError.message : "Unknown request error.";
    } finally {
      clearProgressTimers();
      setAgentProgress(null);
      setIsBusy(false);
    }

    if (receivedWorkspace) {
      const nextWorkspace: WorkspaceState = receivedWorkspace;
      const validReferenceIds = new Set(nextWorkspace.history.map((entry) => entry.asset.id));
      setWorkspace(nextWorkspace);
      setSelectedReferenceIds((current) =>
        current.filter((assetId) => validReferenceIds.has(assetId)),
      );
      clearPendingSubmission();
      setSelectedReferenceIds([]);
    } else {
      clearPendingSubmission();
    }
    setStreamingAssistant(null);

    if (streamError) {
      setError(streamError);
    }
  };

  const createConversation = () => {
    setSelectedReferenceIds([]);
    setPreviewAsset(null);
    setActiveHistoryFilter("all");

    void runTask(() =>
      fetchWorkspace("/api/conversations", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
      }),
      {
        progress: genericProgress("正在新建会话", "正在准备一个空白对话工作区。"),
      },
    );
  };

  const deleteConversation = (sessionId: string) => {
    const session = workspace.sessions.find((entry) => entry.id === sessionId);
    const confirmed = window.confirm(
      `确定删除「${session?.title ?? "这个会话"}」吗？相关对话和生成历史会一起删除。`,
    );

    if (!confirmed) {
      return;
    }

    setSelectedReferenceIds([]);
    setPreviewAsset(null);
    setActiveHistoryFilter("all");
    clearPendingSubmission();

    void runTask(() =>
      fetchWorkspace(`/api/conversations/${sessionId}`, {
        method: "DELETE",
      }),
      {
        progress: genericProgress("正在删除会话", "正在移除这段会话及其生成记录。"),
      },
    );
  };

  return (
    <>
      <main className="app">
        <SessionSidebar
          sessions={workspace.sessions}
          disabled={isBusy}
          onCreateConversation={createConversation}
          onSelectSession={(sessionId) => {
            setSelectedReferenceIds([]);
            setPreviewAsset(null);
            setActiveHistoryFilter("all");
            void runTask(() => fetchWorkspace(`/api/conversations/${sessionId}`), {
              progress: genericProgress("正在打开会话", "正在读取这段会话的上下文和历史结果。"),
            });
          }}
          onDeleteSession={deleteConversation}
        />

        <section
          className="main"
          onDragEnter={(event) => {
            if (!hasDraggedFiles(event)) {
              return;
            }

            event.preventDefault();
            dragDepthRef.current += 1;
            setIsDraggingFiles(true);
          }}
          onDragLeave={(event) => {
            if (!hasDraggedFiles(event)) {
              return;
            }

            event.preventDefault();
            dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);

            if (dragDepthRef.current === 0) {
              setIsDraggingFiles(false);
            }
          }}
          onDragOver={(event) => {
            if (!hasDraggedFiles(event)) {
              return;
            }

            event.preventDefault();
          }}
          onDrop={(event) => {
            if (!hasDraggedFiles(event)) {
              return;
            }

            event.preventDefault();
            dragDepthRef.current = 0;
            setIsDraggingFiles(false);
            pushFilesToComposer(
              Array.from(event.dataTransfer.files).filter((file) => file.type.startsWith("image/")),
            );
          }}
        >
          <div className="topbar">
            <div>
              <div className="topbar-title">
                <span aria-hidden="true">root@xiaowei:~/workspace$ </span>
                {workspace.currentSession.title}
              </div>
              <div className="topbar-meta">{workspace.currentSession.subtitle}</div>
            </div>

            <div className="topbar-actions">
              {activeSkill ? (
                <div
                  className="active-skill-chip"
                  key={activeSkill.id}
                  role="status"
                  aria-live="polite"
                  title={`${activeSkill.name} · v${activeSkill.version} · ${activeSkill.description}`}
                >
                  <span className="active-skill-indicator" aria-hidden="true" />
                  <span className="active-skill-chip-copy">
                    <span className="active-skill-chip-label">已加载技能</span>
                    <strong>{activeSkill.name}</strong>
                  </span>
                </div>
              ) : null}

              <button
                className="model-chip"
                type="button"
                aria-label="打开模型设置"
                title={`Agent: ${selectedAgentModel?.modelName ?? workspace.runtime.agentModel} · 图片: ${
                  selectedImageModel?.modelName ?? workspace.runtime.imageModel
                }`}
                onClick={() => setIsModelSettingsOpen(true)}
              >
                <span>[AGENT_MODEL] {selectedAgentModel?.modelName ?? workspace.runtime.agentModel}</span>
                <svg
                  aria-hidden="true"
                  fill="none"
                  height="14"
                  viewBox="0 0 24 24"
                  width="14"
                >
                  <path
                    d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z"
                    stroke="currentColor"
                    strokeWidth="2"
                  />
                  <path
                    d="M19.4 15a1.8 1.8 0 0 0 .36 2l.04.04a2 2 0 0 1-2.83 2.83l-.04-.04a1.8 1.8 0 0 0-2-.36 1.8 1.8 0 0 0-1.1 1.66V21a2 2 0 0 1-4 0v-.06a1.8 1.8 0 0 0-1.1-1.66 1.8 1.8 0 0 0-2 .36l-.04.04a2 2 0 0 1-2.83-2.83l.04-.04a1.8 1.8 0 0 0 .36-2 1.8 1.8 0 0 0-1.66-1.1H2.5a2 2 0 0 1 0-4h.06a1.8 1.8 0 0 0 1.66-1.1 1.8 1.8 0 0 0-.36-2l-.04-.04a2 2 0 0 1 2.83-2.83l.04.04a1.8 1.8 0 0 0 2 .36 1.8 1.8 0 0 0 1.1-1.66V2.5a2 2 0 0 1 4 0v.06a1.8 1.8 0 0 0 1.1 1.66 1.8 1.8 0 0 0 2-.36l.04-.04a2 2 0 0 1 2.83 2.83l-.04.04a1.8 1.8 0 0 0-.36 2 1.8 1.8 0 0 0 1.66 1.1h.06a2 2 0 0 1 0 4h-.06A1.8 1.8 0 0 0 19.4 15Z"
                    stroke="currentColor"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                  />
                </svg>
              </button>
              <button className="icon-btn" type="button" title="分享" aria-label="分享当前会话">
                <svg
                  aria-hidden="true"
                  fill="none"
                  height="16"
                  viewBox="0 0 24 24"
                  width="16"
                >
                  <circle cx="18" cy="5" r="3" stroke="currentColor" strokeWidth="2" />
                  <circle cx="6" cy="12" r="3" stroke="currentColor" strokeWidth="2" />
                  <circle cx="18" cy="19" r="3" stroke="currentColor" strokeWidth="2" />
                  <path
                    d="M8.59 13.51l6.83 3.98M15.41 6.51l-6.82 3.98"
                    stroke="currentColor"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                  />
                </svg>
              </button>
              <button className="icon-btn" type="button" title="更多" aria-label="更多操作">
                <svg
                  aria-hidden="true"
                  fill="none"
                  height="16"
                  viewBox="0 0 24 24"
                  width="16"
                >
                  <circle cx="12" cy="12" fill="currentColor" r="1.5" />
                  <circle cx="19" cy="12" fill="currentColor" r="1.5" />
                  <circle cx="5" cy="12" fill="currentColor" r="1.5" />
                </svg>
              </button>
            </div>
          </div>

          {error ? <div className="error-banner">{error}</div> : null}

          <div className="chat-wrap" id="chatWrap">
            <div className="chat" id="chat">
              {showWelcome ? (
                <section className="welcome">
                  <div className="welcome-emoji" aria-hidden="true">
                    <span>██╗███╗   ███╗ ██████╗</span>
                    <span>██║████╗ ████║██╔════╝</span>
                    <span>██║██╔████╔██║██║  ███╗</span>
                    <span>██║██║╚██╔╝██║██║   ██║</span>
                    <span>██║██║ ╚═╝ ██║╚██████╔╝</span>
                    <span>╚═╝╚═╝     ╚═╝ ╚═════╝</span>
                  </div>
                  <div className="welcome-kicker">[ IMAGE_CREATION_TERMINAL // READY ]</div>
                  <div className="welcome-title">输入一句需求，启动你的图像创作进程<span aria-hidden="true">_</span></div>
                  <div className="welcome-sub">
                    描述主体、场景、风格和情绪，或上传参考图继续迭代。系统会保存每次输出，并保持会话上下文。
                  </div>
                  <div className="prompt-suggestions">
                    {INITIAL_PROMPTS.map((item, index) => (
                      <button
                        key={item.label}
                        className="prompt-card"
                        type="button"
                        onClick={() => queuePrompt(item.prompt)}
                      >
                        <strong>&gt; run/{String(index + 1).padStart(2, "0")} {item.label}</strong>
                        {item.prompt}
                      </button>
                    ))}
                  </div>
                </section>
              ) : null}

              {visibleMessages.map((message) => (
                <ChatMessage
                  key={message.id}
                  message={message}
                  onPreviewAsset={(asset) => setPreviewAsset(asset)}
                  showDebugTrace={showDebugTrace}
                  generationFormContext={{
                    aspectRatios: selectedModelCapabilities.aspectRatios,
                    resolutions: selectedModelCapabilities.resolutions,
                    disabled: isBusy,
                    onSubmit: (messageId, params) => {
                      void submitGenerationForm(messageId, params);
                    },
                  }}
                  aPlusBriefFormContext={{
                    disabled: isBusy,
                    onSubmit: (messageId, values) => {
                      void submitAPlusBriefForm(messageId, values);
                    },
                  }}
                />
              ))}

              {pendingSubmission ? <PendingUserMessage submission={pendingSubmission} /> : null}

              {streamingMessage ? (
                <ChatMessage
                  message={streamingMessage}
                  isStreaming
                  onPreviewAsset={(asset) => setPreviewAsset(asset)}
                />
              ) : null}

              {!streamingMessage && isBusy && agentProgress ? (
                <AgentProgressCard progress={agentProgress} />
              ) : null}
              <div ref={chatEndRef} />
            </div>
          </div>

          <div className={`drag-overlay${isDraggingFiles ? " show" : ""}`} id="dragOverlay">
            <div className="drag-overlay-inner">
              <div className="drag-overlay-emoji">[ DROP_IMAGE_HERE ]</div>
              <div>释放文件后，{AGENT_DISPLAY_NAME} 会结合当前上下文载入图像</div>
            </div>
          </div>

          <ChatComposer
            apiKeyConfigured={selectedApiConfigured}
            disabled={isBusy}
            selectedReferences={selectedReferences.map((entry) => ({
              id: entry.asset.id,
              label: entry.title,
              url: entry.asset.url,
              alt: entry.asset.alt,
            }))}
            quickPrompts={quickPrompts}
            availableSkills={workspace.availableSkills}
            activeSkillId={activeSkill?.id}
            prefillPrompt={prefillPrompt}
            incomingFiles={incomingFiles}
            onSelectSkill={selectConversationSkill}
            onRemoveReference={(assetId) => {
              setSelectedReferenceIds((current) =>
                current.filter((selectedId) => selectedId !== assetId),
              );
            }}
            onSubmit={async ({ text, files }) => {
              startPendingSubmission(text, files);
              setIsBusy(true);
              setError(null);
              clearProgressTimers();
              startMessageProgress();

              const formData = new FormData();
              formData.set("text", text);
              for (const file of files) {
                formData.append("images", file);
              }
              for (const assetId of selectedReferenceIds) {
                formData.append("referenceAssetIds", assetId);
              }
              if (selectedImageModel) {
                formData.set("imageProviderId", selectedImageModel.providerId);
                formData.set("imageModelId", selectedImageModel.modelId);
              }
              if (selectedAgentModel) {
                formData.set("agentProviderId", selectedAgentModel.providerId);
                formData.set("agentModelId", selectedAgentModel.modelId);
              }
              if (activeSkill) {
                formData.set("activeSkillId", activeSkill.id);
              }

              let receivedWorkspace: WorkspaceState | null = null;
              let streamError: string | null = null;

              try {
                await submitMessageStream(
                  `/api/conversations/${workspace.currentSession.id}/messages`,
                  formData,
                  (event) => {
                    if (applyAssistantStreamDelta(event)) {
                      return;
                    }
                    if (event.type === "plan_step") {
                      setAgentProgress((current) => {
                        if (!current) {
                          return current;
                        }
                        const stepLabel = describePlanStep(event.step, event.status);
                        if (!stepLabel) {
                          return current;
                        }
                        return { ...current, detail: stepLabel };
                      });
                    } else if (event.type === "image_ready") {
                      setAgentProgress((current) =>
                        current
                          ? {
                              ...current,
                              kind: "generating",
                              detail: `第 ${event.index + 1} 张图片已出（共 ${event.total} 张）。`,
                              visual: "image-generation",
                            }
                          : current,
                      );
                    } else if (event.type === "workspace_state") {
                      receivedWorkspace = event.state;
                    } else if (event.type === "error") {
                      streamError = event.error.message;
                    }
                  },
                );
              } catch (taskError) {
                streamError =
                  taskError instanceof Error ? taskError.message : "Unknown request error.";
              } finally {
                clearProgressTimers();
                setAgentProgress(null);
                setIsBusy(false);
              }

              if (receivedWorkspace) {
                const nextWorkspace: WorkspaceState = receivedWorkspace;
                const validReferenceIds = new Set(
                  nextWorkspace.history.map((entry) => entry.asset.id),
                );
                setWorkspace(nextWorkspace);
                setSelectedReferenceIds((current) =>
                  current.filter((assetId) => validReferenceIds.has(assetId)),
                );
              }

              if (streamError) {
                setError(streamError);
              }

              setStreamingAssistant(null);

              if (!receivedWorkspace) {
                clearPendingSubmission();
                throw new Error(streamError ?? "Message submit failed.");
              }

              clearPendingSubmission();
              setSelectedReferenceIds([]);
            }}
          />
        </section>

        <GeneratedHistory
          activeFilter={activeHistoryFilter}
          history={workspace.history}
          disabled={isBusy}
          selectedAssetIds={selectedReferenceIds}
          onFilterChange={setActiveHistoryFilter}
          onPreviewAsset={(asset) => setPreviewAsset(asset)}
          onToggleReference={(assetId) => {
            setSelectedReferenceIds((current) =>
              current.includes(assetId)
                ? current.filter((selectedId) => selectedId !== assetId)
                : [...current, assetId].slice(-3),
            );
          }}
        />
      </main>

      <ImagePreviewModal
        asset={previewAsset}
        isReferenceSelected={previewIsSelected}
        onClose={() => setPreviewAsset(null)}
        onUseAsReference={
          previewIsHistoryAsset && previewAsset
            ? () => {
                setSelectedReferenceIds((current) =>
                  current.includes(previewAsset.id)
                    ? current
                    : [...current, previewAsset.id].slice(-3),
                );
                setPreviewAsset(null);
              }
            : null
        }
      />

      {isModelSettingsOpen ? (
        <ModelPreferenceModal
          disabled={isBusy}
          agentOptions={agentModelOptions}
          agentValue={
            selectedAgentModel
              ? {
                  providerId: selectedAgentModel.providerId,
                  modelId: selectedAgentModel.modelId,
                }
              : agentModelPreference
          }
          imageOptions={imageModelOptions}
          imageValue={
            selectedImageModel
              ? {
                  providerId: selectedImageModel.providerId,
                  modelId: selectedImageModel.modelId,
                }
              : imageModelPreference
          }
          onClose={() => setIsModelSettingsOpen(false)}
          onSelectAgent={(nextValue) => {
            selectAgentModelPreference(nextValue);
            setIsModelSettingsOpen(false);
          }}
          onSelectImage={(nextValue) => {
            selectImageModelPreference(nextValue);
            setIsModelSettingsOpen(false);
          }}
        />
      ) : null}
    </>
  );
}
