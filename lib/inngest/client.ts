import { Inngest } from "inngest";

// In dev (no INNGEST_EVENT_KEY set), the SDK talks to the local Inngest Dev
// Server (`npx inngest-cli@latest dev`) automatically - no account needed to
// develop against this. Production requires INNGEST_EVENT_KEY and
// INNGEST_SIGNING_KEY (see docs/meeting-intelligence-pivot-plan.md §5/§9).
export const inngest = new Inngest({ id: "voicecraftai" });
