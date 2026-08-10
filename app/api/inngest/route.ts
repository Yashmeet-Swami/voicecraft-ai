import { serve } from "inngest/next";
import { inngest } from "@/lib/inngest/client";
import { processMeetingJob } from "@/lib/inngest/functions";

// Inngest calls this endpoint itself (signed, not a Clerk-authenticated
// request) - excluded from Clerk's auth.protect() in middleware.ts, same
// treatment as /api/uploadthing.
export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [processMeetingJob],
});
