import { useState, useRef, useEffect, useCallback } from "react";
import { getSessionSafe } from "@/lib/auth/session-port";
import { Send, Loader2, Volume2, VolumeX, User, MessageSquare, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SafeMarkdown } from "@/components/security/SafeMarkdown";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import fleetyIcon from "@/assets/fleety-icon.png";
import {
  type FleetyMode,
  FLEETY_MODES,
  fleetyModeMeta,
  loadStoredMode,
  storeMode,
} from "@/lib/fleety/modes";
import { groupConversationsByDate } from "@/lib/fleety/history";
import { toChatAttachment } from "@/lib/fleety/attachment";
import { useFleetyAttachment } from "@/hooks/useFleetyAttachment";
import { FleetyAttachButton, FleetyAttachmentChip } from "@/components/fleety/FleetyAttach";

type Msg = {
  role: "user" | "assistant";
  content: string;
  followups?: string[];
  sources?: string[];
};

type Conversation = { id: string; title: string; updated_at: string };

const CHAT_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/techfleet-chat`;

const MAX_INPUT_LENGTH = 4000;

/** Readable label for a source link (host + path, no protocol/trailing slash). */
function prettyUrl(url: string): string {
  try {
    const u = new URL(url);
    return (u.hostname + u.pathname).replace(/\/$/, "");
  } catch {
    return url;
  }
}

async function streamChat({
  messages,
  mode,
  attachment,
  onDelta,
  onFollowups,
  onSources,
  onDone,
}: {
  messages: Msg[];
  mode: FleetyMode;
  attachment?: { filename: string; text: string };
  onDelta: (deltaText: string) => void;
  onFollowups: (followups: string[]) => void;
  onSources: (urls: string[]) => void;
  onDone: () => void;
}) {
  // ASVS V13.2.1: Use session-bound JWT, not static publishable key
  const session = await getSessionSafe();
  const token = session?.access_token;
  if (!token) throw new Error("Authentication required. Please sign in again.");

  const sanitizedMessages = messages.map((m) => ({
    ...m,
    content: m.content.slice(0, MAX_INPUT_LENGTH),
  }));

  const resp = await fetch(CHAT_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ messages: sanitizedMessages, mode, attachment }),
  });

  if (!resp.ok) {
    const errData = await resp.json().catch(() => ({}));
    throw new Error(errData.error || `Request failed (${resp.status})`);
  }

  // D-08: structural citations guaranteed by the server (navigable guide/SPF links from the
  // retrieved KB entries), independent of what the model wrote.
  const srcHeader = resp.headers.get("X-Fleety-Sources");
  if (srcHeader) {
    try {
      const urls = JSON.parse(srcHeader);
      if (Array.isArray(urls) && urls.length) {
        onSources(urls.filter((u: unknown): u is string => typeof u === "string"));
      }
    } catch {
      /* header malformed — ignore, the answer still renders */
    }
  }

  if (!resp.body) throw new Error("No response stream");

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let textBuffer = "";
  let streamDone = false;

  while (!streamDone) {
    const { done, value } = await reader.read();
    if (done) break;
    textBuffer += decoder.decode(value, { stream: true });
    let newlineIndex: number;
    while ((newlineIndex = textBuffer.indexOf("\n")) !== -1) {
      let line = textBuffer.slice(0, newlineIndex);
      textBuffer = textBuffer.slice(newlineIndex + 1);
      if (line.endsWith("\r")) line = line.slice(0, -1);
      if (line.startsWith(":") || line.trim() === "") continue;
      if (!line.startsWith("data: ")) continue;
      const jsonStr = line.slice(6).trim();
      if (jsonStr === "[DONE]") {
        streamDone = true;
        break;
      }
      try {
        const parsed = JSON.parse(jsonStr);
        if (parsed?.fleety?.followups && Array.isArray(parsed.fleety.followups)) {
          const cleaned = parsed.fleety.followups
            .filter((s: unknown) => typeof s === "string")
            .map((s: string) => s.trim())
            .filter((s: string) => s.length > 0 && s.length <= 120)
            .slice(0, 3);
          if (cleaned.length > 0) onFollowups(cleaned);
        } else {
          const content = parsed.choices?.[0]?.delta?.content as string | undefined;
          if (content) onDelta(content);
        }
      } catch {
        textBuffer = line + "\n" + textBuffer;
        break;
      }
    }
  }

  if (textBuffer.trim()) {
    for (let raw of textBuffer.split("\n")) {
      if (!raw) continue;
      if (raw.endsWith("\r")) raw = raw.slice(0, -1);
      if (raw.startsWith(":") || raw.trim() === "") continue;
      if (!raw.startsWith("data: ")) continue;
      const jsonStr = raw.slice(6).trim();
      if (jsonStr === "[DONE]") continue;
      try {
        const parsed = JSON.parse(jsonStr);
        if (parsed?.fleety?.followups && Array.isArray(parsed.fleety.followups)) {
          const cleaned = parsed.fleety.followups
            .filter((s: unknown) => typeof s === "string")
            .map((s: string) => s.trim())
            .filter((s: string) => s.length > 0 && s.length <= 120)
            .slice(0, 3);
          if (cleaned.length > 0) onFollowups(cleaned);
        } else {
          const content = parsed.choices?.[0]?.delta?.content as string | undefined;
          if (content) onDelta(content);
        }
      } catch {
        /* ignore */
      }
    }
  }
  onDone();
}

interface GuidanceEmbedProps {
  initialQuery?: string;
}

export default function GuidanceEmbed({ initialQuery }: GuidanceEmbedProps) {
  const { user } = useAuth();
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState(initialQuery ?? "");
  const [isLoading, setIsLoading] = useState(false);
  const [speakingIdx, setSpeakingIdx] = useState<number | null>(null);
  const [mode, setMode] = useState<FleetyMode>(() => loadStoredMode());
  const {
    attachment,
    status: attachStatus,
    error: attachError,
    attach,
    clear: clearAttachment,
  } = useFleetyAttachment();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConvoId, setActiveConvoId] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  // Skip the [activeConvoId] reload for the flip caused by starting a new chat, so it can't clobber
  // the live streaming turn (the "history disappeared mid-session" bug — parity with the fix in #237).
  const skipConvoReloadRef = useRef(false);
  const activeMode = fleetyModeMeta(mode);
  const conversationGroups = groupConversationsByDate(conversations, new Date());

  // Remember the member's last mode across reloads (shared with the other Fleety surfaces).
  useEffect(() => {
    storeMode(mode);
  }, [mode]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages]);

  useEffect(() => {
    return () => {
      window.speechSynthesis.cancel();
    };
  }, []);

  // ── Chat persistence (parity with ChatPage / FleetyChatWidget) ─────────
  const loadConversations = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from("chat_conversations")
      .select("id, title, updated_at")
      .order("updated_at", { ascending: false });
    if (data) setConversations(data as Conversation[]);
  }, [user]);

  useEffect(() => {
    if (user) void loadConversations();
  }, [user, loadConversations]);

  // Load messages when switching to an existing conversation (skip the self-created flip).
  useEffect(() => {
    if (!activeConvoId) return;
    if (skipConvoReloadRef.current) {
      skipConvoReloadRef.current = false;
      return;
    }
    (async () => {
      const { data } = await supabase
        .from("chat_messages")
        .select("role, content")
        .eq("conversation_id", activeConvoId)
        .order("created_at", { ascending: true });
      if (data) setMessages(data as Msg[]);
    })();
  }, [activeConvoId]);

  const createConversation = async (firstMessage: string): Promise<string | null> => {
    if (!user) return null;
    const title = firstMessage.length > 50 ? firstMessage.slice(0, 50) + "…" : firstMessage;
    const { data, error } = await supabase
      .from("chat_conversations")
      .insert({ user_id: user.id, title })
      .select("id")
      .single();
    if (error || !data) return null;
    await loadConversations();
    return data.id;
  };

  const saveMessage = async (convoId: string, role: string, content: string) => {
    await supabase.from("chat_messages").insert({ conversation_id: convoId, role, content });
    await supabase
      .from("chat_conversations")
      .update({ updated_at: new Date().toISOString() })
      .eq("id", convoId);
  };

  const deleteConversation = async (convoId: string) => {
    await supabase.from("chat_conversations").delete().eq("id", convoId);
    if (activeConvoId === convoId) {
      setActiveConvoId(null);
      setMessages([]);
    }
    await loadConversations();
  };

  const startNewChat = () => {
    setActiveConvoId(null);
    setMessages([]);
    setShowHistory(false);
    inputRef.current?.focus();
  };

  const toggleSpeak = useCallback(
    (index: number, text: string) => {
      const synth = window.speechSynthesis;
      if (speakingIdx === index) {
        synth.cancel();
        setSpeakingIdx(null);
        return;
      }
      synth.cancel();
      const utterance = new SpeechSynthesisUtterance(text.replace(/[#*_`[\]()]/g, ""));
      utterance.rate = 0.95;
      utterance.onend = () => setSpeakingIdx(null);
      utterance.onerror = () => setSpeakingIdx(null);
      setSpeakingIdx(index);
      synth.speak(utterance);
    },
    [speakingIdx]
  );

  const sendText = async (text: string) => {
    text = text.trim();
    // An attachment alone can be sent; capture + clear it for this turn.
    const chatAttachment = toChatAttachment(attachment);
    if ((!text && !chatAttachment) || isLoading) return;
    if (!text && attachment) text = `Please review my uploaded file: ${attachment.filename}`;
    clearAttachment();

    const userMsg: Msg = { role: "user", content: text };
    setMessages((prev) => [
      ...prev.map((m) => (m.role === "assistant" ? { ...m, followups: undefined } : m)),
      userMsg,
    ]);
    setIsLoading(true);

    let convoId = activeConvoId;
    if (!convoId && user) {
      convoId = await createConversation(text);
      if (convoId) {
        skipConvoReloadRef.current = true; // keep the live turn; don't reload over it
        setActiveConvoId(convoId);
      }
    }
    if (convoId) await saveMessage(convoId, "user", text);

    let assistantSoFar = "";
    const upsertAssistant = (nextChunk: string) => {
      assistantSoFar += nextChunk;
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (last?.role === "assistant") {
          return prev.map((m, i) =>
            i === prev.length - 1 ? { ...m, content: assistantSoFar } : m
          );
        }
        return [...prev, { role: "assistant", content: assistantSoFar }];
      });
    };

    try {
      await streamChat({
        messages: [...messages, userMsg],
        mode,
        attachment: chatAttachment,
        onDelta: (chunk) => upsertAssistant(chunk),
        onFollowups: (followups) => {
          setMessages((prev) => {
            const last = prev[prev.length - 1];
            if (last?.role === "assistant") {
              return prev.map((m, i) => (i === prev.length - 1 ? { ...m, followups } : m));
            }
            return [...prev, { role: "assistant", content: "", followups }];
          });
        },
        onSources: (urls) => {
          setMessages((prev) => {
            const last = prev[prev.length - 1];
            if (last?.role === "assistant") {
              return prev.map((m, i) => (i === prev.length - 1 ? { ...m, sources: urls } : m));
            }
            return [...prev, { role: "assistant", content: "", sources: urls }];
          });
        },
        onDone: async () => {
          setIsLoading(false);
          if (convoId && assistantSoFar) {
            await saveMessage(convoId, "assistant", assistantSoFar);
            await loadConversations();
          }
        },
      });
    } catch (e: any) {
      console.error(e);
      setIsLoading(false);
      toast.error(e.message || "Failed to get a response.");
    }
  };

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    if (!text || isLoading) return;
    setInput("");
    await sendText(text);
  };

  return (
    <div className="flex flex-col h-[60vh] min-h-[400px] rounded-lg border bg-card overflow-hidden">
      {/* Header: history + new chat (parity with the side-panel Fleety) */}
      {user && (
        <div className="flex items-center justify-between border-b px-3 py-2 shrink-0">
          <span className="flex items-center gap-2 text-sm font-medium text-foreground">
            <img
              src={fleetyIcon}
              alt=""
              className="h-5 w-5 rounded-full"
              width={20}
              height={20}
              aria-hidden="true"
            />
            Fleety
          </span>
          <span className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => setShowHistory((v) => !v)}
              aria-label="Toggle chat history"
            >
              <MessageSquare className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={startNewChat}
              aria-label="New chat"
            >
              <Plus className="h-4 w-4" />
            </Button>
          </span>
        </div>
      )}

      {/* History panel — date-grouped, same as the side-panel Fleety */}
      {user && showHistory && (
        <div className="border-b max-h-48 overflow-y-auto p-2 space-y-1 shrink-0">
          {conversations.length === 0 && (
            <p className="text-xs text-muted-foreground p-2 text-center">No conversations yet</p>
          )}
          {conversationGroups.map((grp) => (
            <div key={grp.label} className="space-y-0.5">
              <p className="px-2 pt-1.5 pb-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70">
                {grp.label}
              </p>
              {grp.items.map((c) => (
                <div
                  key={c.id}
                  className={`group flex items-center gap-1.5 rounded-md px-2 py-1.5 cursor-pointer text-sm transition-colors ${
                    activeConvoId === c.id
                      ? "bg-primary/10 text-primary font-medium"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  }`}
                  onClick={() => {
                    setActiveConvoId(c.id);
                    setShowHistory(false);
                  }}
                >
                  <MessageSquare className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate flex-1 text-xs">{c.title}</span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteConversation(c.id);
                    }}
                    className="opacity-0 group-hover:opacity-100 transition-opacity"
                    aria-label="Delete conversation"
                  >
                    <Trash2 className="h-3 w-3 text-muted-foreground hover:text-destructive" />
                  </button>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      {/* Messages */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-5"
        role="log"
        aria-label="Fleety guidance conversation"
        aria-live="polite"
      >
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center py-12">
            <img
              src={fleetyIcon}
              alt=""
              className="h-16 w-16 opacity-40 mb-4"
              width={64}
              height={64}
              aria-hidden="true"
            />
            <h2 className="text-lg font-medium text-muted-foreground">Hi! I'm Fleety</h2>
            <p className="text-sm text-muted-foreground/70 mt-1 max-w-md">
              I can answer questions about Tech Fleet's community, team practices, workshops,
              handbooks, and onboarding process.
            </p>
            <div className="mt-6 flex flex-wrap gap-2 justify-center">
              {[
                "What is Tech Fleet?",
                "How do I get started?",
                "What workshops are available?",
                "Tell me about team practices",
              ].map((q) => (
                <button
                  key={q}
                  onClick={() => {
                    setInput(q);
                    inputRef.current?.focus();
                  }}
                  className="text-xs px-3 py-1.5 rounded-full border border-border bg-background hover:bg-accent text-foreground transition-colors"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <div
            key={i}
            className={`flex gap-3 ${msg.role === "user" ? "justify-end" : "justify-start"}`}
          >
            {msg.role === "assistant" && (
              <div className="flex-shrink-0 h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center mt-1">
                <img
                  src={fleetyIcon}
                  alt=""
                  className="h-6 w-6 rounded-full"
                  width={24}
                  height={24}
                  aria-hidden="true"
                />
              </div>
            )}
            <div
              className={`max-w-[85%] rounded-lg ${
                msg.role === "user"
                  ? "bg-primary text-primary-foreground px-4 py-3"
                  : "bg-muted/30 border border-border px-5 py-4"
              }`}
            >
              {msg.role === "assistant" ? (
                <div>
                  <div className="fleety-prose">
                    <SafeMarkdown>{msg.content}</SafeMarkdown>
                  </div>
                  {msg.sources && msg.sources.length > 0 && (
                    <div className="mt-3 pt-2 border-t border-border/50">
                      <p className="text-xs font-semibold text-muted-foreground mb-1">📚 Sources</p>
                      <ul className="space-y-0.5">
                        {msg.sources.map((url) => (
                          <li key={url}>
                            <a
                              href={url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-xs text-primary hover:underline break-all"
                            >
                              {prettyUrl(url)}
                            </a>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {!isLoading && msg.content.length > 0 && (
                    <div className="mt-3 pt-2 border-t border-border/50">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => toggleSpeak(i, msg.content)}
                        className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground gap-1.5"
                        aria-label={speakingIdx === i ? "Stop reading aloud" : "Read aloud"}
                      >
                        {speakingIdx === i ? (
                          <VolumeX className="h-3.5 w-3.5" />
                        ) : (
                          <Volume2 className="h-3.5 w-3.5" />
                        )}
                        {speakingIdx === i ? "Stop reading" : "Read aloud"}
                      </Button>
                    </div>
                  )}
                  {msg.followups && msg.followups.length > 0 && (
                    <div
                      className="mt-3 pt-2 border-t border-border/50"
                      role="group"
                      aria-label="Suggested follow-ups"
                    >
                      <p className="text-xs text-muted-foreground mb-1.5">Suggested follow-ups</p>
                      <div className="flex flex-wrap gap-1.5">
                        {msg.followups.map((q, fi) => (
                          <button
                            key={`${i}-fu-${fi}`}
                            type="button"
                            onClick={() => sendText(q)}
                            disabled={isLoading}
                            aria-label={`Ask Fleety: ${q}`}
                            className="text-xs px-2.5 py-1 rounded-full border border-border bg-background hover:bg-accent text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 disabled:cursor-not-allowed text-left"
                          >
                            {q}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
              )}
            </div>
            {msg.role === "user" && (
              <div className="flex-shrink-0 h-8 w-8 rounded-full bg-primary flex items-center justify-center mt-1">
                <User className="h-4 w-4 text-primary-foreground" aria-hidden="true" />
              </div>
            )}
          </div>
        ))}

        {isLoading && messages[messages.length - 1]?.role !== "assistant" && (
          <div className="flex gap-3 justify-start">
            <div className="flex-shrink-0 h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center">
              <img
                src={fleetyIcon}
                alt=""
                className="h-6 w-6 rounded-full"
                width={24}
                height={24}
                aria-hidden="true"
              />
            </div>
            <div className="bg-muted/30 border border-border rounded-lg px-4 py-3">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          </div>
        )}
      </div>

      {/* Mode selector — Chat / Deliverables Review / Plan (parity with the other Fleety surfaces) */}
      <div
        className="border-t px-4 pt-3 flex flex-wrap gap-1.5 shrink-0"
        role="radiogroup"
        aria-label="Fleety mode"
      >
        {FLEETY_MODES.map((m) => (
          <button
            key={m.id}
            type="button"
            role="radio"
            aria-checked={mode === m.id}
            title={m.label}
            onClick={() => setMode(m.id)}
            className={`text-xs px-3 py-1.5 rounded-full border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
              mode === m.id
                ? "border-primary bg-primary/10 text-primary font-medium"
                : "border-border bg-background text-muted-foreground hover:bg-accent hover:text-foreground"
            }`}
          >
            <span className="sm:hidden">{m.short}</span>
            <span className="hidden sm:inline">{m.label}</span>
          </button>
        ))}
      </div>

      {/* Attached-file status chip (2.2-F) */}
      {attachStatus !== "idle" && (
        <div className="px-4">
          <FleetyAttachmentChip
            attachment={attachment}
            status={attachStatus}
            error={attachError}
            onClear={clearAttachment}
          />
        </div>
      )}

      {/* Input */}
      <form onSubmit={send} className="p-4 pt-2 flex gap-2 items-end shrink-0">
        <FleetyAttachButton
          onPick={(f) => attach(f)}
          disabled={isLoading}
          busy={attachStatus === "extracting"}
        />
        <div className="flex-1 relative">
          <textarea
            ref={inputRef as React.RefObject<HTMLTextAreaElement>}
            value={input}
            onChange={(e) => {
              if (e.target.value.length <= 20000) setInput(e.target.value);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                if ((input.trim() || attachment?.text) && !isLoading) send(e);
              }
            }}
            placeholder={activeMode.placeholder}
            disabled={isLoading}
            className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 resize-none min-h-[80px] max-h-[400px]"
            rows={1}
            autoComplete="off"
            aria-label="Type your question"
            maxLength={20000}
            style={{ height: "auto", overflow: "auto" }}
            onInput={(e) => {
              const el = e.currentTarget;
              el.style.height = "auto";
              el.style.height = Math.min(el.scrollHeight, 400) + "px";
            }}
          />
          {input.length > 15000 && (
            <p className="text-xs text-muted-foreground text-right mt-0.5">
              {input.length.toLocaleString()} / 20,000
            </p>
          )}
        </div>
        <Button
          type="submit"
          disabled={isLoading || (!input.trim() && !attachment?.text)}
          size="icon"
          aria-label="Send message"
        >
          <Send className="h-4 w-4" />
        </Button>
      </form>
    </div>
  );
}
