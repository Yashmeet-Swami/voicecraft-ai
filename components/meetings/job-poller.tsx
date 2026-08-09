"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

// Lazily drives the processing_jobs queue while the dashboard/detail page is
// open (no cron needed — see docs/meeting-intelligence-pivot-plan.md §5).
// Stops automatically once the parent re-renders with `active = false`.
export default function JobPoller({
  active,
  intervalMs = 4000,
}: {
  active: boolean;
  intervalMs?: number;
}) {
  const router = useRouter();
  const inFlight = useRef(false);

  useEffect(() => {
    if (!active) return;

    const tick = async () => {
      if (inFlight.current) return;
      inFlight.current = true;
      try {
        await fetch("/api/jobs/process", { method: "POST" });
      } catch (error) {
        console.error("Job poll failed:", error);
      } finally {
        inFlight.current = false;
        router.refresh();
      }
    };

    tick();
    const id = setInterval(tick, intervalMs);
    return () => clearInterval(id);
  }, [active, intervalMs, router]);

  return null;
}
