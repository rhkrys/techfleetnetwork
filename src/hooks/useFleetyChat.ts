// Shared React hook wrapping the canonical `streamChat` client plus conversation
// persistence. Built for the TAL 9000 terminal but surface-agnostic. Mirrors the proven
// send/persist logic from FleetyChatWidget so a chat started in the terminal is the SAME
// `chat_conversations`/`chat_messages` row a Classic surface would write — giving
// cross-mode continuity (start in Future, continue in Classic, same thread) for free.
import { useCallback, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { streamChat, type ActionChip, type FleetyChatMsg } from "@/lib/fleety/stream-chat";
import type { FleetyMode } from "@/lib/fleety/modes";
import type { DatedConversation } from "@/lib/fleety/history";

export type FleetyMessage = {
  role: "user" | "assistant";
  content: string;
  turnId?: string | null;
  chips?: ActionChip[];
  followups?: string[];
  sources?: string[];
};

export type SendAttachment = { filename: string; text: string };

export function useFleetyChat(mode: FleetyMode) {
  const { user } = useAuth();
  const [messages, setMessages] = useState<FleetyMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [conversations, setConversations] = useState<DatedConversation[]>([]);

  const createConversation = useCallback(
    async (firstMessage: string): Promise<string | null> => {
      if (!user) return null;
      const title = firstMessage.length > 50 ? firstMessage.slice(0, 50) + "…" : firstMessage;
      const { data, error: insErr } = await supabase
        .from("chat_conversations")
        .insert({ user_id: user.id, title })
        .select("id")
        // single-required: an insert of exactly one row returns exactly one row
        .single();
      if (insErr || !data) return null;
      return data.id as string;
    },
    [user]
  );

  const saveMessage = useCallback(async (convoId: string, role: string, content: string) => {
    await supabase.from("chat_messages").insert({ conversation_id: convoId, role, content });
    await supabase
      .from("chat_conversations")
      .update({ updated_at: new Date().toISOString() })
      .eq("id", convoId);
  }, []);

  /** List the member's saved conversations (newest first) for the history browser. */
  const loadConversations = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from("chat_conversations")
      .select("id, title, updated_at")
      .order("updated_at", { ascending: false });
    if (data) setConversations(data as DatedConversation[]);
  }, [user]);

  /** Load an existing conversation's messages into the terminal (history browser). */
  const loadConversation = useCallback(async (convoId: string) => {
    setConversationId(convoId);
    const { data } = await supabase
      .from("chat_messages")
      .select("role, content")
      .eq("conversation_id", convoId)
      .order("created_at", { ascending: true });
    if (data) setMessages(data as FleetyMessage[]);
  }, []);

  const reset = useCallback(() => {
    setConversationId(null);
    setMessages([]);
    setError(null);
  }, []);

  const sendMessage = useCallback(
    async (rawText: string, attachment?: SendAttachment) => {
      let text = rawText.trim();
      if ((!text && !attachment) || isLoading) return;
      if (!text && attachment) text = `Please review my uploaded file: ${attachment.filename}`;

      const userMsg: FleetyMessage = { role: "user", content: text };
      const history = messages; // snapshot before mutating state
      setMessages((prev) => [
        ...prev.map((m) => (m.role === "assistant" ? { ...m, followups: undefined } : m)),
        userMsg,
      ]);
      setIsLoading(true);
      setError(null);

      let convoId = conversationId;
      if (!convoId && user) {
        convoId = await createConversation(text);
        if (convoId) setConversationId(convoId);
      }
      if (convoId) await saveMessage(convoId, "user", text);

      let assistantSoFar = "";
      let assistantTurnId: string | null = null;

      // Create-or-patch the trailing assistant message. `chunk` appends to the streamed text.
      const upsertAssistant = (patch: Partial<FleetyMessage>, chunk?: string) => {
        if (chunk !== undefined) assistantSoFar += chunk;
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (last?.role === "assistant") {
            return prev.map((m, i) =>
              i === prev.length - 1
                ? { ...m, content: assistantSoFar, turnId: assistantTurnId, ...patch }
                : m
            );
          }
          return [
            ...prev,
            { role: "assistant", content: assistantSoFar, turnId: assistantTurnId, ...patch },
          ];
        });
      };

      try {
        await streamChat({
          messages: [...history, userMsg].map((m): FleetyChatMsg => ({
            role: m.role,
            content: m.content,
          })),
          conversationId: convoId,
          clientPath: typeof window !== "undefined" ? window.location.pathname : null,
          mode,
          attachment,
          onDelta: (chunk) => upsertAssistant({}, chunk),
          onTurnId: (id) => {
            assistantTurnId = id;
            // Only patch an existing assistant bubble; don't create an empty one early.
            setMessages((prev) =>
              prev.map((m, i) =>
                i === prev.length - 1 && m.role === "assistant" ? { ...m, turnId: id } : m
              )
            );
          },
          onChips: (chips) => upsertAssistant({ chips }),
          onFollowups: (followups) => upsertAssistant({ followups }),
          onSources: (sources) => upsertAssistant({ sources }),
          onDone: async () => {
            setIsLoading(false);
            if (convoId && assistantSoFar) {
              await saveMessage(convoId, "assistant", assistantSoFar);
              await loadConversations(); // keep the history browser fresh
            }
          },
        });
      } catch (e) {
        setIsLoading(false);
        setError(
          e instanceof Error ? e.message : "Fleety couldn't reply just now. Try again in a moment."
        );
      }
    },
    [
      messages,
      conversationId,
      isLoading,
      user,
      mode,
      createConversation,
      saveMessage,
      loadConversations,
    ]
  );

  return {
    messages,
    isLoading,
    error,
    conversationId,
    conversations,
    sendMessage,
    loadConversations,
    loadConversation,
    reset,
    setConversationId,
  };
}
