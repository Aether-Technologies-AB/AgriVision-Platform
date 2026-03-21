"use client";

import { useRef, useEffect } from "react";
import ChatMessage from "./ChatMessage";
import { Loader2 } from "lucide-react";

interface Message {
  role: "user" | "assistant";
  content: string;
}

export default function ChatThread({
  messages,
  isStreaming,
}: {
  messages: Message[];
  isStreaming: boolean;
}) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isStreaming]);

  return (
    <div className="flex-1 overflow-y-auto p-4">
      <div className="mx-auto max-w-3xl space-y-4">
        {messages.map((msg, i) => (
          <ChatMessage key={i} role={msg.role} content={msg.content} />
        ))}

        {isStreaming && messages.length > 0 && messages[messages.length - 1].role === "user" && (
          <div className="flex justify-start">
            <div className="flex items-start gap-2">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-purple/20">
                <Loader2 className="h-3.5 w-3.5 animate-spin text-purple" />
              </div>
              <div className="rounded-xl rounded-tl-sm border border-border bg-bg-card px-4 py-3">
                <div className="flex items-center gap-1.5">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-purple" />
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-purple" style={{ animationDelay: "0.2s" }} />
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-purple" style={{ animationDelay: "0.4s" }} />
                </div>
              </div>
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>
    </div>
  );
}
