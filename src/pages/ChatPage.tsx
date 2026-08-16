import { useState, useRef, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";

import {
  Send,
  Bot,
  User,
  Loader2,
  Volume2,
  VolumeX,
  Plus,
  MessageSquare,
  Trash2,
  Copy,
  Check,
} from "lucide-react";
import { SafeMarkdown } from "@/components/security/SafeMarkdown";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

type Msg = { role: "user" | "assistant"; content: string; sources?: string[] };
type Conversation = { id: string; title: string; updated_at: string };

const CHAT_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/techfleet-chat`;

async function streamChat({
  messages,
  onDelta,
  onSources,
  onDone,
}: {
  messages: Msg[];
  onDelta: (deltaText: string) => void;
  onSources?: (urls: string[]) => void;
  onDone: () => void;
}) {
  const resp = await fetch(CHAT_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
    },
    body: JSON.stringify({ messages }),
  });

  if (!resp.ok) {
    const errData = await resp.json().catch(() => ({}));
    throw new Error(errData.error || `Request failed (${resp.status})`);
  }

  // D-08: structural citations. The server GUARANTEES the source URLs (navigable
  // guide/SPF links from the retrieved KB entries) in the X-Fleety-Sources header,
  // independent of whatever the model wrote. Render these — never rely on the LLM.
  const srcHeader = resp.headers.get("X-Fleety-Sources");
  if (srcHeader && onSources) {
    try {
      const urls = JSON.parse(srcHeader);
      if (Array.isArray(urls) && urls.length) {
        onSources(urls.filter((u): u is string => typeof u === "string"));
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
        const content = parsed.choices?.[0]?.delta?.content as string | undefined;
        if (content) onDelta(content);
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
        const content = parsed.choices?.[0]?.delta?.content as string | undefined;
        if (content) onDelta(content);
      } catch {
        /* ignore */
      }
    }
  }

  onDone();
}

function stripMarkdown(md: string): string {
  return md
    .replace(/#{1,6}\s+/g, "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/__(.+?)__/g, "$1")
    .replace(/_(.+?)_/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/`{1,3}[^`]*`{1,3}/g, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*\d+\.\s+/gm, "")
    .replace(/📚/g, "Sources:")
    .replace(/\n{2,}/g, ". ")
    .replace(/\n/g, " ")
    .trim();
}

/** Readable label for a source link (host + path, no protocol/trailing slash). */
function prettyUrl(url: string): string {
  try {
    const u = new URL(url);
    return (u.hostname + u.pathname).replace(/\/$/, "");
  } catch {
    return url;
  }
}

export default function ChatPage() {
  const { user } = useAuth();
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [speakingIdx, setSpeakingIdx] = useState<number | null>(null);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConvoId, setActiveConvoId] = useState<string | null>(null);
  const [showSidebar, setShowSidebar] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Load conversations list
  useEffect(() => {
    if (!user) return;
    loadConversations();
  }, [user]);

  const loadConversations = async () => {
    if (!user) return;
    const { data } = await supabase
      .from("chat_conversations")
      .select("id, title, updated_at")
      .order("updated_at", { ascending: false });
    if (data) setConversations(data);
  };

  // Load messages when conversation changes
  useEffect(() => {
    if (!activeConvoId) {
      setMessages([]);
      return;
    }
    loadMessages(activeConvoId);
  }, [activeConvoId]);

  const loadMessages = async (convoId: string) => {
    const { data } = await supabase
      .from("chat_messages")
      .select("role, content")
      .eq("conversation_id", convoId)
      .order("created_at", { ascending: true });
    if (data) setMessages(data as Msg[]);
  };

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

  const toggleSpeak = useCallback(
    (index: number, text: string) => {
      const synth = window.speechSynthesis;
      if (speakingIdx === index) {
        synth.cancel();
        setSpeakingIdx(null);
        return;
      }
      synth.cancel();
      const plainText = stripMarkdown(text);
      const utterance = new SpeechSynthesisUtterance(plainText);
      utterance.rate = 0.95;
      utterance.pitch = 1;
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

  const createConversation = async (firstMessage: string): Promise<string | null> => {
    if (!user) return null;
    const title = firstMessage.length > 50 ? firstMessage.slice(0, 50) + "…" : firstMessage;
    const { data, error } = await supabase
      .from("chat_conversations")
      .insert({ user_id: user.id, title })
      .select("id")
      .single();
    if (error || !data) {
      console.error("Create conversation error:", error);
      return null;
    }
    await loadConversations();
    return data.id;
  };

  const saveMessage = async (convoId: string, role: string, content: string) => {
    await supabase.from("chat_messages").insert({
      conversation_id: convoId,
      role,
      content,
    });
    // Update conversation timestamp
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
    setShowSidebar(false);
    inputRef.current?.focus();
  };

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    if (!text || isLoading) return;

    const userMsg: Msg = { role: "user", content: text };
    setInput("");
    setMessages((prev) => [...prev, userMsg]);
    setIsLoading(true);

    // Create or use existing conversation
    let convoId = activeConvoId;
    if (!convoId && user) {
      convoId = await createConversation(text);
      if (convoId) setActiveConvoId(convoId);
    }

    // Save user message
    if (convoId) await saveMessage(convoId, "user", text);

    let assistantSoFar = "";
    let assistantSources: string[] = [];
    const upsertAssistant = (nextChunk: string) => {
      assistantSoFar += nextChunk;
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (last?.role === "assistant") {
          return prev.map((m, i) =>
            i === prev.length - 1 ? { ...m, content: assistantSoFar, sources: assistantSources } : m
          );
        }
        return [...prev, { role: "assistant", content: assistantSoFar, sources: assistantSources }];
      });
    };

    try {
      await streamChat({
        messages: [...messages, userMsg],
        onDelta: (chunk) => upsertAssistant(chunk),
        onSources: (urls) => {
          assistantSources = urls;
        },
        onDone: async () => {
          setIsLoading(false);
          // Save assistant message
          if (convoId && assistantSoFar) {
            await saveMessage(convoId, "assistant", assistantSoFar);
          }
        },
      });
    } catch (e: any) {
      console.error(e);
      setIsLoading(false);
      toast.error(e.message || "Failed to get a response. Please try again.");
    }
  };

  return (
    <div className="container-app py-4 sm:py-8 max-w-4xl flex min-h-0 flex-col gap-3 sm:flex-row sm:gap-4 h-[calc(100dvh-4rem)] sm:h-[calc(100dvh-8rem)]">
      {/* Conversation sidebar */}
      {user && (
        <div
          className={`${
            showSidebar ? "flex" : "hidden sm:flex"
          } flex-col w-full max-h-[35dvh] shrink-0 border rounded-lg bg-card overflow-hidden sm:w-56 sm:max-h-none`}
        >
          <div className="p-3 border-b flex items-center justify-between">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              History
            </span>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={startNewChat}
              aria-label="New chat"
            >
              <Plus className="h-4 w-4" />
            </Button>
          </div>
          <div className="flex-1 overflow-y-auto p-1.5 space-y-0.5">
            {conversations.length === 0 && (
              <p className="text-xs text-muted-foreground p-2 text-center">No conversations yet</p>
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
                  setShowSidebar(false);
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
        </div>
      )}

      {/* Main chat area */}
      <div className="flex-1 flex flex-col min-w-0">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">Fleety</h1>
            <p className="text-sm text-muted-foreground mt-1 break-words">
              Ask me anything about Tech Fleet, team practices, workshops, and onboarding.
            </p>
          </div>
          {user && (
            <Button
              variant="outline"
              size="sm"
              className="shrink-0 sm:hidden"
              onClick={() => setShowSidebar(!showSidebar)}
            >
              History
            </Button>
          )}
        </div>

        {/* Chat messages */}
        <div
          ref={scrollRef}
          className="flex-1 overflow-y-auto rounded-lg border bg-muted/20 p-4 space-y-5 mb-4"
          role="log"
          aria-label="Chat conversation"
          aria-live="polite"
        >
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full text-center py-12">
              <Bot className="h-12 w-12 text-muted-foreground/40 mb-4" aria-hidden="true" />
              <h2 className="text-lg font-medium text-muted-foreground">Hi! I'm Fleety</h2>
              <p className="text-sm text-muted-foreground/70 mt-1 max-w-md">
                I can answer questions about Tech Fleet's community, team practices, workshops,
                handbooks, and onboarding process. I'll always include links to my sources!
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
                  <Bot className="h-4 w-4 text-primary" aria-hidden="true" />
                </div>
              )}
              <div
                className={`max-w-[85%] rounded-lg ${
                  msg.role === "user"
                    ? "bg-primary text-primary-foreground px-4 py-3"
                    : "bg-card border border-border px-5 py-4"
                }`}
              >
                {msg.role === "assistant" ? (
                  <div>
                    <div className="fleety-prose">
                      <SafeMarkdown>{msg.content}</SafeMarkdown>
                    </div>
                    {msg.sources && msg.sources.length > 0 && (
                      <div className="mt-3 pt-2 border-t border-border/50">
                        <p className="text-xs font-semibold text-muted-foreground mb-1">
                          📚 Sources
                        </p>
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
                      <div className="mt-3 pt-2 border-t border-border/50 flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => copyMessage(i, msg.content)}
                          className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground gap-1.5"
                          aria-label="Copy answer to clipboard"
                        >
                          {copiedIdx === i ? (
                            <>
                              <Check className="h-3.5 w-3.5" aria-hidden="true" />
                              Copied
                            </>
                          ) : (
                            <>
                              <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                              Copy
                            </>
                          )}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => toggleSpeak(i, msg.content)}
                          className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground gap-1.5"
                          aria-label={speakingIdx === i ? "Stop reading aloud" : "Read aloud"}
                        >
                          {speakingIdx === i ? (
                            <>
                              <VolumeX className="h-3.5 w-3.5" aria-hidden="true" />
                              Stop reading
                            </>
                          ) : (
                            <>
                              <Volume2 className="h-3.5 w-3.5" aria-hidden="true" />
                              Read aloud
                            </>
                          )}
                        </Button>
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
                <Bot className="h-4 w-4 text-primary" aria-hidden="true" />
              </div>
              <div className="bg-card border border-border rounded-lg px-4 py-3">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              </div>
            </div>
          )}
        </div>

        {/* Input */}
        <form onSubmit={send} className="flex gap-2 items-end">
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
                  if (input.trim() && !isLoading) send(e);
                }
              }}
              placeholder="Ask about Tech Fleet..."
              disabled={isLoading}
              className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 resize-none min-h-[40px] max-h-[200px]"
              rows={1}
              autoComplete="off"
              aria-label="Type your question"
              maxLength={20000}
              style={{ height: "auto", overflow: "auto" }}
              onInput={(e) => {
                const el = e.currentTarget;
                el.style.height = "auto";
                el.style.height = Math.min(el.scrollHeight, 200) + "px";
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
            disabled={isLoading || !input.trim()}
            size="icon"
            aria-label="Send message"
          >
            <Send className="h-4 w-4" />
          </Button>
        </form>
      </div>
    </div>
  );
}
