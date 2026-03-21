import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const models = await prisma.mLModel.findMany({
      orderBy: [{ name: "asc" }, { version: "desc" }],
    });

    return NextResponse.json({ models });
  } catch (err) {
    console.error("Models list error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
