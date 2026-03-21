import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { validateApiKey } from "@/lib/api-key";

const VALID_STATUSES = ["ACKNOWLEDGED", "EXECUTED", "FAILED"] as const;

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, apiKey } = await validateApiKey(request);
  if (error) return error;

  try {
    const { id } = await params;
    const { status, result } = await request.json();

    if (!status) {
      return NextResponse.json(
        { error: "status is required" },
        { status: 400 }
      );
    }

    if (!VALID_STATUSES.includes(status)) {
      return NextResponse.json(
        { error: `Invalid status. Must be one of: ${VALID_STATUSES.join(", ")}` },
        { status: 400 }
      );
    }

    // Find the command and verify it belongs to the key's organization
    const command = await prisma.command.findUnique({
      where: { id },
      include: { zone: { include: { farm: true } } },
    });

    if (!command) {
      return NextResponse.json(
        { error: "Command not found" },
        { status: 404 }
      );
    }

    if (command.zone.farm.organizationId !== apiKey!.organizationId) {
      return NextResponse.json(
        { error: "Access denied" },
        { status: 403 }
      );
    }

    const updated = await prisma.command.update({
      where: { id },
      data: {
        status,
        result: result ?? null,
        executedAt: status === "EXECUTED" || status === "FAILED" ? new Date() : undefined,
      },
    });

    return NextResponse.json({
      id: updated.id,
      status: updated.status,
    });
  } catch (err) {
    console.error("Agent command update error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
