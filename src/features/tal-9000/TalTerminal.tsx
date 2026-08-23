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

// ASCII rendition of the circular Tech Fleet logo, shown during the power-on boot.
const TECH_FLEET_ASCII = String.raw`
         .-""""""""""""-.
       .'                '.
      /                    \
     |       T E C H        |
     |                      |
     |      F L E E T       |
      \                    /
       '.                .'
         '-............-'
`;

// Boot log lines revealed as the progress bar fills.
const BOOT_STEPS = [
  "TAL 9000 POWER-ON SELF TEST .......... OK",
  "MEMORY ....................... 767 CREW",
  "TECH FLEET NETWORK LINK .............. UP",
  "LOADING FLEETY ASSISTANT ...",
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
  const [power, setPower] = useState<"off" | "booting" | "on">("off");
  const [bootProgress, setBootProgress] = useState(0);
  const [view, setView] = useState<"main" | "chat" | "history">("main");
  const outRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (outRef.current) outRef.current.scrollTop = outRef.current.scrollHeight;
  }, [messages, isLoading]);
  useEffect(() => {
    if (power === "on" && view === "chat") inputRef.current?.focus();
  }, [power, view]);

  // Power-on boot sequence: ASCII Tech Fleet logo + progress bar, then the main screen.
  useEffect(() => {
    if (power !== "booting") return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
    if (reduce) {
      setBootProgress(100);
      setPower("on");
      setView("main");
      return;
    }
    setBootProgress(0);
    const startedAt = performance.now();
    const DURATION = 2600;
    let raf = 0;
    const tick = (now: number) => {
      const pct = Math.min(100, Math.round(((now - startedAt) / DURATION) * 100));
      setBootProgress(pct);
      if (pct < 100) {
        raf = requestAnimationFrame(tick);
      } else {
        setPower("on");
        setView("main");
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [power]);

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

  const powerOn = useCallback(() => setPower("booting"), []);
  const powerOff = useCallback(() => {
    setPower("off");
    setView("main");
  }, []);
  const showChatView = useCallback(() => {
    setView("chat");
    inputRef.current?.focus();
  }, []);
  const showHistoryView = useCallback(() => {
    setView("history");
    void loadConversations();
  }, [loadConversations]);
  const pickConversation = useCallback(
    (id: string) => {
      void loadConversation(id);
      setView("chat");
      inputRef.current?.focus();
    },
    [loadConversation]
  );
  const newChat = useCallback(() => {
    reset();
    setView("chat");
    inputRef.current?.focus();
  }, [reset]);

  return (
    <div className="tal9k">
      <div className="tal9k__frame">
        <div className="tal9k__stage">
          {/* CRT monitor — the exact computer.svg frame; the live terminal renders inside the
              screen path via <foreignObject>, clipped to the pillowy CRT shape. */}
          <div className="tal9k__monitor">
            <svg
              className="tal9k__crt"
              viewBox="0 0 730 593"
              preserveAspectRatio="xMidYMid meet"
              xmlns="http://www.w3.org/2000/svg"
            >
              <defs>
                <linearGradient
                  id="talMon0"
                  x1="669"
                  y1="567"
                  x2="669"
                  y2="27"
                  gradientUnits="userSpaceOnUse"
                >
                  <stop stopColor="#938e8e" />
                  <stop offset="0.531482" stopColor="#bbb2b2" />
                  <stop offset="1" stopColor="#938e8e" />
                </linearGradient>
                <linearGradient
                  id="talMon1"
                  x1="62"
                  y1="567"
                  x2="58"
                  y2="37"
                  gradientUnits="userSpaceOnUse"
                >
                  <stop stopColor="#989090" />
                  <stop offset="0.53125" stopColor="#dcdcdc" />
                  <stop offset="1" stopColor="#989090" />
                </linearGradient>
                <linearGradient
                  id="talMon2"
                  x1="659"
                  y1="62"
                  x2="43"
                  y2="71"
                  gradientUnits="userSpaceOnUse"
                >
                  <stop stopColor="#4a4949" />
                  <stop offset="0.479244" stopColor="#887f7f" />
                  <stop offset="1" stopColor="#4a4949" />
                </linearGradient>
                <clipPath id="talScreenClip">
                  <path d="M90.2403 118.876C93.0132 101.689 106.807 88.3222 124.065 86.0369C305.566 62.0025 419.112 61.9553 600.947 86.0272C618.242 88.3167 632.048 101.722 634.8 118.949C657.399 260.409 658.032 330.833 635.098 471.917C632.208 489.691 617.562 503.236 599.628 504.871C416.897 521.535 303.775 520.646 125.601 504.801C107.598 503.2 92.8862 489.629 89.9913 471.788C67.6395 334.038 66.8681 263.74 90.2403 118.876Z" />
                </clipPath>
                <filter id="talCrtGlow" x="-25%" y="-25%" width="150%" height="150%">
                  <feDropShadow
                    dx="0"
                    dy="0"
                    stdDeviation="7"
                    floodColor="#c9ffd2"
                    floodOpacity="0.85"
                  />
                </filter>
              </defs>
              <rect x="36" y="27" width="657" height="540" rx="20" fill="#efece7" />
              <path
                d="M673 27C684.046 27 693 35.9543 693 47L693 547C693 558.046 684.046 567 673 567L593 567L593 27L673 27Z"
                fill="url(#talMon0)"
              />
              <path
                d="M56 27C44.9543 27 36 35.9543 36 47L36 547C36 558.046 44.9543 567 56 567L136 567L136 27L56 27Z"
                fill="url(#talMon1)"
              />
              <path
                d="M36 547C36 558.046 44.9543 567 56 567H672.859C679.785 567 686.218 563.416 689.864 557.527L690.5 556.5L598.737 472.266C595.047 468.879 590.221 467 585.212 467H142.947C138.447 467 134.08 468.517 130.549 471.306L36 546V547Z"
                fill="#adadad"
              />
              <path
                d="M36 47C36 35.9543 44.9543 27 56 27H672.859C679.785 27 686.218 30.5837 689.864 36.4729L690.5 37.5L598.737 121.734C595.047 125.121 590.221 127 585.212 127H142.947C138.447 127 134.08 125.483 130.549 122.694L36 48V47Z"
                fill="url(#talMon2)"
              />
              <path
                d="M90.2403 118.876C93.0132 101.689 106.807 88.3222 124.065 86.0369C305.566 62.0025 419.112 61.9553 600.947 86.0272C618.242 88.3167 632.048 101.722 634.8 118.949C657.399 260.409 658.032 330.833 635.098 471.917C632.208 489.691 617.562 503.236 599.628 504.871C416.897 521.535 303.775 520.646 125.601 504.801C107.598 503.2 92.8862 489.629 89.9913 471.788C67.6395 334.038 66.8681 263.74 90.2403 118.876Z"
                fill="#013201"
                filter="url(#talCrtGlow)"
              />
              <foreignObject x="66" y="61" width="593" height="461" clipPath="url(#talScreenClip)">
                <div xmlns="http://www.w3.org/1999/xhtml" className="tal9k__screen">
                  {power === "off" && (
                    <div className="tal9k__off">
                      <p className="tal9k__off-label">&#9673; SYSTEM OFF</p>
                      <button type="button" className="tal9k__powerbtn" onClick={powerOn}>
                        PRESS TO POWER ON
                      </button>
                    </div>
                  )}
                  {power === "booting" && (
                    <div className="tal9k__boot" data-no-translate translate="no">
                      <pre className="tal9k__ascii">{TECH_FLEET_ASCII}</pre>
                      <div className="tal9k__bootlog">
                        {BOOT_STEPS.filter((_, i) => bootProgress >= (i + 1) * 20).map((s) => (
                          <p key={s} className="tal9k__line tal9k__line--sys">
                            {s}
                          </p>
                        ))}
                      </div>
                      <div
                        className="tal9k__bootbar"
                        role="progressbar"
                        aria-valuenow={bootProgress}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-label="Booting TAL 9000"
                      >
                        <div
                          className="tal9k__bootbar-fill"
                          style={{ width: `${bootProgress}%` }}
                        />
                      </div>
                      <p className="tal9k__bootpct">LOADING {bootProgress}%</p>
                    </div>
                  )}
                  {power === "on" && view === "main" && (
                    <div className="tal9k__mainscreen" data-no-translate translate="no">
                      <pre className="tal9k__ascii tal9k__ascii--sm">{TECH_FLEET_ASCII}</pre>
                      <p className="tal9k__line tal9k__line--user">TAL 9000 ONLINE</p>
                      <p className="tal9k__line tal9k__line--sys">
                        TECH FLEET NETWORK // TERMINAL v1.0
                      </p>
                      <p className="tal9k__line">&nbsp;</p>
                      <p className="tal9k__line">&#9656; Select CHAT to consult Fleety</p>
                      <p className="tal9k__line">&#9656; Select HISTORY for past sessions</p>
                    </div>
                  )}
                  {power === "on" && view === "chat" && (
                    <>
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
                            streaming={
                              i === messages.length - 1 && m.role === "assistant" && isLoading
                            }
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
                          placeholder={
                            attachment ? `attached: ${attachment.filename}` : "ask Fleety…"
                          }
                          aria-label="Message TAL 9000"
                          spellCheck={false}
                          disabled={isLoading}
                        />
                      </form>
                    </>
                  )}
                  {power === "on" && view === "history" && (
                    <div
                      className="tal9k__log"
                      role="dialog"
                      aria-label="Conversation log"
                      data-no-translate
                      translate="no"
                    >
                      <div className="tal9k__log-head">
                        <span>&mdash;&mdash; HISTORY &mdash;&mdash;</span>
                      </div>
                      <div className="tal9k__log-list">
                        <button type="button" className="tal9k__log-row" onClick={newChat}>
                          + NEW CHAT
                        </button>
                        {conversations.length === 0 && (
                          <p className="tal9k__line tal9k__line--sys">
                            No saved conversations yet.
                          </p>
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
              </foreignObject>
            </svg>
          </div>

          {/* TAL eye (left) + control panel — CRT sits on the right on desktop */}
          <div className="tal9k__side">
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
              <div className="tal9k__indicators" aria-hidden="true">
                <span className="tal9k__cell on green" />
                <span className="tal9k__cell on amber blink" />
                <span className="tal9k__cell" />
                <span className="tal9k__cell on teal" />
                <span className="tal9k__cell on blue blink" />
                <span className="tal9k__cell" />
                <span className="tal9k__cell on amber" />
                <span className="tal9k__cell" />
                <span className="tal9k__cell on teal blink" />
                <span className="tal9k__cell on green" />
                <span className="tal9k__cell on amber blink" />
                <span className="tal9k__cell" />
              </div>
              <div className="tal9k__grille" aria-hidden="true" />
            </div>

            <div className="tal9k__panel">
              <div className="tal9k__panel-head">
                <span>Console</span>
                <span>SYS</span>
              </div>
              <div className="tal9k__panel-grid">
                <button
                  type="button"
                  className={`tal9k__btn tal9k__btn--power${power === "on" ? " is-on" : ""}`}
                  aria-pressed={power === "on"}
                  onClick={power === "on" ? powerOff : powerOn}
                  disabled={power === "booting"}
                >
                  {power === "on" ? "◉ Power" : power === "booting" ? "Booting…" : "◉ Power On"}
                </button>
                <button
                  type="button"
                  className={`tal9k__btn${view === "chat" ? " is-on" : ""}`}
                  aria-pressed={view === "chat"}
                  onClick={showChatView}
                  disabled={power !== "on"}
                >
                  Chat
                </button>
                <button
                  type="button"
                  className={`tal9k__btn${view === "history" ? " is-on" : ""}`}
                  aria-pressed={view === "history"}
                  onClick={showHistoryView}
                  disabled={power !== "on"}
                >
                  History
                </button>
                <button
                  type="button"
                  className="tal9k__btn"
                  onClick={() => fileRef.current?.click()}
                  disabled={power !== "on" || attachStatus === "extracting"}
                >
                  {attachStatus === "extracting" ? "Reading…" : "Attach"}
                </button>
                <button
                  type="button"
                  className="tal9k__btn"
                  onClick={newChat}
                  disabled={power !== "on"}
                >
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
