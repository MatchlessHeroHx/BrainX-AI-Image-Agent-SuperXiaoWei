import type { SessionSummary } from "@/lib/types";

type SessionSidebarProps = {
  sessions: SessionSummary[];
  disabled?: boolean;
  onCreateConversation: () => void;
  onSelectSession: (sessionId: string) => void;
  onDeleteSession: (sessionId: string) => void;
};

export function SessionSidebar({
  sessions,
  disabled = false,
  onCreateConversation,
  onSelectSession,
  onDeleteSession,
}: SessionSidebarProps) {
  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-logo" aria-hidden="true">&gt;_</div>
        <div>
          <div className="brand-name">BRAINX // XIAOWEI</div>
          <div className="brand-sub">IMAGE_AGENT_CLI v0.1</div>
        </div>
      </div>

      <button
        className="new-chat"
        type="button"
        onClick={onCreateConversation}
        disabled={disabled}
      >
        <span aria-hidden="true">+</span>
        [ NEW_SESSION ]
      </button>

      <div className="sessions-label">{"// SESSION_LOG"}</div>

      <div className="sessions">
        {sessions.map((session) => (
          <div
            key={session.id}
            aria-current={session.isActive ? "page" : undefined}
            className={`session-item${session.isActive ? " active" : ""}`}
            title={`${session.title} · ${session.updatedAt} · ${session.lastUserIntent}`}
          >
            <button
              className="session-main"
              type="button"
              onClick={() => onSelectSession(session.id)}
              disabled={disabled || session.isActive}
            >
              <span aria-hidden="true" className="session-dot" />
              <span className="session-title">{session.title}</span>
            </button>
            <button
              className="session-delete"
              type="button"
              title="删除会话"
              aria-label={`删除会话：${session.title}`}
              disabled={disabled}
              onClick={() => onDeleteSession(session.id)}
            >
              <svg
                aria-hidden="true"
                fill="none"
                height="14"
                viewBox="0 0 24 24"
                width="14"
              >
                <path
                  d="M4 7h16M10 11v6M14 11v6M6 7l1 14h10l1-14M9 7V4h6v3"
                  stroke="currentColor"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                />
              </svg>
            </button>
          </div>
        ))}
      </div>

      <div className="sidebar-foot">
        <div className="avatar">MX</div>
        <div>
          <div className="sidebar-user-name">$ superxiaowei</div>
          <div className="sidebar-user-plan">[PRO] SYSTEM ONLINE</div>
        </div>
      </div>
    </aside>
  );
}
