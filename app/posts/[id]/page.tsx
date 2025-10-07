import ContentEditor from "@/components/content/content-editor";
import getDbConnection from "@/lib/db";
import { currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

interface Post {
  id: string;
  user_id: string;
  title: string;
  content: string;
  created_at: Date;
}

export default async function PostsPage({ params }: { params: { id: string } }) {
  const { id } = await params;

  const user = await currentUser();
  if (!user) return redirect("/sign-in");

  const sql = await getDbConnection();
  const posts = (await sql`
    SELECT * FROM posts WHERE user_id = ${user.id} AND id = ${id}
  `) as unknown as Post[];

  if (!posts || posts.length === 0) {
    return <div className="mx-auto w-full max-w-screen-xl px-2.5 lg:px-0 mb-12 mt-28"><p>No post found.</p></div>;
  }

  return (
    <div className="mx-auto w-full max-w-screen-xl px-2.5 lg:px-0 mb-12 mt-28">
      <ContentEditor posts={[posts[0]]} />
    </div>
  );
}
