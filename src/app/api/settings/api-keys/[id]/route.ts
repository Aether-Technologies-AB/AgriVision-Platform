import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { id } = await params;

    const key = await prisma.apiKey.findUnique({ where: { id } });

    if (!key || key.organizationId !== session.user.organizationId) {
      return NextResponse.json({ error: "API key not found" }, { status: 404 });
    }

    await prisma.apiKey.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("API key delete error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
