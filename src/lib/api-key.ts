import { createHash } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "./prisma";

function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

export async function validateApiKey(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return { error: NextResponse.json({ error: "Missing API key" }, { status: 401 }), apiKey: null };
  }

  const key = authHeader.slice(7);
  const keyHash = hashApiKey(key);

  const apiKey = await prisma.apiKey.findUnique({
    where: { keyHash },
    include: { organization: true, farm: { include: { zones: true } } },
  });

  if (!apiKey) {
    return { error: NextResponse.json({ error: "Invalid API key" }, { status: 401 }), apiKey: null };
  }

  // Update last used timestamp
  await prisma.apiKey.update({
    where: { id: apiKey.id },
    data: { lastUsedAt: new Date() },
  });

  return { error: null, apiKey };
}

export function generateApiKey(): { key: string; keyHash: string; prefix: string } {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let key = "agv_";
  for (let i = 0; i < 48; i++) {
    key += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return {
    key,
    keyHash: hashApiKey(key),
    prefix: key.slice(0, 8),
  };
}
