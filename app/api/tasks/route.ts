import { NextResponse } from "next/server";
import { connectToDatabase } from "@/lib/mongodb";
import { Task } from "@/models/Task";

export async function GET() {
  await connectToDatabase();
  const tasks = await Task.find().sort({ date: 1, orderIndex: 1 }).lean();

  return NextResponse.json({
    tasks: tasks.map((t) => ({
      id: String(t._id),
      text: t.text,
      date: t.date,
      orderIndex: t.orderIndex,
    })),
  });
}

export async function POST(request: Request) {
  await connectToDatabase();

  const body = await request.json();
  const text = String(body.text ?? "").trim();
  const date = String(body.date ?? "").trim();

  if (!text || !date) {
    return NextResponse.json(
      { error: "Both text and date are required" },
      { status: 400 }
    );
  }

  const lastForDate = await Task.findOne({ date }).sort({ orderIndex: -1 }).lean();
  const nextIndex = (lastForDate?.orderIndex ?? 0) + 1;

  const created = await Task.create({
    text,
    date,
    orderIndex: nextIndex,
  });

  return NextResponse.json(
    {
      task: {
        id: String(created._id),
        text: created.text,
        date: created.date,
        orderIndex: created.orderIndex,
      },
    },
    { status: 201 }
  );
}

