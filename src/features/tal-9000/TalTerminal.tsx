import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useFleetyChat, type FleetyMessage } from "@/hooks/useFleetyChat";
import { useFleetyAttachment } from "@/hooks/useFleetyAttachment";
import { toChatAttachment, ACCEPTED_FILE_TYPES } from "@/lib/fleety/attachment";
import { submitRating, type FeedbackRating } from "@/lib/fleety/feedback";
import { dedupeSources, formatSourceLabel } from "@/lib/fleety/sources";
import { groupConversationsByDate } from "@/lib/fleety/history";
import "./tal-9000.css";

/**
 * TAL 9000 — Fleety "Future Mode": a full-screen retro-CRT terminal over the real Fleety
 * assistant. Reuses the shared `useFleetyChat` hook (streaming + persistence, so chats are
 * continuous with Classic mode), `useFleetyAttachment` (uploads), and the shared source/feedback
 * modules — no duplicated retrieval logic. Rendered chrome-less by AppLayout for
 * `/tal-9000?mode=future`.
 */
const BOOT_LINES = [
  "TAL 9000 SYSTEM ONLINE",
  "TECH FLEET NETWORK // TERMINAL v1.0",
  "FLEETY ASSISTANT READY.",
  "",
  "Ask me anything about Tech Fleet — workshops, projects, mentors, or membership.",
];

export default function TalTerminal() {
  const navigate = useNavigate();
  const [, setSearchParams] = useSearchParams();
  const { user } = useAuth();
  const {
    messages,
    isLoading,
    error,
    conversations,
    sendMessage,
    loadConversations,
    loadConversation,
    reset,
  } = useFleetyChat("chat");
  const {
    attachment,
    status: attachStatus,
    attach,
    clear: clearAttachment,
  } = useFleetyAttachment();

  const [input, setInput] = useState("");
  const [ratings, setRatings] = useState<Record<string, FeedbackRating>>({});
  const [showLog, setShowLog] = useState(false);
  const outRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (outRef.current) outRef.current.scrollTop = outRef.current.scrollHeight;
  }, [messages, isLoading]);
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const onSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const att = toChatAttachment(attachment);
      if ((!input.trim() && !att) || isLoading) return;
      const text = input;
      setInput("");
      clearAttachment();
      void sendMessage(text, att);
    },
    [input, attachment, isLoading, sendMessage, clearAttachment]
  );

  const onFile = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const f = e.target.files?.[0];
      e.target.value = "";
      if (f) await attach(f);
      inputRef.current?.focus();
    },
    [attach]
  );

  const rate = useCallback(
    async (turnId: string, rating: FeedbackRating) => {
      if (!turnId || !user) return;
      setRatings((r) => ({ ...r, [turnId]: rating }));
      await submitRating(turnId, user.id, rating);
    },
    [user]
  );

  const toClassic = useCallback(() => setSearchParams({}), [setSearchParams]);
  const exit = useCallback(() => {
    if (window.history.length > 1) navigate(-1);
    else navigate("/dashboard");
  }, [navigate]);

  const toggleLog = useCallback(() => {
    setShowLog((v) => {
      if (!v) void loadConversations();
      return !v;
    });
  }, [loadConversations]);
  const pickConversation = useCallback(
    (id: string) => {
      void loadConversation(id);
      setShowLog(false);
      inputRef.current?.focus();
    },
    [loadConversation]
  );
  const newChat = useCallback(() => {
    reset();
    setShowLog(false);
    inputRef.current?.focus();
  }, [reset]);

  return (
    <div className="tal9k">
      <div className="tal9k__frame">
        <div className="tal9k__stage">
          {/* CRT monitor */}
          <div className="tal9k__monitor">
            <div className="tal9k__screen">
              <div
                className="tal9k__out"
                ref={outRef}
                role="log"
                aria-live="polite"
                data-no-translate
                translate="no"
                aria-label="TAL 9000 terminal output"
              >
                {BOOT_LINES.map((l, i) => (
                  <p key={`boot-${i}`} className="tal9k__line tal9k__line--sys">
                    {l || " "}
                  </p>
                ))}
                {messages.map((m, i) => (
                  <MessageBlock
                    key={i}
                    m={m}
                    streaming={i === messages.length - 1 && m.role === "assistant" && isLoading}
                    rating={m.turnId ? ratings[m.turnId] : undefined}
                    onRate={rate}
                  />
                ))}
                {error && (
                  <p className="tal9k__line tal9k__line--sys">
                    {"⚠"} {error}
                  </p>
                )}
              </div>

              <form className="tal9k__inputline" onSubmit={onSubmit} autoComplete="off">
                <span className="tal9k__prompt" aria-hidden="true">
                  &gt;
                </span>
                <input
                  ref={inputRef}
                  className="tal9k__input"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder={attachment ? `attached: ${attachment.filename}` : "ask Fleety…"}
                  aria-label="Message TAL 9000"
                  spellCheck={false}
                  disabled={isLoading}
                />
              </form>

              {showLog && (
                <div
                  className="tal9k__log"
                  role="dialog"
                  aria-label="Conversation log"
                  data-no-translate
                  translate="no"
                >
                  <div className="tal9k__log-head">
                    <span>&mdash;&mdash; LOG &mdash;&mdash;</span>
                    <button
                      type="button"
                      className="tal9k__btn tal9k__btn--sm"
                      onClick={() => setShowLog(false)}
                    >
                      Close
                    </button>
                  </div>
                  <div className="tal9k__log-list">
                    <button type="button" className="tal9k__log-row" onClick={newChat}>
                      + NEW CHAT
                    </button>
                    {conversations.length === 0 && (
                      <p className="tal9k__line tal9k__line--sys">No saved conversations yet.</p>
                    )}
                    {groupConversationsByDate(conversations, new Date()).map((g) => (
                      <div key={g.label}>
                        <div className="tal9k__log-group">{g.label}</div>
                        {g.items.map((c) => (
                          <button
                            key={c.id}
                            type="button"
                            className="tal9k__log-row"
                            onClick={() => pickConversation(c.id)}
                          >
                            {c.title || "Untitled"}
                          </button>
                        ))}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="tal9k__scanlines" aria-hidden="true" />
              <div className="tal9k__vignette" aria-hidden="true" />
            </div>
          </div>

          {/* TAL eye + control panel (side-by-side on XL, stacked below) */}
          <div className="tal9k__console">
            <div className="tal9k__eyewrap">
              <div className="tal9k__status">
                TAL&middot;9000 {isLoading ? "…THINKING" : "READY"}
              </div>
              <div className="tal9k__eye" aria-hidden="true">
                <div className="tal9k__aura" />
                <svg viewBox="0 0 250 250" role="img">
                  <defs>
                    <radialGradient id="talIris" cx="50%" cy="42%" r="58%">
                      <stop offset="0%" stopColor="#a8ffce" />
                      <stop offset="42%" stopColor="#4ade97" />
                      <stop offset="100%" stopColor="#1a8f55" />
                    </radialGradient>
                    <radialGradient id="talLens" cx="50%" cy="40%" r="62%">
                      <stop offset="0%" stopColor="#222a1d" />
                      <stop offset="55%" stopColor="#0c110a" />
                      <stop offset="100%" stopColor="#040703" stopOpacity="0" />
                    </radialGradient>
                    <linearGradient
                      id="talBezel"
                      x1="30"
                      y1="20"
                      x2="220"
                      y2="235"
                      gradientUnits="userSpaceOnUse"
                    >
                      <stop offset="0" stopColor="#454d3b" />
                      <stop offset=".5" stopColor="#767e69" />
                      <stop offset="1" stopColor="#282e21" />
                    </linearGradient>
                  </defs>
                  <circle cx="125" cy="125" r="124" fill="url(#talBezel)" />
                  <circle cx="125" cy="125" r="109" fill="#060a05" />
                  <circle cx="125" cy="125" r="104" fill="url(#talLens)" />
                  <circle
                    cx="125"
                    cy="125"
                    r="92"
                    fill="none"
                    stroke="#000"
                    strokeOpacity=".55"
                    strokeWidth="2"
                  />
                  <circle
                    cx="125"
                    cy="125"
                    r="76"
                    fill="none"
                    stroke="#1b2416"
                    strokeOpacity=".7"
                    strokeWidth="2"
                  />
                  <circle cx="125" cy="125" r="48" fill="url(#talIris)" />
                  <circle cx="125" cy="125" r="48" fill="none" stroke="#04120a" strokeWidth="3" />
                </svg>
                <div className="tal9k__bloom" />
                <div className="tal9k__pupil" />
              </div>
              <div className="tal9k__eyelabel">TAL 9000</div>
            </div>

            <div className="tal9k__panel">
              <div className="tal9k__panel-head">
                <span>Console</span>
                <span>SYS</span>
              </div>
              <div className="tal9k__panel-grid">
                <button
                  type="button"
                  className="tal9k__btn"
                  onClick={() => fileRef.current?.click()}
                  disabled={attachStatus === "extracting"}
                >
                  {attachStatus === "extracting" ? "Reading…" : "Attach"}
                </button>
                <button type="button" className="tal9k__btn" onClick={toggleLog}>
                  Log
                </button>
                <button type="button" className="tal9k__btn" onClick={newChat}>
                  New Chat
                </button>
                <button type="button" className="tal9k__btn" onClick={toClassic}>
                  Classic
                </button>
                <button type="button" className="tal9k__btn" onClick={exit}>
                  Exit
                </button>
              </div>
              <input
                ref={fileRef}
                type="file"
                className="tal9k__file"
                accept={ACCEPTED_FILE_TYPES}
                onChange={onFile}
                tabIndex={-1}
                aria-hidden="true"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function MessageBlock({
  m,
  streaming,
  rating,
  onRate,
}: {
  m: FleetyMessage;
  streaming: boolean;
  rating: FeedbackRating | undefined;
  onRate: (turnId: string, rating: FeedbackRating) => void;
}) {
  if (m.role === "user") {
    return <p className="tal9k__line tal9k__line--user">&gt; {m.content}</p>;
  }

  const srcs = m.sources ? dedupeSources(m.sources) : [];
  return (
    <div>
      <p className={"tal9k__line tal9k__line--fleety" + (streaming ? " tal9k__caret" : "")}>
        FLEETY: {m.content}
      </p>
      {!streaming && (srcs.length > 0 || m.turnId) && (
        <div className="tal9k__meta">
          {srcs.length > 0 && (
            <div className="tal9k__srcs">
              SOURCES:{" "}
              {srcs.map((u, i) => (
                <span key={u}>
                  {i > 0 ? " · " : ""}
                  <a href={u} target="_blank" rel="noopener noreferrer">
                    {formatSourceLabel(u)}
                  </a>
                </span>
              ))}
            </div>
          )}
          {m.turnId && (
            <div className="tal9k__fb">
              <button
                type="button"
                aria-pressed={rating === 1}
                aria-label="Helpful answer"
                onClick={() => onRate(m.turnId as string, 1)}
              >
                {"▲"} YES
              </button>
              <button
                type="button"
                aria-pressed={rating === -1}
                aria-label="Not helpful"
                onClick={() => onRate(m.turnId as string, -1)}
              >
                {"▼"} NO
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
