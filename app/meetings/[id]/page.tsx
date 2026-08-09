import BgGradient from "@/components/common/gradient";
import getDbConnection from "@/lib/db";
import { currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import JobPoller from "@/components/meetings/job-poller";
import RetryMeetingButton from "@/components/meetings/retry-meeting-button";
import MeetingWorkspace, { type MeetingSegmentData } from "@/components/meetings/meeting-workspace";
import TimelineView from "@/components/meetings/timeline-view";
import SegmentCitation from "@/components/meetings/segment-citation";
import AskPanel from "@/components/meetings/ask-panel";
import { askMeeting } from "@/actions/knowledge-actions";
import { formatTimestamp } from "@/lib/utils";

interface Meeting {
  id: number;
  title: string;
  status: string;
  summary: string | null;
  audio_url: string | null;
  duration_seconds: number | null;
  created_at: string;
}

interface Transcript {
  raw_text: string;
  cleaned_text: string | null;
}

interface Decision {
  id: number;
  text: string;
  source_segment_id: number | null;
  start_seconds: number | null;
}

interface ActionItem {
  id: number;
  task: string;
  owner_name: string | null;
  due_date: string | null;
  status: string;
  source_segment_id: number | null;
  start_seconds: number | null;
}

interface OpenQuestion {
  id: number;
  text: string;
  source_segment_id: number | null;
  start_seconds: number | null;
}

const STATUS_STYLES: Record<string, string> = {
  uploaded: "bg-gray-100 text-gray-600",
  processing: "bg-yellow-100 text-yellow-700",
  ready: "bg-green-100 text-green-700",
  failed: "bg-red-100 text-red-700",
};

function StatusPill({ status }: { status: string }) {
  return (
    <span
      className={`text-sm font-medium px-3 py-1 rounded-full ${
        STATUS_STYLES[status] ?? STATUS_STYLES.uploaded
      }`}
    >
      {status}
    </span>
  );
}

export default async function MeetingDetailPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { t?: string };
}) {
  const { id } = await params;
  const { t } = await searchParams;
  const initialSeekSeconds = t && !Number.isNaN(Number(t)) ? Number(t) : null;

  const user = await currentUser();
  if (!user) return redirect("/sign-in");

  const sql = await getDbConnection();

  const meetings = (await sql`
    SELECT id, title, status, summary, audio_url, duration_seconds, created_at
    FROM meetings
    WHERE id = ${id} AND user_id = ${user.id}
  `) as unknown as Meeting[];

  if (!meetings || meetings.length === 0) {
    return (
      <div className="mx-auto w-full max-w-screen-xl px-2.5 lg:px-0 mb-12 mt-28">
        <p>No meeting found.</p>
      </div>
    );
  }

  const meeting = meetings[0];
  const isPending = meeting.status === "uploaded" || meeting.status === "processing";

  const [transcripts, decisions, actionItems, openQuestions, segments] = await Promise.all([
    sql`SELECT raw_text, cleaned_text FROM transcripts WHERE meeting_id = ${meeting.id}` as unknown as Promise<
      Transcript[]
    >,
    sql`
      SELECT d.id, d.text, d.source_segment_id, ms.start_seconds
      FROM decisions d
      LEFT JOIN meeting_segments ms ON ms.id = d.source_segment_id
      WHERE d.meeting_id = ${meeting.id}
      ORDER BY d.id ASC
    ` as unknown as Promise<Decision[]>,
    sql`
      SELECT a.id, a.task, a.owner_name, a.due_date::text AS due_date, a.status, a.source_segment_id, ms.start_seconds
      FROM action_items a
      LEFT JOIN meeting_segments ms ON ms.id = a.source_segment_id
      WHERE a.meeting_id = ${meeting.id}
      ORDER BY a.id ASC
    ` as unknown as Promise<ActionItem[]>,
    sql`
      SELECT q.id, q.text, q.source_segment_id, ms.start_seconds
      FROM open_questions q
      LEFT JOIN meeting_segments ms ON ms.id = q.source_segment_id
      WHERE q.meeting_id = ${meeting.id}
      ORDER BY q.id ASC
    ` as unknown as Promise<OpenQuestion[]>,
    sql`
      SELECT id, segment_index, speaker_label, start_seconds, end_seconds, text
      FROM meeting_segments
      WHERE meeting_id = ${meeting.id}
      ORDER BY segment_index ASC
    ` as unknown as Promise<MeetingSegmentData[]>,
  ]);

  const transcript = transcripts[0];

  const tabs = [
    {
      id: "summary",
      label: "Summary",
      content: (
        <div className="bg-white p-6 rounded-lg shadow-sm border whitespace-pre-wrap text-gray-700">
          {meeting.summary || "No summary available."}
        </div>
      ),
    },
    {
      id: "decisions",
      label: `Decisions (${decisions.length})`,
      content: (
        <ul className="space-y-3">
          {decisions.length === 0 && <p className="text-gray-500">No decisions recorded.</p>}
          {decisions.map((d) => (
            <li
              key={d.id}
              className="bg-white p-4 rounded-lg shadow-sm border flex justify-between items-start gap-3"
            >
              <span>{d.text}</span>
              <SegmentCitation segmentId={d.source_segment_id} startSeconds={d.start_seconds} />
            </li>
          ))}
        </ul>
      ),
    },
    {
      id: "actions",
      label: `Action Items (${actionItems.length})`,
      content: (
        <div className="space-y-3">
          {actionItems.length === 0 && <p className="text-gray-500">No action items recorded.</p>}
          {actionItems.map((item) => (
            <div
              key={item.id}
              className="bg-white p-4 rounded-lg shadow-sm border flex justify-between items-start gap-4"
            >
              <div>
                <p className="text-gray-800 font-medium">{item.task}</p>
                <p className="text-sm text-gray-500">
                  {item.owner_name ? `Owner: ${item.owner_name}` : "Unassigned"}
                  {item.due_date ? ` · Due ${item.due_date}` : ""}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-xs font-medium px-2 py-1 rounded-full bg-gray-100 text-gray-600 whitespace-nowrap">
                  {item.status}
                </span>
                <SegmentCitation segmentId={item.source_segment_id} startSeconds={item.start_seconds} />
              </div>
            </div>
          ))}
        </div>
      ),
    },
    {
      id: "questions",
      label: `Open Questions (${openQuestions.length})`,
      content: (
        <ul className="space-y-3">
          {openQuestions.length === 0 && (
            <p className="text-gray-500">No open questions recorded.</p>
          )}
          {openQuestions.map((q) => (
            <li
              key={q.id}
              className="bg-white p-4 rounded-lg shadow-sm border flex justify-between items-start gap-3"
            >
              <span>{q.text}</span>
              <SegmentCitation segmentId={q.source_segment_id} startSeconds={q.start_seconds} />
            </li>
          ))}
        </ul>
      ),
    },
    {
      id: "timeline",
      label: "Timeline",
      content: <TimelineView segments={segments} />,
    },
    {
      id: "ask",
      label: "Ask",
      content: (
        <AskPanel
          onAsk={askMeeting.bind(null, meeting.id)}
          placeholder="Ask a question about this meeting..."
          renderSource={(s) => (
            <div className="flex items-start gap-2 text-sm text-gray-600">
              <SegmentCitation segmentId={s.segmentId} startSeconds={s.startSeconds} />
              <span className="line-clamp-2">{s.snippet}</span>
            </div>
          )}
        />
      ),
    },
    {
      id: "transcript",
      label: "Transcript",
      content: (
        <div className="bg-white p-4 rounded-lg shadow-sm border whitespace-pre-wrap text-gray-700 max-h-[32rem] overflow-y-auto">
          {transcript?.raw_text || "No transcript available."}
        </div>
      ),
    },
  ];

  return (
    <BgGradient>
      <JobPoller active={isPending} />
      <main className="mx-auto w-full max-w-screen-xl px-2.5 lg:px-0 mb-12 mt-28">
        <div className="flex items-center justify-between mb-6 flex-wrap gap-4">
          <div>
            <h2 className="text-2xl font-semibold text-gray-800">{meeting.title}</h2>
            {meeting.duration_seconds != null && (
              <p className="text-sm text-gray-500 mt-1">
                Duration: {formatTimestamp(meeting.duration_seconds)}
              </p>
            )}
          </div>
          <StatusPill status={meeting.status} />
        </div>

        {isPending ? (
          <div className="bg-white rounded-xl p-8 text-center shadow-sm border">
            <div className="w-3 h-3 bg-purple-500 rounded-full animate-pulse mx-auto mb-4"></div>
            <p className="text-gray-600">
              {meeting.status === "uploaded"
                ? "Waiting to start processing..."
                : "Processing your meeting — transcribing and extracting insights..."}
            </p>
          </div>
        ) : meeting.status === "failed" ? (
          <div className="bg-white rounded-xl p-8 text-center shadow-sm border border-red-200">
            <p className="text-red-600 mb-4">Processing failed for this meeting.</p>
            <RetryMeetingButton meetingId={meeting.id} />
          </div>
        ) : (
          <MeetingWorkspace
            audioUrl={meeting.audio_url}
            segments={segments}
            tabs={tabs}
            initialSeekSeconds={initialSeekSeconds}
          />
        )}
      </main>
    </BgGradient>
  );
}
