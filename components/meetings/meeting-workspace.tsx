"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

export interface MeetingSegmentData {
  id: number;
  segment_index: number;
  speaker_label: string | null;
  start_seconds: number | null;
  end_seconds: number | null;
  text: string;
}

interface Tab {
  id: string;
  label: string;
  content: React.ReactNode;
}

interface WorkspaceContextValue {
  jumpToSegment: (segmentId: number | null) => void;
  highlightedSegmentId: number | null;
}

const WorkspaceContext = createContext<WorkspaceContextValue>({
  jumpToSegment: () => {},
  highlightedSegmentId: null,
});

export function useMeetingWorkspace(): WorkspaceContextValue {
  return useContext(WorkspaceContext);
}

// Owns tab state, the audio element, and "jump to source" coordination so
// that clicking a citation on a decision/action item/question switches to
// the Timeline tab and seeks + plays the audio at that segment's start time.
export default function MeetingWorkspace({
  audioUrl,
  segments,
  tabs,
  initialSeekSeconds,
}: {
  audioUrl: string | null;
  segments: MeetingSegmentData[];
  tabs: Tab[];
  // Deep-link support: jump straight to the nearest segment on mount, e.g.
  // when arriving from an "Ask across meetings" citation (/meetings/1?t=42).
  initialSeekSeconds?: number | null;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [activeId, setActiveId] = useState(tabs[0]?.id);
  const [highlightedSegmentId, setHighlightedSegmentId] = useState<number | null>(null);
  const active = tabs.find((tab) => tab.id === activeId) ?? tabs[0];

  const jumpToSegment = (segmentId: number | null) => {
    if (segmentId == null) return;
    const segment = segments.find((s) => s.id === segmentId);
    if (!segment) return;

    setActiveId("timeline");
    setHighlightedSegmentId(segmentId);

    if (audioRef.current && segment.start_seconds != null) {
      audioRef.current.currentTime = segment.start_seconds;
      audioRef.current.play().catch(() => {});
    }
  };

  useEffect(() => {
    if (initialSeekSeconds == null) return;

    let nearest: MeetingSegmentData | null = null;
    let bestDiff = Infinity;
    for (const seg of segments) {
      if (seg.start_seconds == null) continue;
      const diff = Math.abs(seg.start_seconds - initialSeekSeconds);
      if (diff < bestDiff) {
        bestDiff = diff;
        nearest = seg;
      }
    }
    if (nearest) jumpToSegment(nearest.id);
    // Only run once on mount - deliberately ignores later prop changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <WorkspaceContext.Provider value={{ jumpToSegment, highlightedSegmentId }}>
      {audioUrl && (
        <audio ref={audioRef} controls src={audioUrl} className="w-full mb-6 rounded-lg" />
      )}

      <div className="flex gap-2 border-b border-gray-200 mb-6 overflow-x-auto">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveId(tab.id)}
            className={cn(
              "px-4 py-2 text-sm font-medium whitespace-nowrap border-b-2 transition-colors",
              activeId === tab.id
                ? "border-purple-600 text-purple-600"
                : "border-transparent text-gray-500 hover:text-gray-700"
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div>{active?.content}</div>
    </WorkspaceContext.Provider>
  );
}
