import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { processNextJob } from "@/actions/job-actions";

// Lazy job trigger — called by the client while a meeting is
// uploaded/processing (see components/meetings/job-poller.tsx). Claims and
// runs at most one queued job per call. See docs/meeting-intelligence-pivot-plan.md §5
// for why this replaces a cron-based trigger in Phase 1.
export async function POST() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await processNextJob();
  return NextResponse.json(result);
}
