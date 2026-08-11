import BgGradient from "../../components/common/gradient";
import { auth, currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { doesUserExist, updateUser } from "@/lib/user";
import getDbConnection from "@/lib/db";
import UploadForm from "@/components/upload/upload-form";
import Link from "next/link";
import { ArrowRight } from "lucide-react";

export default async function Dashboard() {
  const { userId } = await auth();
  const clerkUser = await currentUser();

  if (!userId || !clerkUser) {
    return redirect("/sign-in");
  }

  const email = clerkUser.emailAddresses?.[0]?.emailAddress ?? "";
  const fullName = clerkUser.fullName || "";

  // check if user exists in Neon
  const existingUser = await doesUserExist(userId, email);

  if (!existingUser) {
    const sql = await getDbConnection();
    await sql`
      INSERT INTO users (user_id, full_name, email)
      VALUES (${userId}, ${fullName}, ${email})
    `;
  } else {
    await updateUser(userId, fullName, email);
  }

  return (
    <BgGradient>
      <div className="mx-auto max-w-7xl px-6 py-24 sm:py-32 lg:px-8">
        <div className="flex flex-col items-center justify-center gap-6 text-center">
          <h2 className="text-3xl font-bold tracking-tight text-gray-900 sm:text-4xl">
            Turn a recording into a blog post
          </h2>

          <p className="mt-2 text-lg leading-8 text-gray-600 max-w-2xl text-center">
            Upload your audio or video file and let AI turn it into a polished, ready-to-publish
            article.
          </p>

          <Link
            href="/meetings"
            className="text-sm text-purple-600 hover:text-purple-800 font-medium flex items-center gap-1"
          >
            Looking for meeting summaries, decisions, and action items instead?
            <ArrowRight className="w-4 h-4" />
          </Link>

          <div className="mt-6 w-full max-w-xl">
            <UploadForm />
          </div>
        </div>
      </div>
    </BgGradient>
  );
}
