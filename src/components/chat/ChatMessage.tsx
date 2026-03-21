"use client";

import { User, Brain } from "lucide-react";

interface ChatMessageProps {
  role: "user" | "assistant";
  content: string;
}

function renderMarkdown(text: string): string {
  return text
    // Bold
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    // Italic
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    // Inline code
    .replace(/`([^`]+)`/g, '<code class="rounded bg-border/60 px-1 py-0.5 font-mono text-[11px]">$1</code>')
    // Bullet lists
    .replace(/^[-•] (.+)$/gm, '<li class="ml-4 list-disc">$1</li>')
    // Numbered lists
    .replace(/^\d+\. (.+)$/gm, '<li class="ml-4 list-decimal">$1</li>')
    // Line breaks
    .replace(/\n/g, "<br />");
}

export default function ChatMessage({ role, content }: ChatMessageProps) {
  if (role === "user") {
    return (
      <div className="flex justify-end">
        <div className="flex max-w-[80%] items-start gap-2">
          <div className="rounded-xl rounded-tr-sm bg-green/15 px-4 py-2.5">
            <p className="text-sm text-text">{content}</p>
          </div>
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-green/20">
            <User className="h-3.5 w-3.5 text-green" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex justify-start">
      <div className="flex max-w-[85%] items-start gap-2">
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-purple/20">
          <Brain className="h-3.5 w-3.5 text-purple" />
        </div>
        <div className="rounded-xl rounded-tl-sm border border-border bg-bg-card px-4 py-2.5">
          <div
            className="prose-sm text-sm leading-relaxed text-text [&_strong]:font-semibold [&_strong]:text-green [&_em]:text-text-mid [&_li]:text-text-mid [&_code]:text-amber"
            dangerouslySetInnerHTML={{ __html: renderMarkdown(content) }}
          />
        </div>
      </div>
    </div>
  );
}
