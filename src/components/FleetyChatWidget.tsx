import { useState, useRef, useEffect, useCallback } from "react";
import { getSessionSafe } from "@/lib/auth/session-port";
import {
  X,
  Send,
  Bot,
  User,
  Loader2,
  Volume2,
  VolumeX,
  Plus,
  MessageSquare,
  Trash2,
  ThumbsUp,
  ThumbsDown,
  MessageCircleQuestion,
  Copy,
  Check,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { SafeMarkdown } from "@/components/security/SafeMarkdown";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import fleetyIcon from "@/assets/fleety-icon.png";

type ActionChip = { label: string; action_type: string; target_url?: string | null };
type Msg = {
  role: "user" | "assistant";
  content: string;
  turnId?: string | null;
  chips?: ActionChip[];
  followups?: string[];
  sources?: string[];
};

const CHAT_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/techfleet-chat`;

/** Readable label for a source link (host + path, no protocol/trailing slash). */
function prettyUrl(url: string): string {
  try {
    const u = new URL(url);
    return (u.hostname + u.pathname).replace(/\/$/, "");
  } catch {
    return url;
  }
}

/**
 * OWASP LLM02/ASVS V13.2: Use session JWT for API auth, never static keys.
 * Max input length per OWASP LLM10 unbounded consumption prevention.
 */
const MAX_INPUT_LENGTH = 4000;

async function streamChat({
  messages,
  conversationId,
  clientPath,
  onDelta,
  onTurnId,
  onChips,
  onFollowups,
  onSources,
  onDone,
}: {
  messages: Msg[];
  conversationId: string | null;
  clientPath: string | null;
  onDelta: (deltaText: string) => void;
  onTurnId: (id: string | null) => void;
  onChips: (chips: ActionChip[]) => void;
  onFollowups: (followups: string[]) => void;
  onSources: (urls: string[]) => void;
  onDone: () => void;
}) {
  const session = await getSessionSafe();
  const token = session?.access_token;
  if (!token) throw new Error("Authentication required. Please sign in again.");

  const sanitizedMessages = messages.map((m) => ({
    role: m.role,
    content: m.content.slice(0, MAX_INPUT_LENGTH),
  }));

  const resp = await fetch(CHAT_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      messages: sanitizedMessages,
      conversation_id: conversationId,
      client_path: clientPath ? clientPath.slice(0, 200) : null,
    }),
  });

  if (!resp.ok) {
    const errData = await resp.json().catch(() => ({}));
    throw new Error(errData.error || `Request failed (${resp.status})`);
  }

  onTurnId(resp.headers.get("X-Fleety-Turn-Id"));
  const chipsHeader = resp.headers.get("X-Fleety-Chips");
  if (chipsHeader) {
    try {
      const decoded = decodeURIComponent(escape(atob(chipsHeader)));
      const parsed = JSON.parse(decoded) as ActionChip[];
      if (Array.isArray(parsed)) onChips(parsed.slice(0, 4));
    } catch {
      /* ignore malformed header */
    }
  }
  // D-08: structural citations guaranteed by the server (navigable guide/SPF links
  // from the retrieved KB entries), independent of what the model wrote.
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

type Conversation = { id: string; title: string; updated_at: string };

export function FleetyChatWidget() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [speakingIdx, setSpeakingIdx] = useState<number | null>(null);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConvoId, setActiveConvoId] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [negFeedbackTurn, setNegFeedbackTurn] = useState<string | null>(null);
  const [submittedReasons, setSubmittedReasons] = useState<Record<string, string[]>>({});
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  // Skip the [activeConvoId] DB reload for the one flip caused by starting a brand-new chat, so it
  // can't overwrite the live streaming turn off screen (the "history disappeared mid-session" bug).
  const skipConvoReloadRef = useRef(false);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  useEffect(() => {
    return () => {
      window.speechSynthesis.cancel();
    };
  }, []);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  // Wave 1 UX-W1-015: defer history fetch until the widget actually opens.
  const loadConversations = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from("chat_conversations")
      .select("id, title, updated_at")
      .order("updated_at", { ascending: false });
    if (data) setConversations(data);
  }, [user]);

  const conversationsLoadedRef = useRef(false);
  useEffect(() => {
    if (!open || conversationsLoadedRef.current) return;
    conversationsLoadedRef.current = true;
    void loadConversations();
  }, [open, loadConversations]);

  // Load messages when conversation changes
  useEffect(() => {
    if (!activeConvoId) {
      setMessages([]);
      return;
    }
    if (skipConvoReloadRef.current) {
      // Flip came from starting a brand-new chat we're already rendering live — don't reload over it.
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

  const copyMessage = useCallback(async (index: number, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedIdx(index);
      setTimeout(() => setCopiedIdx((c) => (c === index ? null : c)), 1500);
    } catch {
      toast.error("Couldn't copy — try selecting the text manually.");
    }
  }, []);

  const sendText = async (text: string) => {
    text = text.trim();
    if (!text || isLoading) return;

    const userMsg: Msg = { role: "user", content: text };
    // Clear follow-ups on previous assistant message so they can't be re-clicked.
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
    let assistantTurnId: string | null = null;
    const upsertAssistant = (nextChunk: string) => {
      assistantSoFar += nextChunk;
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (last?.role === "assistant") {
          return prev.map((m, i) =>
            i === prev.length - 1 ? { ...m, content: assistantSoFar, turnId: assistantTurnId } : m
          );
        }
        return [...prev, { role: "assistant", content: assistantSoFar, turnId: assistantTurnId }];
      });
    };

    try {
      await streamChat({
        messages: [...messages, userMsg],
        conversationId: convoId,
        clientPath: typeof window !== "undefined" ? window.location.pathname : null,
        onDelta: (chunk) => upsertAssistant(chunk),
        onTurnId: (id) => {
          assistantTurnId = id;
          setMessages((prev) =>
            prev.map((m, i) =>
              i === prev.length - 1 && m.role === "assistant" ? { ...m, turnId: id } : m
            )
          );
        },
        onChips: (chips) => {
          setMessages((prev) => {
            const last = prev[prev.length - 1];
            if (last?.role === "assistant") {
              return prev.map((m, i) => (i === prev.length - 1 ? { ...m, chips } : m));
            }
            return [...prev, { role: "assistant", content: "", turnId: assistantTurnId, chips }];
          });
        },
        onFollowups: (followups) => {
          setMessages((prev) => {
            const last = prev[prev.length - 1];
            if (last?.role === "assistant") {
              return prev.map((m, i) => (i === prev.length - 1 ? { ...m, followups } : m));
            }
            return [
              ...prev,
              { role: "assistant", content: "", turnId: assistantTurnId, followups },
            ];
          });
        },
        onSources: (urls) => {
          setMessages((prev) => {
            const last = prev[prev.length - 1];
            if (last?.role === "assistant") {
              return prev.map((m, i) => (i === prev.length - 1 ? { ...m, sources: urls } : m));
            }
            return [
              ...prev,
              { role: "assistant", content: "", turnId: assistantTurnId, sources: urls },
            ];
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
      toast.error(e.message || "Fleety couldn't reply just now. Try again in a moment.");
    }
  };

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    if (!text || isLoading) return;
    setInput("");
    await sendText(text);
  };

  const handleFollowup = async (turnId: string | null | undefined, query: string) => {
    if (isLoading) return;
    if (turnId) {
      try {
        await supabase.rpc("fleety_record_action", {
          p_turn_id: turnId,
          p_action_type: "followup_click",
          p_action_label: query.slice(0, 200),
          p_target_url: null,
        });
      } catch (e) {
        console.warn("fleety followup tracking failed", e);
      }
    }
    await sendText(query);
  };

  // Submit thumbs feedback for an assistant message
  const submitFeedback = async (turnId: string, rating: 1 | -1) => {
    if (!user || !turnId) return;
    const { error } = await supabase
      .from("fleety_message_feedback")
      .upsert({ turn_id: turnId, user_id: user.id, rating }, { onConflict: "turn_id,user_id" });
    if (error) toast.error("Couldn't save your feedback.");
    else {
      toast.success(rating === 1 ? "Thanks — glad it helped!" : "Thanks — we'll improve it.");
      if (rating === -1) setNegFeedbackTurn(turnId);
    }
  };

  // Toggle a reason chip on negative feedback
  const FEEDBACK_REASONS = [
    "Too vague",
    "Wrong project",
    "Missing steps",
    "Needed a template",
    "Outdated info",
  ];
  const toggleReason = async (turnId: string, reason: string) => {
    if (!user) return;
    const current = submittedReasons[turnId] ?? [];
    const next = current.includes(reason)
      ? current.filter((r) => r !== reason)
      : [...current, reason];
    setSubmittedReasons((m) => ({ ...m, [turnId]: next }));
    const { error } = await supabase
      .from("fleety_message_feedback")
      .update({ reasons: next })
      .eq("turn_id", turnId)
      .eq("user_id", user.id);
    if (error) toast.error("Couldn't save the reason.");
  };

  // Action chip click — record event + open URL or post to Discord
  const handleChip = async (turnId: string | null | undefined, chip: ActionChip) => {
    try {
      if (turnId) {
        await supabase.rpc("fleety_record_action", {
          p_turn_id: turnId,
          p_action_type: chip.action_type,
          p_action_label: chip.label,
          p_target_url: chip.target_url ?? null,
        });
      }
    } catch (e) {
      // Non-blocking — never fail the user click on a tracking write
      console.warn("fleety chip tracking failed", e);
    }
    if (chip.target_url) {
      window.open(chip.target_url, "_blank", "noopener,noreferrer");
    } else if (chip.action_type === "step_done") {
      toast.success("Marked as done — nice work.");
    } else if (chip.action_type === "discord_post") {
      toast.info("Open Discord to post your question. We'll remember you tried this.");
    }
  };
  const openWithQuery = useCallback((query: string) => {
    setInput(query);
    setOpen(true);
  }, []);

  // Wave 3 W3-EVENT-008: listen for CustomEvent instead of mounting a window global.
  useEffect(() => {
    const handler = (e: Event) => {
      const q = (e as CustomEvent<{ query?: string }>).detail?.query ?? "";
      openWithQuery(q);
    };
    window.addEventListener("fleety:open", handler as EventListener);
    return () => window.removeEventListener("fleety:open", handler as EventListener);
  }, [openWithQuery]);

  if (!user) return null;

  return (
    <>
      {/* Floating button */}
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-[max(env(safe-area-inset-bottom),1.5rem)] right-[max(env(safe-area-inset-right),1.5rem)] z-50 h-14 w-14 rounded-full bg-primary shadow-lg hover:shadow-xl transition-all hover:scale-105 flex items-center justify-center group"
        aria-label="Chat with Fleety"
      >
        <img
          src={fleetyIcon}
          alt=""
          className="h-9 w-9 rounded-full"
          width={36}
          height={36}
          aria-hidden="true"
        />
        <span className="sr-only">Ask Fleety</span>
      </button>

      {/* Side panel */}
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side="right"
          resizeKey="fleety-chat"
          className="w-full sm:w-[440px] p-0 flex flex-col"
        >
          <SheetHeader className="px-4 py-3 border-b shrink-0">
            <SheetTitle className="flex items-center gap-2 justify-between">
              <span className="flex items-center gap-2">
                <img
                  src={fleetyIcon}
                  alt=""
                  className="h-6 w-6 rounded-full"
                  width={24}
                  height={24}
                  aria-hidden="true"
                />
                Fleety
              </span>
              <span className="flex items-center gap-1 mr-8">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={() => setShowHistory(!showHistory)}
                  aria-label="Toggle history"
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
            </SheetTitle>
          </SheetHeader>

          {/* History panel */}
          {showHistory && (
            <div className="border-b max-h-48 overflow-y-auto p-2 space-y-0.5 shrink-0">
              {conversations.length === 0 && (
                <p className="text-xs text-muted-foreground p-2 text-center">
                  No conversations yet
                </p>
              )}
              {conversations.map((c) => (
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
          )}

          {/* Messages */}
          <div
            ref={scrollRef}
            className="flex-1 overflow-y-auto p-4 space-y-4"
            role="log"
            aria-label="Chat conversation"
            aria-live="polite"
          >
            {messages.length === 0 && (
              <div
                role="button"
                tabIndex={0}
                onClick={() => inputRef.current?.focus()}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    inputRef.current?.focus();
                  }
                }}
                className="flex flex-col items-center justify-center h-full text-center py-8 rounded-lg hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-colors cursor-text"
                aria-label="Focus message input to ask Fleety a question"
              >
                <img
                  src={fleetyIcon}
                  alt=""
                  className="h-16 w-16 opacity-40 mb-4"
                  width={64}
                  height={64}
                  aria-hidden="true"
                />
                <p className="text-sm text-muted-foreground">Ask me anything about Tech Fleet!</p>
                <p className="text-xs text-muted-foreground/70 mt-1">
                  Tap a suggestion below or type your own question.
                </p>
                <div
                  className="mt-4 flex flex-wrap gap-2 justify-center"
                  onClick={(e) => e.stopPropagation()}
                >
                  {[
                    "What is Tech Fleet?",
                    "How do I get started?",
                    "What workshops are available?",
                  ].map((q) => (
                    <button
                      key={q}
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
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
                className={`flex gap-2 ${msg.role === "user" ? "justify-end" : "justify-start"}`}
              >
                {msg.role === "assistant" && (
                  <div className="flex-shrink-0 h-7 w-7 rounded-full bg-primary/10 flex items-center justify-center mt-1">
                    <img
                      src={fleetyIcon}
                      alt=""
                      className="h-5 w-5 rounded-full"
                      width={20}
                      height={20}
                      aria-hidden="true"
                    />
                  </div>
                )}
                <div
                  className={`max-w-[80%] rounded-lg text-sm ${
                    msg.role === "user"
                      ? "bg-primary text-primary-foreground px-3 py-2"
                      : "bg-card border border-border px-3 py-2"
                  }`}
                >
                  {msg.role === "assistant" ? (
                    <div>
                      <div className="fleety-prose prose-sm">
                        <SafeMarkdown>{msg.content}</SafeMarkdown>
                      </div>
                      {msg.sources && msg.sources.length > 0 && (
                        <div className="mt-2 pt-1.5 border-t border-border/50">
                          <p className="text-[11px] font-semibold text-muted-foreground mb-1">
                            📚 Sources
                          </p>
                          <ul className="space-y-0.5">
                            {msg.sources.map((url) => (
                              <li key={url}>
                                <a
                                  href={url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-[11px] text-primary hover:underline break-all"
                                >
                                  {prettyUrl(url)}
                                </a>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {!isLoading && msg.content.length > 0 && (
                        <div className="mt-2 pt-1 border-t border-border/50 flex items-center gap-1 flex-wrap">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => copyMessage(i, msg.content)}
                            className="h-6 px-1.5 text-xs text-muted-foreground hover:text-foreground gap-1"
                            aria-label="Copy answer to clipboard"
                          >
                            {copiedIdx === i ? (
                              <Check className="h-3 w-3" />
                            ) : (
                              <Copy className="h-3 w-3" />
                            )}
                            {copiedIdx === i ? "Copied" : "Copy"}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => toggleSpeak(i, msg.content)}
                            className="h-6 px-1.5 text-xs text-muted-foreground hover:text-foreground gap-1"
                            aria-label={speakingIdx === i ? "Stop reading aloud" : "Read aloud"}
                          >
                            {speakingIdx === i ? (
                              <VolumeX className="h-3 w-3" />
                            ) : (
                              <Volume2 className="h-3 w-3" />
                            )}
                            {speakingIdx === i ? "Stop" : "Listen"}
                          </Button>
                          {msg.turnId && (
                            <>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => submitFeedback(msg.turnId!, 1)}
                                className="h-6 px-1.5 text-xs text-muted-foreground hover:text-foreground gap-1"
                                aria-label="Mark answer as helpful"
                              >
                                <ThumbsUp className="h-3 w-3" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => submitFeedback(msg.turnId!, -1)}
                                className="h-6 px-1.5 text-xs text-muted-foreground hover:text-foreground gap-1"
                                aria-label="Mark answer as not helpful"
                              >
                                <ThumbsDown className="h-3 w-3" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={async () => {
                                  try {
                                    const { error } = await supabase.rpc("request_human_review", {
                                      _surface: "fleety_chat",
                                      _context: {
                                        turn_id: msg.turnId,
                                        snippet: msg.content.slice(0, 500),
                                      },
                                    });
                                    if (error) throw error;
                                    toast.success(
                                      "Human review requested — we'll reply within 30 days."
                                    );
                                  } catch (e) {
                                    toast.error("We couldn't file that request. Please try again.");
                                  }
                                }}
                                className="h-6 px-1.5 text-xs text-muted-foreground hover:text-foreground gap-1"
                                aria-label="Request human review of this answer"
                                title="Request a human to review this automated answer"
                              >
                                <User className="h-3 w-3" />
                                <span className="hidden sm:inline">Human review</span>
                              </Button>
                            </>
                          )}
                        </div>
                      )}
                      {msg.turnId && negFeedbackTurn === msg.turnId && (
                        <div
                          className="mt-2 pt-2 border-t border-border/50 flex flex-wrap gap-1.5"
                          role="group"
                          aria-label="Why wasn't this helpful?"
                        >
                          <span className="text-[11px] text-muted-foreground self-center mr-1">
                            What was off?
                          </span>
                          {FEEDBACK_REASONS.map((reason) => {
                            const active = (submittedReasons[msg.turnId!] ?? []).includes(reason);
                            return (
                              <Button
                                key={reason}
                                variant={active ? "secondary" : "outline"}
                                size="sm"
                                onClick={() => toggleReason(msg.turnId!, reason)}
                                className="h-6 px-2 text-[11px]"
                                aria-pressed={active}
                              >
                                {reason}
                              </Button>
                            );
                          })}
                        </div>
                      )}
                      {msg.chips && msg.chips.length > 0 && (
                        <div
                          className="mt-2 pt-2 border-t border-border/50 flex flex-wrap gap-1.5"
                          role="group"
                          aria-label="Suggested next actions"
                        >
                          {msg.chips.map((chip, ci) => (
                            <button
                              key={`${i}-chip-${ci}`}
                              type="button"
                              onClick={() => handleChip(msg.turnId, chip)}
                              className="text-xs px-2.5 py-1 rounded-full border border-primary/30 bg-primary/5 hover:bg-primary/15 text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            >
                              {chip.label}
                            </button>
                          ))}
                        </div>
                      )}
                      {msg.followups && msg.followups.length > 0 && (
                        <div
                          className="mt-2 pt-2 border-t border-border/50"
                          role="group"
                          aria-label="Suggested follow-ups"
                        >
                          <p className="text-[11px] text-muted-foreground mb-1.5 flex items-center gap-1">
                            <MessageCircleQuestion className="h-3 w-3" aria-hidden="true" />
                            Suggested follow-ups
                          </p>
                          <div className="flex flex-wrap gap-1.5">
                            {msg.followups.map((q, fi) => (
                              <button
                                key={`${i}-fu-${fi}`}
                                type="button"
                                onClick={() => handleFollowup(msg.turnId, q)}
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
                    <p className="whitespace-pre-wrap">{msg.content}</p>
                  )}
                </div>
                {msg.role === "user" && (
                  <div className="flex-shrink-0 h-7 w-7 rounded-full bg-primary flex items-center justify-center mt-1">
                    <User className="h-4 w-4 text-primary-foreground" aria-hidden="true" />
                  </div>
                )}
              </div>
            ))}

            {isLoading && messages[messages.length - 1]?.role !== "assistant" && (
              <div className="flex gap-2 justify-start">
                <div className="flex-shrink-0 h-7 w-7 rounded-full bg-primary/10 flex items-center justify-center">
                  <img
                    src={fleetyIcon}
                    alt=""
                    className="h-5 w-5 rounded-full"
                    width={20}
                    height={20}
                    aria-hidden="true"
                  />
                </div>
                <div className="bg-card border border-border rounded-lg px-3 py-2">
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                </div>
              </div>
            )}
          </div>

          {/* Input */}
          <form onSubmit={send} className="border-t p-3 flex gap-2 items-end shrink-0">
            <div className="flex-1">
              <textarea
                ref={inputRef as React.RefObject<HTMLTextAreaElement>}
                value={input}
                onChange={(e) => {
                  if (e.target.value.length <= 20000) setInput(e.target.value);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    if (input.trim() && !isLoading) send(e);
                  }
                }}
                placeholder="Ask about Tech Fleet..."
                disabled={isLoading}
                className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 resize-none min-h-[40px] max-h-[120px]"
                rows={1}
                autoComplete="off"
                aria-label="Type your question"
                maxLength={20000}
                style={{ height: "auto", overflow: "auto" }}
                onInput={(e) => {
                  const el = e.currentTarget;
                  el.style.height = "auto";
                  el.style.height = Math.min(el.scrollHeight, 120) + "px";
                }}
              />
            </div>
            <Button
              type="submit"
              disabled={isLoading || !input.trim()}
              size="icon"
              className="h-9 w-9"
              aria-label="Send message"
            >
              <Send className="h-4 w-4" />
            </Button>
          </form>
        </SheetContent>
      </Sheet>
    </>
  );
}
