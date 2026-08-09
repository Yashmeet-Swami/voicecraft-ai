import BgGradient from "@/components/common/gradient";
import { currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import AskPanel from "@/components/meetings/ask-panel";
import { askAcrossMeetings } from "@/actions/knowledge-actions";
import { formatTimestamp } from "@/lib/utils";

export default async function AskAcrossMeetingsPage() {
  const user = await currentUser();
  if (!user) return redirect("/sign-in");

  return (
    <BgGradient>
      <main className="mx-auto w-full max-w-screen-xl px-2.5 lg:px-0 mb-12 mt-28">
        <div className="text-center mb-10">
          <h2 className="text-3xl font-bold text-gray-900 mb-2">Ask across your meetings 🔍</h2>
          <p className="text-gray-600 text-lg max-w-2xl mx-auto">
            Ask a question and get an answer grounded in everything discussed across your past
            meetings, with links back to the exact meeting and moment.
          </p>
        </div>

        <div className="max-w-2xl mx-auto">
          <AskPanel
            onAsk={askAcrossMeetings}
            placeholder="e.g. What did we decide about payment retries?"
            renderSource={(s) => (
              <div className="flex items-start gap-2 text-sm text-gray-600">
                <Link
                  href={`/meetings/${s.meetingId}${
                    s.startSeconds != null ? `?t=${Math.floor(s.startSeconds)}` : ""
                  }`}
                  className="text-purple-600 hover:text-purple-800 font-medium whitespace-nowrap"
                >
                  {s.meetingTitle}
                  {s.startSeconds != null ? ` @ ${formatTimestamp(s.startSeconds)}` : ""}
                </Link>
                <span className="line-clamp-2">{s.snippet}</span>
              </div>
            )}
          />
        </div>
      </main>
    </BgGradient>
  );
}
