import { inngest } from "./client";
import { processNextJob } from "@/actions/job-actions";

const MAX_JOBS_PER_INVOCATION = 5;

// Triggered by a "meeting/processing.requested" event sent from
// createMeetingAction / retryMeetingAction. Drains the queue (up to a small
// cap) rather than assuming a strict 1:1 event-to-job mapping, so a missed
// or duplicate event can't strand a job - without changing
// processNextJob()'s "claim exactly one queued job" contract (see
// docs/meeting-intelligence-pivot-plan.md §5, Phase 3.5).
export const processMeetingJob = inngest.createFunction(
  { id: "process-meeting-job", triggers: [{ event: "meeting/processing.requested" }] },
  async () => {
    let processedCount = 0;

    for (let i = 0; i < MAX_JOBS_PER_INVOCATION; i++) {
      const result = await processNextJob();
      if (!result.processed) break;
      processedCount++;
    }

    return { processedCount };
  }
);
