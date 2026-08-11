import BgGradient from "@/components/common/gradient";
import getDbConnection from "@/lib/db";
import { currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

interface EventTypeSummary {
  event_type: string;
  count_24h: number;
  count_7d: number;
  total_tokens_7d: number | null;
}

export default async function UsagePage() {
  const user = await currentUser();
  if (!user) return redirect("/sign-in");

  const sql = await getDbConnection();

  const summary = (await sql`
    SELECT
      event_type,
      COUNT(*) FILTER (WHERE created_at > now() - interval '24 hours')::int AS count_24h,
      COUNT(*) FILTER (WHERE created_at > now() - interval '7 days')::int AS count_7d,
      SUM(total_tokens) FILTER (WHERE created_at > now() - interval '7 days')::int AS total_tokens_7d
    FROM usage_events
    WHERE user_id = ${user.id}
    GROUP BY event_type
    ORDER BY count_7d DESC
  `) as unknown as EventTypeSummary[];

  const recent = await sql`
    SELECT event_type, model, total_tokens, created_at
    FROM usage_events
    WHERE user_id = ${user.id}
    ORDER BY created_at DESC
    LIMIT 20
  `;

  return (
    <BgGradient>
      <main className="mx-auto w-full max-w-screen-xl px-2.5 lg:px-0 mb-12 mt-28">
        <h2 className="text-3xl font-bold text-gray-900 mb-2">Your Usage 📊</h2>
        <p className="text-gray-600 text-lg mb-8">
          A quick look at how much you&rsquo;re using each AI-backed feature — mainly here as a
          sanity check against the Gemini free-tier rate limits, not a billing dashboard (nothing
          here costs money on the free tier).
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-10">
          {summary.length === 0 ? (
            <p className="text-gray-500">No usage recorded yet.</p>
          ) : (
            summary.map((row) => (
              <div key={row.event_type} className="bg-white p-4 rounded-lg shadow-sm border">
                <p className="text-sm font-semibold text-gray-700">{row.event_type}</p>
                <p className="text-2xl font-bold text-purple-600 mt-1">{row.count_24h}</p>
                <p className="text-xs text-gray-500">calls in the last 24h</p>
                <p className="text-xs text-gray-400 mt-2">
                  {row.count_7d} calls / {row.total_tokens_7d ?? 0} tokens in the last 7 days
                </p>
              </div>
            ))
          )}
        </div>

        <h3 className="text-xl font-semibold text-gray-800 mb-4">Recent activity</h3>
        {recent.length === 0 ? (
          <p className="text-gray-500">Nothing yet.</p>
        ) : (
          <div className="bg-white rounded-lg shadow-sm border divide-y">
            {recent.map((event, i) => (
              <div key={i} className="px-4 py-2.5 flex justify-between items-center text-sm">
                <div>
                  <span className="font-medium text-gray-700">{event.event_type}</span>
                  {event.model && <span className="text-gray-400"> · {event.model}</span>}
                </div>
                <div className="text-gray-400">
                  {event.total_tokens != null && `${event.total_tokens} tokens · `}
                  {new Date(event.created_at).toLocaleString()}
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </BgGradient>
  );
}
