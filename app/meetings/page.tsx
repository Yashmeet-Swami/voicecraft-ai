import BgGradient from "@/components/common/gradient";
import getDbConnection from "@/lib/db";
import { currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import MeetingUploadForm from "@/components/meetings/meeting-upload-form";
import DeleteMeetingButton from "@/components/meetings/delete-meeting-button";
import JobPoller from "@/components/meetings/job-poller";

interface Meeting {
  id: number;
  title: string;
  status: string;
  created_at: string;
}

const STATUS_STYLES: Record<string, string> = {
  uploaded: "bg-gray-100 text-gray-600",
  processing: "bg-yellow-100 text-yellow-700",
  ready: "bg-green-100 text-green-700",
  failed: "bg-red-100 text-red-700",
};

function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`text-xs font-medium px-2 py-1 rounded-full whitespace-nowrap ${
        STATUS_STYLES[status] ?? STATUS_STYLES.uploaded
      }`}
    >
      {status}
    </span>
  );
}

export default async function MeetingsPage() {
  const user = await currentUser();
  if (!user) return redirect("/sign-in");

  const sql = await getDbConnection();
  const meetings = (await sql`
    SELECT id, title, status, created_at
    FROM meetings
    WHERE user_id = ${user.id}
    ORDER BY created_at DESC
  `) as unknown as Meeting[];

  const hasPendingWork = meetings.some(
    (m) => m.status === "uploaded" || m.status === "processing"
  );

  return (
    <BgGradient>
      <JobPoller active={hasPendingWork} />
      <main className="mx-auto w-full max-w-screen-xl px-2.5 lg:px-0 mb-12 mt-28">
        <div className="text-center mb-10">
          <h2 className="text-3xl font-bold text-gray-900 mb-2">Meeting Intelligence 🎙️</h2>
          <p className="text-gray-600 text-lg max-w-2xl mx-auto">
            Upload a meeting recording and get a summary, decisions, action items, and open
            questions — automatically.
          </p>
        </div>

        <div className="mb-12">
          <MeetingUploadForm />
        </div>

        <div className="flex items-center justify-between mb-4">
          <h3 className="text-xl font-semibold text-gray-800">Your meetings</h3>
          <Link
            href="/meetings/ask"
            className="text-purple-600 hover:text-purple-800 font-medium flex gap-1 items-center text-sm"
          >
            Ask across your meetings <ArrowRight className="w-4 h-4" />
          </Link>
        </div>

        {meetings.length === 0 ? (
          <p className="text-gray-600 text-lg">
            No meetings yet. Upload a recording above to get started.
          </p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {meetings.map((meeting) => (
              <div
                key={meeting.id}
                className="bg-white shadow-md rounded-lg p-6 hover:shadow-lg transition-shadow duration-300"
              >
                <div className="flex items-start justify-between gap-2 mb-2">
                  <h4 className="text-lg font-semibold text-gray-800 truncate">
                    {meeting.title}
                  </h4>
                  <StatusBadge status={meeting.status} />
                </div>
                <p className="text-sm text-gray-500 mb-4">
                  {new Date(meeting.created_at).toLocaleString()}
                </p>
                <div className="flex justify-between items-center">
                  <Link
                    href={`/meetings/${meeting.id}`}
                    className="text-purple-600 hover:text-purple-800 font-medium flex gap-1 items-center"
                  >
                    View <ArrowRight className="w-4 h-4" />
                  </Link>
                  <DeleteMeetingButton meetingId={meeting.id} />
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </BgGradient>
  );
}
