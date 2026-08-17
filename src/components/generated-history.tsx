import type { GeneratedHistoryItem, ImageAsset } from "@/lib/types";

export type HistoryFilter = "all" | "current";

type GeneratedHistoryProps = {
  history: GeneratedHistoryItem[];
  selectedAssetIds: string[];
  activeFilter: HistoryFilter;
  disabled?: boolean;
  onPreviewAsset: (asset: ImageAsset) => void;
  onFilterChange: (filter: HistoryFilter) => void;
  onToggleReference: (assetId: string) => void;
};

const getAspectRatio = (asset: ImageAsset) =>
  asset.width > 0 && asset.height > 0 ? `${asset.width} / ${asset.height}` : "1 / 1";

export function GeneratedHistory({
  history,
  selectedAssetIds,
  activeFilter,
  disabled = false,
  onPreviewAsset,
  onFilterChange,
  onToggleReference,
}: GeneratedHistoryProps) {
  const filteredHistory = history;

  return (
    <aside className="history">
      <div className="history-head">
        <div>
          <span className="history-title">{"// OUTPUT_BUFFER"}</span>
          <span className="history-count">[{String(filteredHistory.length).padStart(2, "0")}]</span>
        </div>
        <button
          className="icon-btn"
          type="button"
          title="当前仅展示当前会话"
          aria-label="历史结果面板状态"
        >
          <svg
            aria-hidden="true"
            fill="none"
            height="14"
            viewBox="0 0 24 24"
            width="14"
          >
            <path
              d="M9 18l6-6-6-6"
              stroke="currentColor"
              strokeLinecap="round"
              strokeWidth="2"
            />
          </svg>
        </button>
      </div>

      <div className="history-filter">
        <button
          className={activeFilter === "all" ? "active" : ""}
          type="button"
          onClick={() => onFilterChange("all")}
        >
          [ ALL ]
        </button>
        <button
          className={activeFilter === "current" ? "active" : ""}
          type="button"
          onClick={() => onFilterChange("current")}
        >
          [ SESSION ]
        </button>
      </div>

      <div className="history-list">
        <div className="history-grid">
          {filteredHistory.map((entry) => {
            const isSelected = selectedAssetIds.includes(entry.asset.id);

            return (
              <article className="history-card" key={entry.id}>
                <button
                  className={`history-item${isSelected ? " is-selected" : ""}`}
                  type="button"
                  title={entry.note}
                  onClick={() => onPreviewAsset(entry.asset)}
                >
                  <img
                    src={entry.asset.url}
                    alt={entry.asset.alt}
                    width={entry.asset.width}
                    height={entry.asset.height}
                    style={{ aspectRatio: getAspectRatio(entry.asset) }}
                  />
                </button>

                <button
                  className={`history-select${isSelected ? " is-selected" : ""}`}
                  type="button"
                  disabled={disabled}
                  onClick={() => onToggleReference(entry.asset.id)}
                >
                  {isSelected ? "[ LINKED ]" : "[ USE_REF ]"}
                </button>
              </article>
            );
          })}

          {filteredHistory.length === 0 ? (
            <div className="history-empty">
              <div className="history-empty-emoji">[ NO_OUTPUT ]</div>
              <div>输出缓冲区为空。输入需求或上传参考图以启动第一次渲染。</div>
            </div>
          ) : null}
        </div>
      </div>
    </aside>
  );
}
