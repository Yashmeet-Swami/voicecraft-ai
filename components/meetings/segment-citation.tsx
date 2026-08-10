"use client";

import { Clock } from "lucide-react";
import { useMeetingWorkspace } from "./meeting-workspace";
import { formatTimestamp } from "@/lib/utils";

export default function SegmentCitation({
  segmentId,
  startSeconds,
}: {
  segmentId: number | null;
  startSeconds: number | null;
}) {
  const { jumpToSegment } = useMeetingWorkspace();
  if (segmentId == null) return null;

  return (
    <button
      type="button"
      onClick={() => jumpToSegment(segmentId)}
      className="inline-flex items-center gap-1 bg-transparent hover:bg-transparent text-xs text-purple-600 hover:text-purple-800 font-medium whitespace-nowrap"
    >
      <Clock className="w-3 h-3" />
      {startSeconds != null ? formatTimestamp(startSeconds) : "source"}
    </button>
  );
}
