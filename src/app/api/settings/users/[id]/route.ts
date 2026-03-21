import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (session.user.role !== "OWNER") {
    return NextResponse.json({ error: "Only owners can manage users" }, { status: 403 });
  }

  try {
    const { id } = await params;
    const { role } = await request.json();

    // Cannot change own role
    if (id === session.user.id) {
      return NextResponse.json({ error: "Cannot change your own role" }, { status: 400 });
    }

    const user = await prisma.user.findUnique({ where: { id } });
    if (!user || user.organizationId !== session.user.organizationId) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const updated = await prisma.user.update({
      where: { id },
      data: { role },
    });

    return NextResponse.json({ id: updated.id, role: updated.role });
  } catch (err) {
    console.error("User update error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (session.user.role !== "OWNER") {
    return NextResponse.json({ error: "Only owners can manage users" }, { status: 403 });
  }

  try {
    const { id } = await params;

    // Cannot delete self
    if (id === session.user.id) {
      return NextResponse.json({ error: "Cannot remove yourself" }, { status: 400 });
    }

    const user = await prisma.user.findUnique({ where: { id } });
    if (!user || user.organizationId !== session.user.organizationId) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    await prisma.user.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("User delete error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
