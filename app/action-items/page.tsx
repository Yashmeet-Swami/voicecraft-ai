import BgGradient from "@/components/common/gradient";
import getDbConnection from "@/lib/db";
import { currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import ActionItemStatusToggle from "@/components/meetings/action-item-status-toggle";

interface MyActionItem {
  id: number;
  task: string;
  due_date: string | null;
  status: string;
  meeting_id: number;
  meeting_title: string;
}

export default async function ActionItemsPage() {
  const user = await currentUser();
  if (!user) return redirect("/sign-in");

  const sql = await getDbConnection();

  const items = (await sql`
    SELECT a.id, a.task, a.due_date::text AS due_date, a.status, a.meeting_id, m.title AS meeting_title
    FROM action_items a
    JOIN meetings m ON m.id = a.meeting_id
    WHERE a.owner_user_id = ${user.id}
    ORDER BY
      CASE a.status WHEN 'open' THEN 0 WHEN 'in_progress' THEN 1 ELSE 2 END,
      a.due_date ASC NULLS LAST,
      a.id DESC
  `) as unknown as MyActionItem[];

  return (
    <BgGradient>
      <main className="mx-auto w-full max-w-screen-xl px-2.5 lg:px-0 mb-12 mt-28">
        <h2 className="text-3xl font-bold text-gray-900 mb-2">My Action Items ✅</h2>
        <p className="text-gray-600 text-lg mb-8">
          Everything assigned to you across every meeting you have access to.
        </p>

        {items.length === 0 ? (
          <p className="text-gray-600 text-lg">
            Nothing assigned to you yet. Action items get linked to you automatically when a
            meeting&rsquo;s extraction matches your name against the meeting&rsquo;s owner/collaborators.
          </p>
        ) : (
          <div className="space-y-3">
            {items.map((item) => (
              <div
                key={item.id}
                className="bg-white p-4 rounded-lg shadow-sm border flex justify-between items-start gap-4"
              >
                <div>
                  <p className="text-gray-800 font-medium">{item.task}</p>
                  <p className="text-sm text-gray-500">
                    <Link
                      href={`/meetings/${item.meeting_id}`}
                      className="text-purple-600 hover:text-purple-800"
                    >
                      {item.meeting_title}
                    </Link>
                    {item.due_date ? ` · Due ${item.due_date}` : ""}
                  </p>
                </div>
                <ActionItemStatusToggle actionItemId={item.id} status={item.status} />
              </div>
            ))}
          </div>
        )}
      </main>
    </BgGradient>
  );
}
