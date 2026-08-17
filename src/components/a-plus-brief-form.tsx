"use client";

import { useMemo, useState } from "react";
import { IMAGE_AGENT_UI_PROMPTS } from "@/lib/agent/ui-prompt-config";
import type { APlusBriefFormSpec, APlusBriefValues } from "@/lib/types";

const FORM_COPY = IMAGE_AGENT_UI_PROMPTS.aPlusBriefForm;

type APlusBriefFormProps = {
  form: APlusBriefFormSpec;
  disabled?: boolean;
  onSubmit: (values: APlusBriefValues) => void;
};

const normalize = (value: string) => value.trim().replace(/\s+/g, " ");
const uniqueCandidates = (values: string[] | undefined) =>
  Array.from(new Set((values ?? []).map(normalize).filter(Boolean))).slice(0, 5);

export function APlusBriefForm({
  form,
  disabled = false,
  onSubmit,
}: APlusBriefFormProps) {
  const initialValues = form.initialValues ?? {};
  const [productName, setProductName] = useState(initialValues.productName ?? "");
  const [sellingPoints, setSellingPoints] = useState(initialValues.sellingPoints ?? "");
  const [targetCountry, setTargetCountry] = useState(initialValues.targetCountry ?? "");
  const [salesPlatform, setSalesPlatform] = useState(initialValues.salesPlatform ?? "");
  const candidates = form.candidateValues ?? {};

  const normalizedValues = useMemo<APlusBriefValues>(
    () => ({
      productName: normalize(productName),
      sellingPoints: sellingPoints
        .split(/\n+/)
        .map((line) => normalize(line))
        .filter(Boolean)
        .join("\n"),
      targetCountry: normalize(targetCountry),
      salesPlatform: normalize(salesPlatform),
    }),
    [productName, salesPlatform, sellingPoints, targetCountry],
  );

  const appendSellingPoint = (value: string) => {
    const normalized = normalize(value);
    if (!normalized) {
      return;
    }

    setSellingPoints((current) => {
      const existing = current
        .split(/\n+/)
        .map(normalize)
        .filter(Boolean);
      if (existing.includes(normalized)) {
        return existing.join("\n");
      }
      return [...existing, normalized].join("\n");
    });
  };

  const renderCandidateButtons = (
    values: string[] | undefined,
    onSelect: (value: string) => void,
  ) => {
    const items = uniqueCandidates(values);
    if (!items.length) {
      return null;
    }

    return (
      <div className="a-plus-brief-candidates">
        <span>{FORM_COPY.candidateLabel}</span>
        <div>
          {items.map((value) => (
            <button
              key={value}
              type="button"
              disabled={disabled}
              onClick={() => onSelect(value)}
            >
              {value}
            </button>
          ))}
        </div>
      </div>
    );
  };

  if (form.status === "submitted" && form.submittedValues) {
    const values = form.submittedValues;
    const summaryRows = [
      [FORM_COPY.productNameLabel, values.productName],
      [FORM_COPY.sellingPointsLabel, values.sellingPoints],
      [FORM_COPY.targetCountryLabel, values.targetCountry],
      [FORM_COPY.salesPlatformLabel, values.salesPlatform],
    ] as const;

    return (
      <div className="a-plus-brief-form is-submitted">
        <div className="a-plus-brief-head">
          <strong>{FORM_COPY.submittedTitle}</strong>
          <span>{FORM_COPY.submittedHint}</span>
        </div>
        <dl className="a-plus-brief-summary">
          {summaryRows.map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value || "未填写"}</dd>
            </div>
          ))}
        </dl>
      </div>
    );
  }

  return (
    <div className="a-plus-brief-form">
      <div className="a-plus-brief-head">
        <strong>{FORM_COPY.title}</strong>
        <span>{FORM_COPY.intro}</span>
      </div>

      <div className="a-plus-brief-field">
        <span>{FORM_COPY.productNameLabel}</span>
        <input
          value={productName}
          disabled={disabled}
          placeholder={FORM_COPY.productNamePlaceholder}
          onChange={(event) => setProductName(event.target.value)}
        />
        {renderCandidateButtons(candidates.productName, setProductName)}
      </div>

      <div className="a-plus-brief-field">
        <span>{FORM_COPY.sellingPointsLabel}</span>
        <textarea
          value={sellingPoints}
          disabled={disabled}
          placeholder={FORM_COPY.sellingPointsPlaceholder}
          rows={3}
          onChange={(event) => setSellingPoints(event.target.value)}
        />
        {renderCandidateButtons(candidates.sellingPoints, appendSellingPoint)}
      </div>

      <div className="a-plus-brief-grid">
        <div className="a-plus-brief-field">
          <span>{FORM_COPY.targetCountryLabel}</span>
          <input
            value={targetCountry}
            disabled={disabled}
            placeholder={FORM_COPY.targetCountryPlaceholder}
            onChange={(event) => setTargetCountry(event.target.value)}
          />
          {renderCandidateButtons(candidates.targetCountry, setTargetCountry)}
        </div>

        <div className="a-plus-brief-field">
          <span>{FORM_COPY.salesPlatformLabel}</span>
          <input
            value={salesPlatform}
            disabled={disabled}
            placeholder={FORM_COPY.salesPlatformPlaceholder}
            onChange={(event) => setSalesPlatform(event.target.value)}
          />
          {renderCandidateButtons(candidates.salesPlatform, setSalesPlatform)}
        </div>
      </div>

      <div className="a-plus-brief-hint">{FORM_COPY.optionalHint}</div>

      <button
        type="button"
        className="a-plus-brief-submit"
        disabled={disabled}
        onClick={() => onSubmit(normalizedValues)}
      >
        {FORM_COPY.submitLabel}
      </button>
    </div>
  );
}
