"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ImageAsset } from "@/lib/types";

type ImagePreviewModalProps = {
  asset: ImageAsset | null;
  isReferenceSelected?: boolean;
  onClose: () => void;
  onUseAsReference?: (() => void) | null;
};

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 4;
const ZOOM_STEP = 0.25;

const clampZoom = (value: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value));

export function ImagePreviewModal({
  asset,
  isReferenceSelected = false,
  onClose,
  onUseAsReference = null,
}: ImagePreviewModalProps) {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const [zoom, setZoom] = useState(1);
  const [stageSize, setStageSize] = useState({ width: 0, height: 0 });
  const [naturalSize, setNaturalSize] = useState({ width: 0, height: 0 });

  const sourceSize = useMemo(
    () => ({
      width: naturalSize.width || asset?.width || 0,
      height: naturalSize.height || asset?.height || 0,
    }),
    [asset?.height, asset?.width, naturalSize.height, naturalSize.width],
  );

  const fitScale = useMemo(() => {
    if (!sourceSize.width || !sourceSize.height || !stageSize.width || !stageSize.height) {
      return 0;
    }

    return Math.min(
      stageSize.width / sourceSize.width,
      stageSize.height / sourceSize.height,
      1,
    );
  }, [sourceSize.height, sourceSize.width, stageSize.height, stageSize.width]);

  const imageSize = useMemo(() => {
    if (!sourceSize.width || !sourceSize.height || !fitScale) {
      return null;
    }

    return {
      width: Math.round(sourceSize.width * fitScale * zoom),
      height: Math.round(sourceSize.height * fitScale * zoom),
    };
  }, [fitScale, sourceSize.height, sourceSize.width, zoom]);

  useEffect(() => {
    if (!asset) {
      return undefined;
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
        return;
      }

      if (event.key === "+" || event.key === "=") {
        event.preventDefault();
        setZoom((current) => clampZoom(current + ZOOM_STEP));
        return;
      }

      if (event.key === "-") {
        event.preventDefault();
        setZoom((current) => clampZoom(current - ZOOM_STEP));
        return;
      }

      if (event.key === "0") {
        event.preventDefault();
        setZoom(1);
      }
    };

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleEscape);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleEscape);
    };
  }, [asset, onClose]);

  useEffect(() => {
    if (!asset) {
      return;
    }

    setZoom(1);
    setNaturalSize({ width: 0, height: 0 });
  }, [asset]);

  useEffect(() => {
    if (!asset || !stageRef.current) {
      return undefined;
    }

    const stage = stageRef.current;
    const updateStageSize = () => {
      setStageSize({
        width: stage.clientWidth,
        height: stage.clientHeight,
      });
    };

    updateStageSize();

    const resizeObserver = new ResizeObserver(updateStageSize);
    resizeObserver.observe(stage);

    return () => {
      resizeObserver.disconnect();
    };
  }, [asset]);

  useEffect(() => {
    const stage = stageRef.current;

    if (!stage || !imageSize) {
      return;
    }

    window.requestAnimationFrame(() => {
      stage.scrollLeft = (stage.scrollWidth - stage.clientWidth) / 2;
      stage.scrollTop = (stage.scrollHeight - stage.clientHeight) / 2;
    });
  }, [asset, imageSize, zoom]);

  if (!asset) {
    return null;
  }

  const canZoomOut = zoom > MIN_ZOOM;
  const canZoomIn = zoom < MAX_ZOOM;
  const zoomPercent = Math.round(zoom * 100);
  const originalZoom = fitScale ? clampZoom(1 / fitScale) : 1;
  const canvasWidth = imageSize ? Math.max(stageSize.width, imageSize.width) : "100%";
  const canvasHeight = imageSize ? Math.max(stageSize.height, imageSize.height) : "100%";

  return (
    <div
      aria-label="图片预览"
      aria-modal="true"
      className="modal-mask"
      role="dialog"
      onClick={onClose}
    >
      <button className="modal-close" type="button" aria-label="关闭图片预览" onClick={onClose}>
        <svg
          aria-hidden="true"
          fill="none"
          height="18"
          viewBox="0 0 24 24"
          width="18"
        >
          <path
            d="M6 6l12 12M6 18L18 6"
            stroke="currentColor"
            strokeLinecap="round"
            strokeWidth="2"
          />
        </svg>
      </button>

      <div className="modal-content" onClick={(event) => event.stopPropagation()}>
        <div className="modal-image-stage" ref={stageRef}>
          <div
            className="modal-image-canvas"
            style={{
              width: canvasWidth,
              height: canvasHeight,
            }}
          >
            <img
              src={asset.url}
              alt={asset.alt}
              width={asset.width}
              height={asset.height}
              style={
                imageSize
                  ? {
                      width: imageSize.width,
                      height: imageSize.height,
                    }
                  : undefined
              }
              onLoad={(event) => {
                setNaturalSize({
                  width: event.currentTarget.naturalWidth,
                  height: event.currentTarget.naturalHeight,
                });
              }}
            />
          </div>
        </div>

        <div className="modal-toolbar" aria-label="图片缩放工具">
          <button
            className="modal-icon-btn"
            type="button"
            title="缩小"
            aria-label="缩小"
            disabled={!canZoomOut}
            onClick={() => setZoom((current) => clampZoom(current - ZOOM_STEP))}
          >
            <svg aria-hidden="true" fill="none" height="16" viewBox="0 0 24 24" width="16">
              <path d="M5 12h14" stroke="currentColor" strokeLinecap="round" strokeWidth="2" />
            </svg>
          </button>

          <button
            className="modal-zoom-value"
            type="button"
            title="重置缩放"
            onClick={() => setZoom(1)}
          >
            {zoomPercent}%
          </button>

          <button
            className="modal-icon-btn"
            type="button"
            title="放大"
            aria-label="放大"
            disabled={!canZoomIn}
            onClick={() => setZoom((current) => clampZoom(current + ZOOM_STEP))}
          >
            <svg aria-hidden="true" fill="none" height="16" viewBox="0 0 24 24" width="16">
              <path d="M12 5v14M5 12h14" stroke="currentColor" strokeLinecap="round" strokeWidth="2" />
            </svg>
          </button>

          <button
            className="modal-icon-btn"
            type="button"
            title="原始大小"
            onClick={() => setZoom(originalZoom)}
          >
            1:1
          </button>
        </div>

        <div className="modal-foot">
          <div className="modal-meta">
            <strong>{asset.label}</strong>
            <div>{asset.focus}</div>
          </div>

          <div className="modal-actions">
            <a className="modal-btn" download href={asset.url}>
              下载
            </a>
            {onUseAsReference ? (
              <button
                className="modal-btn primary"
                type="button"
                disabled={isReferenceSelected}
                onClick={onUseAsReference}
              >
                {isReferenceSelected ? "已加入本轮参考" : "基于此图继续聊"}
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
