"use client";

import { useEffect, useRef } from "react";
import { useMeetingWorkspace, type MeetingSegmentData } from "./meeting-workspace";
import { formatTimestamp } from "@/lib/utils";

export default function TimelineView({ segments }: { segments: MeetingSegmentData[] }) {
  const { highlightedSegmentId } = useMeetingWorkspace();
  const refs = useRef<Record<number, HTMLDivElement | null>>({});

  useEffect(() => {
    if (highlightedSegmentId != null) {
      refs.current[highlightedSegmentId]?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [highlightedSegmentId]);

  if (segments.length === 0) {
    return <p className="text-gray-500">No timeline available for this meeting.</p>;
  }

  return (
    <div className="space-y-2 max-h-[32rem] overflow-y-auto">
      {segments.map((seg) => (
        <div
          key={seg.id}
          ref={(el) => {
            refs.current[seg.id] = el;
          }}
          className={`p-3 rounded-lg border flex gap-3 transition-colors ${
            highlightedSegmentId === seg.id ? "bg-purple-50 border-purple-300" : "bg-white"
          }`}
        >
          <span className="text-xs font-mono text-purple-600 whitespace-nowrap pt-0.5">
            {seg.start_seconds != null ? formatTimestamp(seg.start_seconds) : "--:--"}
          </span>
          <div>
            {seg.speaker_label && (
              <span className="text-xs font-semibold text-gray-500 mr-2">{seg.speaker_label}</span>
            )}
            <span className="text-gray-700">{seg.text}</span>
          </div>
        </div>
      ))}
    </div>
  );
}
