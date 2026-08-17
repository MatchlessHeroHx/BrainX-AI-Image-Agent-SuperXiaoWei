"use client";

import { useEffect, useRef, useState } from "react";
import { IMAGE_AGENT_UI_PROMPTS } from "@/lib/agent/ui-prompt-config";
import type { SkillSummary } from "@/lib/types";

type QuickPrompt = {
  label: string;
  prompt: string;
};

type PromptSeed = {
  id: number;
  text: string;
};

type IncomingFiles = {
  id: number;
  files: File[];
};

type SelectedReference = {
  id: string;
  label: string;
  url: string;
  alt: string;
};

type ChatComposerProps = {
  apiKeyConfigured: boolean;
  disabled?: boolean;
  selectedReferences: SelectedReference[];
  quickPrompts: QuickPrompt[];
  availableSkills: SkillSummary[];
  activeSkillId?: string;
  prefillPrompt?: PromptSeed | null;
  incomingFiles?: IncomingFiles | null;
  onSelectSkill: (skillId?: string) => void;
  onRemoveReference: (assetId: string) => void;
  onSubmit: (payload: { text: string; files: File[] }) => Promise<void>;
};

export function ChatComposer({
  apiKeyConfigured,
  disabled = false,
  selectedReferences,
  quickPrompts,
  availableSkills,
  activeSkillId,
  prefillPrompt = null,
  incomingFiles = null,
  onSelectSkill,
  onRemoveReference,
  onSubmit,
}: ChatComposerProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const skillPickerRef = useRef<HTMLDivElement | null>(null);
  const isComposingRef = useRef(false);
  const [text, setText] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [filePreviews, setFilePreviews] = useState<string[]>([]);
  const [isSending, setIsSending] = useState(false);
  const [isSkillMenuOpen, setIsSkillMenuOpen] = useState(false);
  const [inspirationIndex, setInspirationIndex] = useState(0);
  const activeSkill = availableSkills.find((skill) => skill.id === activeSkillId);

  useEffect(() => {
    const urls = files.map((file) => URL.createObjectURL(file));
    setFilePreviews(urls);

    return () => {
      urls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [files]);

  useEffect(() => {
    if (!prefillPrompt) {
      return;
    }

    setText(prefillPrompt.text);
    requestAnimationFrame(() => textareaRef.current?.focus());
  }, [prefillPrompt]);

  useEffect(() => {
    if (!incomingFiles?.files.length) {
      return;
    }

    setFiles((current) => [...current, ...incomingFiles.files]);
    requestAnimationFrame(() => textareaRef.current?.focus());
  }, [incomingFiles]);

  useEffect(() => {
    const textarea = textareaRef.current;

    if (!textarea) {
      return;
    }

    textarea.style.height = "0px";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 160)}px`;
  }, [text]);

  useEffect(() => {
    if (!isSkillMenuOpen) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (skillPickerRef.current?.contains(event.target as Node)) {
        return;
      }

      setIsSkillMenuOpen(false);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsSkillMenuOpen(false);
      }
    };

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isSkillMenuOpen]);

  useEffect(() => {
    if (disabled || isSending) {
      setIsSkillMenuOpen(false);
    }
  }, [disabled, isSending]);

  const clearComposer = () => {
    setText("");
    setFiles([]);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const appendFiles = (nextFiles: File[]) => {
    const acceptedFiles = nextFiles.filter((file) => file.type.startsWith("image/"));

    if (!acceptedFiles.length) {
      return;
    }

    setFiles((current) => [...current, ...acceptedFiles]);

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleSubmit = async () => {
    const nextText = text.trim();

    if ((!nextText && files.length === 0) || disabled || isSending) {
      return;
    }

    setIsSending(true);

    try {
      await onSubmit({
        text: nextText,
        files,
      });
      clearComposer();
    } finally {
      setIsSending(false);
    }
  };

  const canSubmit = Boolean(text.trim() || files.length);
  const selectSkill = (skillId?: string) => {
    setIsSkillMenuOpen(false);
    onSelectSkill(skillId);
    requestAnimationFrame(() => textareaRef.current?.focus());
  };

  return (
    <div className="composer-wrap">
      <div className="composer" id="composer">
        {selectedReferences.length || files.length ? (
          <div className="composer-attachments" id="attachments">
            {selectedReferences.map((reference) => (
              <div className="attachment is-reference" key={reference.id} title={reference.label}>
                <img alt={reference.alt} src={reference.url} />
                <span className="attachment-badge">参考</span>
                <button
                  className="attachment-remove"
                  type="button"
                  aria-label={`移除参考图：${reference.label}`}
                  disabled={disabled || isSending}
                  onClick={() => onRemoveReference(reference.id)}
                >
                  ×
                </button>
              </div>
            ))}

            {files.map((file, index) => (
              <div
                className="attachment"
                key={`${file.name}-${file.size}-${file.lastModified}`}
                title={file.name}
              >
                <img alt={file.name} src={filePreviews[index]} />
                <span className="attachment-badge">上传</span>
                <button
                  className="attachment-remove"
                  type="button"
                  aria-label={`移除上传图：${file.name}`}
                  disabled={disabled || isSending}
                  onClick={() => {
                    setFiles((current) => current.filter((_, currentIndex) => currentIndex !== index));
                  }}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        ) : null}

        <div className="composer-command-line">
          <span className="composer-prompt" aria-hidden="true">user@brainx:~$</span>
          <textarea
            ref={textareaRef}
            className="composer-input"
            value={text}
            rows={1}
            placeholder="输入画面描述，或拖入图像..."
            disabled={disabled || isSending}
            aria-label="输入图像创作需求"
            onChange={(event) => setText(event.target.value)}
            onCompositionStart={() => {
              isComposingRef.current = true;
            }}
            onCompositionEnd={() => {
              isComposingRef.current = false;
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                if (
                  isComposingRef.current ||
                  event.nativeEvent.isComposing ||
                  event.keyCode === 229
                ) {
                  return;
                }

                event.preventDefault();
                void handleSubmit();
              }
            }}
          />
        </div>

        <div className="composer-bar">
          <div className="composer-bar-left">
            <div className="skill-picker" ref={skillPickerRef}>
              <button
                className={`composer-tool skill-trigger${activeSkill ? " active" : ""}`}
                type="button"
                title={activeSkill ? `当前 Skill：${activeSkill.name}` : "选择 Skill"}
                aria-label={
                  activeSkill
                    ? `当前已加载技能：${activeSkill.name}，点击切换`
                    : "选择当前会话技能"
                }
                aria-haspopup="menu"
                aria-expanded={isSkillMenuOpen}
                onClick={() => setIsSkillMenuOpen((current) => !current)}
                disabled={disabled || isSending || !availableSkills.length}
              >
                <svg
                  aria-hidden="true"
                  fill="none"
                  height="16"
                  viewBox="0 0 24 24"
                  width="16"
                >
                  <path
                    d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Z"
                    stroke="currentColor"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                  />
                  <path
                    d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15Z"
                    stroke="currentColor"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                  />
                </svg>
                {activeSkill ? (
                  <span className="skill-trigger-copy">
                    <span>已加载</span>
                    <strong>{activeSkill.name}</strong>
                  </span>
                ) : null}
              </button>

              {isSkillMenuOpen ? (
                <div className="skill-menu" role="menu" aria-label="选择当前会话 Skill">
                  <button
                    className={`skill-option${!activeSkill ? " selected" : ""}`}
                    type="button"
                    role="menuitemradio"
                    aria-checked={!activeSkill}
                    onClick={() => selectSkill(undefined)}
                  >
                    <span className="skill-option-radio" aria-hidden="true" />
                    <span className="skill-option-main">
                      <strong>通用 Agent</strong>
                      <span>不预加载特定 Skill，由 Agent 根据对话判断。</span>
                    </span>
                  </button>

                  {availableSkills.map((skill) => (
                    <button
                      className={`skill-option${activeSkill?.id === skill.id ? " selected" : ""}`}
                      key={skill.id}
                      type="button"
                      role="menuitemradio"
                      aria-checked={activeSkill?.id === skill.id}
                      onClick={() => selectSkill(skill.id)}
                    >
                      <span className="skill-option-radio" aria-hidden="true" />
                      <span className="skill-option-main">
                        <strong>{skill.name}</strong>
                        <span>{skill.description}</span>
                      </span>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>

            <button
              className="composer-tool"
              type="button"
              title="上传图片"
              aria-label="上传图片"
              onClick={() => fileInputRef.current?.click()}
              disabled={disabled || isSending}
            >
              <svg
                aria-hidden="true"
                fill="none"
                height="16"
                viewBox="0 0 24 24"
                width="16"
              >
                <rect
                  height="18"
                  rx="2"
                  stroke="currentColor"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  width="18"
                  x="3"
                  y="3"
                />
                <circle cx="8.5" cy="8.5" fill="currentColor" r="1.5" />
                <path
                  d="M21 15l-5-5L5 21"
                  stroke="currentColor"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                />
              </svg>
            </button>

            <button
              className="composer-tool"
	              type="button"
	              title="带入当前参考"
	              aria-label="带入当前参考"
	              onClick={() => {
	                setText(IMAGE_AGENT_UI_PROMPTS.selectedReferencePrompt);
	                requestAnimationFrame(() => textareaRef.current?.focus());
	              }}
              disabled={disabled || isSending || !selectedReferences.length}
            >
              <svg
                aria-hidden="true"
                fill="none"
                height="16"
                viewBox="0 0 24 24"
                width="16"
              >
                <path
                  d="M21 15V6a2 2 0 0 0-2-2H9a2 2 0 0 0-2 2v9"
                  stroke="currentColor"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                />
                <rect
                  height="13"
                  rx="2"
                  stroke="currentColor"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  width="14"
                  x="3"
                  y="8"
                />
              </svg>
            </button>

            <button
              className="composer-tool"
              type="button"
              title="灵感提示"
              aria-label="填入灵感提示"
              onClick={() => {
                if (!quickPrompts.length) {
                  return;
                }

                const nextPrompt = quickPrompts[inspirationIndex % quickPrompts.length];
                setText(nextPrompt.prompt);
                setInspirationIndex((current) => current + 1);
                requestAnimationFrame(() => textareaRef.current?.focus());
              }}
              disabled={disabled || isSending || !quickPrompts.length}
            >
              <svg
                aria-hidden="true"
                fill="none"
                height="16"
                viewBox="0 0 24 24"
                width="16"
              >
                <path
                  d="M9 18h6M10 22h4M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.3 1 2.1V18h6v-1.2c0-.8.4-1.6 1-2.1A7 7 0 0 0 12 2z"
                  stroke="currentColor"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                />
              </svg>
            </button>
          </div>

          <button
            className="send-btn"
            type="button"
            aria-label="执行并发送"
            disabled={disabled || isSending || !canSubmit}
            onClick={() => {
              void handleSubmit();
            }}
          >
            <span className="send-label">[ EXEC ]</span>
            <svg
              aria-hidden="true"
              fill="none"
              height="16"
              viewBox="0 0 24 24"
              width="16"
            >
              <path
                d="M5 12h14M13 6l6 6-6 6"
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2.5"
              />
            </svg>
          </button>
        </div>
      </div>

      <div className="composer-hint">
        [ENTER] 执行 · [SHIFT+ENTER] 换行 · [DROP] 上传图像 ·
        {apiKeyConfigured ? " [OK] RENDER_ENGINE ONLINE" : " [WARN] LOCAL_PREVIEW MODE"}
      </div>

      <input
        ref={fileInputRef}
        accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
        disabled={disabled || isSending}
        multiple
        style={{ display: "none" }}
        type="file"
        onChange={(event) => {
          appendFiles(Array.from(event.target.files ?? []));
        }}
      />
    </div>
  );
}
