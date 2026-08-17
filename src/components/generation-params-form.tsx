"use client";

import { useState } from "react";
import { IMAGE_AGENT_UI_PROMPTS } from "@/lib/agent/ui-prompt-config";
import type { GenerationFormSpec } from "@/lib/types";

const FORM_COPY = IMAGE_AGENT_UI_PROMPTS.generationForm;

export type GenerationFormSubmit = {
  aspectRatio: string;
  resolution: string;
  outputCount: number;
};

type GenerationParamsFormProps = {
  form: GenerationFormSpec;
  aspectRatios: string[];
  resolutions: string[];
  disabled?: boolean;
  onSubmit: (params: GenerationFormSubmit) => void;
};

const COUNT_OPTIONS = [1, 2, 3, 4];

export function GenerationParamsForm({
  form,
  aspectRatios,
  resolutions,
  disabled = false,
  onSubmit,
}: GenerationParamsFormProps) {
  const initialAspectRatio = aspectRatios.includes(form.suggestedAspectRatio)
    ? form.suggestedAspectRatio
    : aspectRatios[0] ?? form.suggestedAspectRatio;
  const initialResolution = resolutions.includes(form.suggestedResolution)
    ? form.suggestedResolution
    : resolutions[0] ?? "";

  const [aspectRatio, setAspectRatio] = useState(initialAspectRatio);
  const [resolution, setResolution] = useState(initialResolution);
  const [outputCount, setOutputCount] = useState(
    Math.max(1, Math.round(form.suggestedOutputCount)),
  );

  const hasResolution = resolutions.length > 0;
  const taskCount = form.tasks?.length ?? 1;
  const isMultiTask = taskCount > 1;

  // A submitted form is shown as a read-only summary of the chosen parameters.
  if (form.status === "submitted" && form.submittedParams) {
    const { submittedParams } = form;
    const summaryParts = [
      submittedParams.aspectRatio,
      submittedParams.resolution,
      isMultiTask
        ? `${taskCount} 个方案/模块 · 每个 ${submittedParams.outputCount} ${FORM_COPY.countUnit} · 共 ${
            taskCount * submittedParams.outputCount
          } ${FORM_COPY.countUnit}`
        : `${submittedParams.outputCount} ${FORM_COPY.countUnit}`,
    ].filter(Boolean);

    return (
      <div className="gen-param-form is-submitted">
        <div className="gen-param-form-head">
          <strong>{FORM_COPY.submittedTitle}</strong>
        </div>
        <div className="gen-param-summary">{summaryParts.join(" · ")}</div>
        <div className="gen-param-form-hint">{FORM_COPY.submittedHint}</div>
      </div>
    );
  }

  return (
    <div className="gen-param-form">
      <div className="gen-param-form-head">
        <strong>{FORM_COPY.title}</strong>
        <span>
          {isMultiTask
            ? `这次会分别生成 ${taskCount} 个方案/模块；下面的数量表示每个方案/模块生成几张。`
            : FORM_COPY.intro}
        </span>
      </div>

      <div className="gen-param-field">
        <span className="gen-param-label">{FORM_COPY.aspectRatioLabel}</span>
        <div className="gen-param-options">
          {aspectRatios.map((ratio) => (
            <button
              key={ratio}
              type="button"
              className={`gen-param-chip${ratio === aspectRatio ? " selected" : ""}`}
              disabled={disabled}
              onClick={() => setAspectRatio(ratio)}
            >
              {ratio}
            </button>
          ))}
        </div>
      </div>

      {hasResolution ? (
        <div className="gen-param-field">
          <span className="gen-param-label">{FORM_COPY.resolutionLabel}</span>
          <div className="gen-param-options">
            {resolutions.map((option) => (
              <button
                key={option}
                type="button"
                className={`gen-param-chip${option === resolution ? " selected" : ""}`}
                disabled={disabled}
                onClick={() => setResolution(option)}
              >
                {option}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="gen-param-form-hint">{FORM_COPY.noResolutionHint}</div>
      )}

      <div className="gen-param-field">
        <span className="gen-param-label">
          {isMultiTask ? "每个方案/模块数量" : FORM_COPY.outputCountLabel}
        </span>
        <div className="gen-param-options">
          {COUNT_OPTIONS.map((count) => (
            <button
              key={count}
              type="button"
              className={`gen-param-chip${count === outputCount ? " selected" : ""}`}
              disabled={disabled}
              onClick={() => setOutputCount(count)}
            >
              {count} {FORM_COPY.countUnit}
            </button>
          ))}
        </div>
      </div>

      <button
        type="button"
        className="gen-param-submit"
        disabled={disabled}
        onClick={() =>
          onSubmit({
            aspectRatio,
            resolution: hasResolution ? resolution : "",
            outputCount,
          })
        }
      >
        {FORM_COPY.submitLabel}
      </button>
    </div>
  );
}
