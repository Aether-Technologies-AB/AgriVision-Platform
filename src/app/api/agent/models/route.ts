import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { validateApiKey } from "@/lib/api-key";

export async function GET(request: NextRequest) {
  const { error } = await validateApiKey(request);
  if (error) return error;

  try {
    const cropType = request.nextUrl.searchParams.get("cropType");

    const where = {
      isActive: true,
      ...(cropType
        ? { cropType: { in: [cropType, "all"] } }
        : {}),
    };

    const models = await prisma.mLModel.findMany({
      where,
      select: {
        name: true,
        version: true,
        fileUrl: true,
        fileSizeMb: true,
      },
      orderBy: { name: "asc" },
    });

    return NextResponse.json({ models });
  } catch (err) {
    console.error("Agent models error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
