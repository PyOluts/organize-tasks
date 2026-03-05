import { Schema, model, models, type Model } from "mongoose";

export interface TaskDocument {
  _id: string;
  text: string;
  date: string; // YYYY-MM-DD
  orderIndex: number;
}

const TaskSchema = new Schema<TaskDocument>(
  {
    text: {
      type: String,
      required: true,
      trim: true,
    },
    date: {
      type: String,
      required: true,
      index: true,
    },
    orderIndex: {
      type: Number,
      required: true,
      index: true,
    },
  },
  {
    timestamps: true,
  }
);

export const Task: Model<TaskDocument> =
  (models.Task as Model<TaskDocument>) || model<TaskDocument>("Task", TaskSchema);

