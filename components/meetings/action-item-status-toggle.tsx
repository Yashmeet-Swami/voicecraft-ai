"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { updateActionItemStatusAction } from "@/actions/action-item-actions";
import { cn } from "@/lib/utils";

const STATUS_ORDER = ["open", "in_progress", "done"] as const;
type Status = (typeof STATUS_ORDER)[number];

const STATUS_LABELS: Record<Status, string> = {
  open: "Open",
  in_progress: "In Progress",
  done: "Done",
};

const STATUS_STYLES: Record<Status, string> = {
  open: "bg-gray-100 text-gray-600",
  in_progress: "bg-yellow-100 text-yellow-700",
  done: "bg-green-100 text-green-700",
};

export default function ActionItemStatusToggle({
  actionItemId,
  status,
}: {
  actionItemId: number;
  status: string;
}) {
  const [current, setCurrent] = useState<Status>((status as Status) ?? "open");
  const [isUpdating, setIsUpdating] = useState(false);

  const handleClick = async () => {
    if (isUpdating) return;
    const nextIndex = (STATUS_ORDER.indexOf(current) + 1) % STATUS_ORDER.length;
    const next = STATUS_ORDER[nextIndex];

    setIsUpdating(true);
    const previous = current;
    setCurrent(next);

    try {
      const result = await updateActionItemStatusAction(actionItemId, next);
      if (!result.success) {
        setCurrent(previous);
        toast.error(result.message);
      }
    } catch (error) {
      console.error(error);
      setCurrent(previous);
      toast.error("Failed to update status due to an unexpected error.");
    } finally {
      setIsUpdating(false);
    }
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={isUpdating}
      className={cn(
        "text-xs font-medium px-2 py-1 rounded-full whitespace-nowrap transition-opacity hover:opacity-80",
        STATUS_STYLES[current]
      )}
      title="Click to change status"
    >
      {isUpdating ? <Loader2 className="w-3 h-3 animate-spin inline" /> : STATUS_LABELS[current]}
    </button>
  );
}
