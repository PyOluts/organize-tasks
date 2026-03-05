"use client";

import React, { useEffect, useMemo, useState } from "react";
import styled from "styled-components";
import axios from "axios";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import {
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameMonth,
  startOfMonth,
  startOfWeek,
} from "date-fns";

type PublicHoliday = {
  date: string; // yyyy-MM-dd
  localName: string;
  name: string;
  countryCode: string;
};

type CalendarTask = {
  id: string;
  text: string;
  date: string; // yyyy-MM-dd
  orderIndex: number;
};

type CalendarGridProps = {
  initialDate?: Date;
  countryCode?: string;
};

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

function toISODateKey(d: Date) {
  return format(d, "yyyy-MM-dd");
}

export default function CalendarGrid({
  initialDate,
  countryCode = "US",
}: CalendarGridProps) {
  const monthDate = initialDate ?? new Date();
  const year = monthDate.getFullYear();

  const [holidayByDate, setHolidayByDate] = useState<
    Record<string, PublicHoliday>
  >({});
  const [holidayError, setHolidayError] = useState<string | null>(null);

  const [tasks, setTasks] = useState<CalendarTask[]>([]);
  const [taskFilter, setTaskFilter] = useState("");
  const [addingDate, setAddingDate] = useState<string | null>(null);
  const [addText, setAddText] = useState("");
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [draggingTaskId, setDraggingTaskId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    async function loadHolidays() {
      setHolidayError(null);

      try {
        const res = await fetch(
          `https://date.nager.at/api/v3/PublicHolidays/${year}/${countryCode}`,
          { signal: controller.signal }
        );

        if (!res.ok) {
          throw new Error(`Holiday API error: ${res.status} ${res.statusText}`);
        }

        const data = (await res.json()) as PublicHoliday[];
        const map: Record<string, PublicHoliday> = {};
        for (const h of data) map[h.date] = h;

        if (!cancelled) setHolidayByDate(map);
      } catch (e) {
        if (cancelled) return;
        if (e instanceof DOMException && e.name === "AbortError") return;
        setHolidayByDate({});
        setHolidayError(e instanceof Error ? e.message : "Failed to load holidays");
      }
    }

    void loadHolidays();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [countryCode, year]);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    })
  );

  function findTaskById(id: string) {
    return tasks.find((t) => t.id === id) ?? null;
  }

  const tasksByDate = useMemo(() => {
    const needle = taskFilter.trim().toLowerCase();
    const visible = needle
      ? tasks.filter((t) => t.text.toLowerCase().includes(needle))
      : tasks;

    const map: Record<string, CalendarTask[]> = {};
    for (const task of visible) {
      (map[task.date] ??= []).push(task);
    }
    return map;
  }, [taskFilter, tasks]);

  const { days } = useMemo(() => {
    const monthStart = startOfMonth(monthDate);
    const monthEnd = endOfMonth(monthDate);

    const gridStart = startOfWeek(monthStart, { weekStartsOn: 0 });
    const gridEnd = endOfWeek(monthEnd, { weekStartsOn: 0 });

    return {
      days: eachDayOfInterval({ start: gridStart, end: gridEnd }),
    };
  }, [monthDate]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await axios.get("/api/tasks");
        const data = res.data as {
          tasks: { id: string; text: string; date: string; orderIndex: number }[];
        };
        if (cancelled) return;
        setTasks(
          data.tasks.sort((a, b) => {
            if (a.date === b.date) return a.orderIndex - b.orderIndex;
            return a.date.localeCompare(b.date);
          })
        );
      } catch (error) {
        // eslint-disable-next-line no-console
        console.error("Error loading tasks", error);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  function openAddForDate(dateKey: string) {
    setAddingDate(dateKey);
    setAddText("");
    setEditingTaskId(null);
    setEditText("");
  }

  function cancelAdd() {
    setAddingDate(null);
    setAddText("");
  }

  function commitAdd() {
    if (!addingDate) return;
    const text = addText.trim();
    if (!text) {
      cancelAdd();
      return;
    }
    const date = addingDate;
    setAddingDate(null);
    setAddText("");
    const tempId = `temp-${Date.now()}`;
    const optimisticTask: CalendarTask = {
      id: tempId,
      text,
      date,
      orderIndex:
        (tasks
          .filter((t) => t.date === date)
          .reduce((max, t) => Math.max(max, t.orderIndex), -1) ?? -1) + 1,
    };
    setTasks((prev) => [...prev, optimisticTask]);

    void (async () => {
      try {
        const res = await axios.post("/api/tasks", { text, date });
        const created = (res.data as { task: CalendarTask }).task;
        setTasks((prev) =>
          prev.map((t) => (t.id === tempId ? created : t))
        );
      } catch (error) {
        // eslint-disable-next-line no-console
        console.error("Error creating task", error);
        setTasks((prev) => prev.filter((t) => t.id !== tempId));
      }
    })();
  }

  function startEdit(task: CalendarTask) {
    setEditingTaskId(task.id);
    setEditText(task.text);
    setAddingDate(null);
    setAddText("");
  }

  function cancelEdit() {
    setEditingTaskId(null);
    setEditText("");
  }

  function commitEdit(taskId: string) {
    const text = editText.trim();
    if (!text) {
      // Empty text = delete task (optimistic)
      const prevTasks = tasks;
      setTasks((current) => current.filter((t) => t.id !== taskId));
      void (async () => {
        try {
          await axios.delete(`/api/tasks/${taskId}`);
        } catch (error) {
          // eslint-disable-next-line no-console
          console.error("Error deleting task", error);
          setTasks(prevTasks);
        }
      })();
      cancelEdit();
      return;
    }

    setTasks((prev) =>
      prev.map((t) => (t.id === taskId ? { ...t, text } : t))
    );
    void (async () => {
      try {
        await axios.put(`/api/tasks/${taskId}`, { text });
      } catch (error) {
        // eslint-disable-next-line no-console
        console.error("Error updating task", error);
      }
    })();
    cancelEdit();
  }

  function handleDragStart(event: DragStartEvent) {
    const id = String(event.active.id);
    if (findTaskById(id)) setDraggingTaskId(id);
  }

  function handleDragEnd(event: DragEndEvent) {
    const activeId = String(event.active.id);
    const overId = event.over?.id ? String(event.over.id) : null;
    setDraggingTaskId(null);

    if (!overId) return;
    if (activeId === overId) return;

    const activeTask = findTaskById(activeId);
    if (!activeTask) return;

    const overTask = findTaskById(overId);
    const sourceDate = activeTask.date;
    const targetDate = overTask ? overTask.date : overId; // day container id is dateKey

    // Only allow dropping into a known date container (yyyy-MM-dd)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) return;

    setTasks((prev) => {
      const next = [...prev];
      const fromIndex = next.findIndex((t) => t.id === activeId);
      if (fromIndex === -1) return prev;

      // Remove the active task
      const [moved] = next.splice(fromIndex, 1);

      // Update date if moved between cells
      moved.date = targetDate;

      if (overTask) {
        // Insert before the task we dropped on
        const toIndex = next.findIndex((t) => t.id === overTask.id);
        if (toIndex === -1) {
          next.push(moved);
          return next;
        }
        next.splice(toIndex, 0, moved);
        return next;
      }

      // Dropped on a container (cell): append to end of visible tasks for that day,
      // falling back to the last task of that day if filter hides everything.
      const visibleIds = (tasksByDate[targetDate] ?? []).map((t) => t.id);
      const lastVisibleId = visibleIds.at(-1) ?? null;
      if (lastVisibleId) {
        const lastVisibleIndex = next.findIndex((t) => t.id === lastVisibleId);
        if (lastVisibleIndex !== -1) {
          next.splice(lastVisibleIndex + 1, 0, moved);
          return next;
        }
      }

      let insertAt = -1;
      for (let i = next.length - 1; i >= 0; i--) {
        if (next[i]?.date === targetDate) {
          insertAt = i;
          break;
        }
      }
      if (insertAt === -1) next.push(moved);
      else next.splice(insertAt + 1, 0, moved);

      // Recompute orderIndex for all tasks of affected dates
      const affectedDates = new Set<string>([sourceDate, targetDate]);
      const updates: { id: string; date: string; orderIndex: number }[] = [];
      for (const date of affectedDates) {
        const forDate = next
          .filter((t) => t.date === date)
          .sort((a, b) => a.orderIndex - b.orderIndex);
        forDate.forEach((t, index) => {
          if (t.orderIndex !== index) {
            t.orderIndex = index;
            updates.push({ id: t.id, date: t.date, orderIndex: t.orderIndex });
          }
        });
      }

      if (updates.length) {
        void (async () => {
          try {
            await Promise.all(
              updates.map((u) =>
                axios.put(`/api/tasks/${u.id}`, {
                  date: u.date,
                  orderIndex: u.orderIndex,
                })
              )
            );
          } catch (error) {
            // eslint-disable-next-line no-console
            console.error("Error persisting drag reorder", error);
          }
        })();
      }

      return next;
    });
  }

  return (
    <CalendarCard>
      <Header>
        <Title>{format(monthDate, "MMMM yyyy")}</Title>
        <SubTitle>
          Holidays: {countryCode} {holidayError ? "• failed to load" : ""}
        </SubTitle>
      </Header>

      <FilterRow>
        <FilterLabel htmlFor="taskFilter">Filter tasks</FilterLabel>
        <FilterInput
          id="taskFilter"
          value={taskFilter}
          placeholder="Type to filter tasks…"
          onChange={(e) => setTaskFilter(e.target.value)}
        />
      </FilterRow>

      <Weekdays>
        {WEEKDAY_LABELS.map((d) => (
          <Weekday key={d}>{d}</Weekday>
        ))}
      </Weekdays>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <Grid role="grid" aria-label="Monthly calendar">
          {days.map((date) => {
            const inMonth = isSameMonth(date, monthDate);
            const dateKey = toISODateKey(date);
            const holiday = holidayByDate[dateKey];
            const visibleTasks = tasksByDate[dateKey] ?? [];

            return (
              <DroppableDayCell
                key={dateKey}
                dateKey={dateKey}
                inMonth={inMonth}
                onClick={() => {
                  if (draggingTaskId) return;
                  openAddForDate(dateKey);
                }}
              >
                <DayNumber $inMonth={inMonth}>{format(date, "d")}</DayNumber>
                {holiday ? (
                  <HolidayLabel title={holiday.name}>{holiday.name}</HolidayLabel>
                ) : null}

                <CellBody>
                  <SortableContext
                    items={visibleTasks.map((t) => t.id)}
                    strategy={verticalListSortingStrategy}
                  >
                    <Tasks>
                      {visibleTasks.map((t) => (
                        <SortableTaskRow
                          key={t.id}
                          task={t}
                          isEditing={editingTaskId === t.id}
                          editText={editText}
                          setEditText={setEditText}
                          onStartEdit={() => startEdit(t)}
                          onCancelEdit={cancelEdit}
                          onCommitEdit={() => commitEdit(t.id)}
                          draggingTaskId={draggingTaskId}
                        />
                      ))}
                    </Tasks>
                  </SortableContext>

                  {addingDate === dateKey ? (
                    <InlineInput
                      value={addText}
                      placeholder="Add a task…"
                      onChange={(e) => setAddText(e.target.value)}
                      onClick={(e) => e.stopPropagation()}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") commitAdd();
                        if (e.key === "Escape") cancelAdd();
                      }}
                      onBlur={() => commitAdd()}
                      autoFocus
                      aria-label="Add new task"
                    />
                  ) : null}
                </CellBody>
              </DroppableDayCell>
            );
          })}
        </Grid>
      </DndContext>
    </CalendarCard>
  );
}

function DroppableDayCell({
  children,
  dateKey,
  inMonth,
  onClick,
}: {
  children: React.ReactNode;
  dateKey: string;
  inMonth: boolean;
  onClick: () => void;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: dateKey,
    data: { type: "day", dateKey },
  });

  return (
    <DayCell
      ref={setNodeRef}
      $inMonth={inMonth}
      $isOver={isOver}
      onClick={onClick}
      role="gridcell"
    >
      {children}
    </DayCell>
  );
}

function SortableTaskRow({
  task,
  isEditing,
  editText,
  setEditText,
  onStartEdit,
  onCancelEdit,
  onCommitEdit,
  draggingTaskId,
}: {
  task: CalendarTask;
  isEditing: boolean;
  editText: string;
  setEditText: React.Dispatch<React.SetStateAction<string>>;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onCommitEdit: () => void;
  draggingTaskId: string | null;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({
      id: task.id,
      disabled: isEditing,
      data: { type: "task", dateKey: task.date },
    });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  if (isEditing) {
    return (
      <TaskRow ref={setNodeRef} style={style} $isDragging={isDragging}>
        <InlineInput
          value={editText}
          onChange={(e) => setEditText(e.target.value)}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            if (e.key === "Enter") onCommitEdit();
            if (e.key === "Escape") onCancelEdit();
          }}
          onBlur={() => onCommitEdit()}
          autoFocus
          aria-label="Edit task"
        />
      </TaskRow>
    );
  }

  return (
    <TaskRow
      ref={setNodeRef}
      style={style}
      $isDragging={isDragging}
      onClick={(e) => e.stopPropagation()}
    >
      <TaskPill
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          if (draggingTaskId) return;
          onStartEdit();
        }}
        title={task.text}
        {...attributes}
        {...listeners}
      >
        {task.text}
      </TaskPill>
    </TaskRow>
  );
}

const CalendarCard = styled.section`
  width: min(980px, calc(100vw - 48px));
  margin: 24px auto;
  padding: 18px;
  border-radius: 16px;
  background: #ffffff;
  border: 1px solid rgba(15, 23, 42, 0.12);
  box-shadow: 0 12px 30px rgba(15, 23, 42, 0.08);
`;

const Header = styled.header`
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 14px;
`;

const Title = styled.h1`
  margin: 0;
  font-size: 20px;
  line-height: 1.2;
  letter-spacing: -0.02em;
  color: #0f172a;
`;

const SubTitle = styled.p`
  margin: 0;
  font-size: 13px;
  color: rgba(15, 23, 42, 0.65);
`;

const FilterRow = styled.div`
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 10px;
  align-items: center;
  margin: 14px 0 12px;
  padding: 10px 12px;
  border-radius: 12px;
  border: 1px solid rgba(15, 23, 42, 0.12);
  background: #f8fafc;
`;

const FilterLabel = styled.label`
  font-size: 12px;
  font-weight: 700;
  color: rgba(15, 23, 42, 0.7);
`;

const FilterInput = styled.input`
  width: 100%;
  height: 36px;
  border-radius: 10px;
  border: 1px solid rgba(15, 23, 42, 0.14);
  padding: 0 12px;
  font-size: 14px;
  outline: none;
  background: #ffffff;
  color: #0f172a;

  &:focus {
    border-color: rgba(37, 99, 235, 0.6);
    box-shadow: 0 0 0 4px rgba(37, 99, 235, 0.15);
  }
`;

const Weekdays = styled.div`
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  gap: 8px;
  margin-bottom: 8px;
`;

const Weekday = styled.div`
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.02em;
  color: rgba(15, 23, 42, 0.65);
  padding: 8px 10px;
`;

const Grid = styled.div`
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  gap: 0;
  border-top: 1px solid #dfe1e6;
  border-left: 1px solid #dfe1e6;
`;

const DayCell = styled.div<{ $inMonth: boolean; $isOver: boolean }>`
  position: relative;
  min-height: 120px;
  border-right: 1px solid #dfe1e6;
  border-bottom: 1px solid #dfe1e6;
  background: ${({ $inMonth }) => ($inMonth ? "#f4f5f7" : "#ebecf0")};
  overflow: hidden;
  cursor: text;

  ${({ $isOver }) =>
    $isOver
      ? `
    box-shadow: inset 0 0 0 2px rgba(0, 121, 191, 0.4);
  `
      : ""}
`;

const DayNumber = styled.div<{ $inMonth: boolean }>`
  position: absolute;
  top: 6px;
  left: 8px;
  font-size: 12px;
  font-weight: 600;
  color: ${({ $inMonth }) => ($inMonth ? "#172b4d" : "rgba(9, 30, 66, 0.5)")};
  z-index: 2;
`;

const HolidayLabel = styled.div`
  position: absolute;
  top: 20px;
  left: 8px;
  right: 8px;
  padding: 0;
  color: #6b778c;
  font-size: 11px;
  font-weight: 600;
  line-height: 1.2;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  pointer-events: none;
  user-select: none;
`;

const CellBody = styled.div`
  padding: 40px 8px 8px;
  display: flex;
  flex-direction: column;
  gap: 8px;
`;

const Tasks = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
`;

const TaskRow = styled.div<{ $isDragging: boolean }>`
  opacity: ${({ $isDragging }) => ($isDragging ? 0.65 : 1)};
`;

const TaskPill = styled.button`
  width: 100%;
  text-align: left;
  position: relative;
  border: none;
  background: #ffffff;
  color: #172b4d;
  border-radius: 3px;
  padding: 4px 8px 4px 12px;
  font-size: 12px;
  line-height: 1.3;
  cursor: grab;
  box-shadow: 0 1px 0 rgba(9, 30, 66, 0.25);
  overflow: hidden;

  &:hover {
    background: #fafbfc;
  }

  &:active {
    cursor: grabbing;
  }

  &::before {
    content: "";
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    width: 4px;
    background: #61bd4f;
  }
`;

const InlineInput = styled.input`
  width: 100%;
  height: 32px;
  border-radius: 10px;
  border: 1px solid rgba(15, 23, 42, 0.18);
  padding: 0 10px;
  font-size: 12px;
  outline: none;
  background: #ffffff;
  color: #0f172a;

  &:focus {
    border-color: rgba(37, 99, 235, 0.6);
    box-shadow: 0 0 0 4px rgba(37, 99, 235, 0.15);
  }
`;

