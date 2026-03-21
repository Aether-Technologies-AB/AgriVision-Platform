"use client";

import { useState, useCallback, useEffect } from "react";
import { Database } from "lucide-react";
import ChatThread from "@/components/chat/ChatThread";
import ChatInput from "@/components/chat/ChatInput";
import SuggestedPrompts from "@/components/chat/SuggestedPrompts";

interface Message {
  role: "user" | "assistant";
  content: string;
}

interface ZoneInfo {
  id: string;
  name: string;
  agentStatus: string;
  currentPhase: string;
  farm: { name: string };
}

export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [pendingPrompt, setPendingPrompt] = useState<string | undefined>();
  const [contextInfo, setContextInfo] = useState<{
    zoneName: string;
    activeBatch: string;
    historyMonths: number;
  } | null>(null);

  // Fetch context info for the badge
  useEffect(() => {
    Promise.all([
      fetch("/api/zones").then((r) => r.json()),
      fetch("/api/batches?status=active").then((r) => r.json()),
    ]).then(([zonesData, batchesData]) => {
      const zones: ZoneInfo[] = zonesData.zones || [];
      const batches = batchesData.batches || [];
      setContextInfo({
        zoneName: zones.map((z) => z.name).join(", ") || "No zones",
        activeBatch: batches[0]?.batchNumber || "None",
        historyMonths: 6,
      });
    });
  }, []);

  const sendMessage = useCallback(
    async (text: string) => {
      const userMsg: Message = { role: "user", content: text };
      setMessages((prev) => [...prev, userMsg]);
      setIsStreaming(true);

      try {
        const history = messages.slice(-10).map((m) => ({
          role: m.role,
          content: m.content,
        }));

        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: text, history }),
        });

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          setMessages((prev) => [
            ...prev,
            {
              role: "assistant",
              content: `Sorry, I encountered an error: ${errData.error || "Unknown error"}. Please try again.`,
            },
          ]);
          setIsStreaming(false);
          return;
        }

        // Stream the response
        const reader = res.body?.getReader();
        if (!reader) {
          setMessages((prev) => [
            ...prev,
            { role: "assistant", content: "Failed to read response stream." },
          ]);
          setIsStreaming(false);
          return;
        }

        const decoder = new TextDecoder();
        let accumulated = "";

        // Add empty assistant message that we'll update
        setMessages((prev) => [...prev, { role: "assistant", content: "" }]);

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          accumulated += decoder.decode(value, { stream: true });
          // Update the last message with accumulated text
          setMessages((prev) => {
            const updated = [...prev];
            updated[updated.length - 1] = {
              role: "assistant",
              content: accumulated,
            };
            return updated;
          });
        }
      } catch (err) {
        console.error("Chat error:", err);
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: "Sorry, I couldn't connect to the AI service. Please check your connection and try again.",
          },
        ]);
      } finally {
        setIsStreaming(false);
      }
    },
    [messages]
  );

  function handleSuggestion(prompt: string) {
    setPendingPrompt(undefined);
    sendMessage(prompt);
  }

  // Handle pending prompt from input
  useEffect(() => {
    if (pendingPrompt) {
      sendMessage(pendingPrompt);
      setPendingPrompt(undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingPrompt]);

  return (
    <div className="flex h-[calc(100vh-3rem)] flex-col">
      {/* Chat thread */}
      <div className="flex-1 overflow-hidden">
        {messages.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <SuggestedPrompts onSelect={handleSuggestion} />
          </div>
        ) : (
          <ChatThread messages={messages} isStreaming={isStreaming} />
        )}
      </div>

      {/* Context badge */}
      {contextInfo && (
        <div className="flex justify-center border-t border-border/50 bg-bg px-4 py-1.5">
          <div className="flex items-center gap-1.5 text-[10px] text-text-dim">
            <Database className="h-3 w-3" />
            <span>
              Context: {contextInfo.zoneName} &bull; {contextInfo.activeBatch} &bull;{" "}
              {contextInfo.historyMonths} months history
            </span>
          </div>
        </div>
      )}

      {/* Input bar */}
      <ChatInput onSend={sendMessage} disabled={isStreaming} />
    </div>
  );
}
