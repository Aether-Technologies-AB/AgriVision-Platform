import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

export { anthropic };

export async function callClaude({
  system,
  messages,
  maxTokens = 1000,
}: {
  system: string;
  messages: { role: "user" | "assistant"; content: string }[];
  maxTokens?: number;
}) {
  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: maxTokens,
    system,
    messages,
  });

  const textBlock = response.content.find((b) => b.type === "text");
  return textBlock?.text || "";
}

export function streamClaude({
  system,
  messages,
  maxTokens = 1500,
}: {
  system: string;
  messages: { role: "user" | "assistant"; content: string }[];
  maxTokens?: number;
}) {
  return anthropic.messages.stream({
    model: "claude-sonnet-4-20250514",
    max_tokens: maxTokens,
    system,
    messages,
  });
}
