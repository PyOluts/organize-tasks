import { NextRequest, NextResponse } from "next/server";
import { connectToDatabase } from "@/lib/mongodb";
import { Task } from "@/models/Task";

export async function PUT(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  await connectToDatabase();

  const { id } = await context.params;
  const body = await request.json();

  const update: Record<string, unknown> = {};

  if (typeof body.text === "string") {
    update.text = String(body.text).trim();
  }

  if (typeof body.date === "string") {
    update.date = String(body.date);
  }

  if (typeof body.orderIndex === "number") {
    update.orderIndex = body.orderIndex;
  }

  const updated = await Task.findByIdAndUpdate(id, update, {
    returnDocument: "after",
  }).lean();

  if (!updated) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  return NextResponse.json({
    task: {
      id: String(updated._id),
      text: updated.text,
      date: updated.date,
      orderIndex: updated.orderIndex,
    },
  });
}

export async function DELETE(
  _: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  await connectToDatabase();

  const { id } = await context.params;
  await Task.findByIdAndDelete(id);

  return NextResponse.json({ success: true });
}

