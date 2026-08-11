// app/api/uploadthing/core.ts
import { currentUser } from "@clerk/nextjs/server";
import { createUploadthing, type FileRouter } from "uploadthing/next";
import { UploadThingError } from "uploadthing/server";

const f = createUploadthing();

export const ourFileRouter = {
  // Raised from 32MB (Phase 5, long meetings) now that transcription goes
  // through Gemini's File API instead of an inline base64 request - see
  // docs/meeting-intelligence-pivot-plan.md §8. Kept well under Gemini's
  // 2GB File API cap and UploadThing's own free-tier storage budget.
  videoOrAudioUploader: f({
    video: { maxFileSize: "512MB", maxFileCount: 1 },
    audio: { maxFileSize: "256MB", maxFileCount: 1 },
  })
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    .middleware(async ({ req }) => {
      const user = await currentUser();
      if (!user) throw new UploadThingError("Unauthorized");
      return { userId: user.id };
    })
    .onUploadComplete(async ({ metadata, file }) => {
      console.log("Upload complete for userId:", metadata.userId);
      console.log("file url", file.url); // Use file.url instead of file.ufsUrl
      return { userId: metadata.userId, fileUrl: file.url };
    }),
} satisfies FileRouter;

export type OurFileRouter = typeof ourFileRouter;