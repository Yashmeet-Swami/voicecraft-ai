import BgGradient from "../../components/common/gradient";
import { auth, currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { doesUserExist, updateUser } from "@/lib/user";
import getDbConnection from "@/lib/db";
import UploadForm from "@/components/upload/upload-form";

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
          <h2 className="capitalize text-3xl font-bold tracking-tight text-gray-900 sm:text-4xl">
            Start creating amazing content
          </h2>

          <p className="mt-2 text-lg leading-8 text-gray-600 max-w-2xl text-center">
            Upload your audio or video file and let our AI do the magic!
          </p>

          {/* Info Card
<div className="mt-8 w-full max-w-2xl rounded-2xl bg-white/60 shadow-lg ring-1 ring-gray-200 backdrop-blur-sm p-6 text-left">
  <div className="flex items-center gap-3">
    <span className="text-2xl">📖</span>
    <h3 className="text-xl font-semibold text-gray-900">How it works</h3>
  </div>

  <ul className="mt-4 space-y-3 text-gray-700">
    <li className="flex items-start gap-3">
      <span className="text-lg">🎵</span>
      <p>
        Upload your <span className="font-medium">audio</span> or <span className="font-medium">video</span> file
      </p>
    </li>
    <li className="flex items-start gap-3">
      <span className="text-lg">📝</span>
      <p>We’ll transcribe it into clean, accurate text</p>
    </li>
    <li className="flex items-start gap-3">
      <span className="text-lg">✨</span>
      <p>AI will generate a polished blog post for you</p>
    </li>
  </ul>
</div> */}

          {/* Upload Form */}
          <div className="mt-6 w-full max-w-xl">
            <UploadForm />
          </div>
        </div>
      </div>
    </BgGradient>
  );
}
