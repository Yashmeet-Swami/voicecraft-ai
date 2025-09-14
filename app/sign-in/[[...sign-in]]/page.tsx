import BgGradient from "@/components/common/bg-gradient";
import { SignIn } from "@clerk/nextjs";

export default function Page() {
  return (
    <div className="grid min-h-screen grid-cols-1 lg:grid-cols-2">
      {/* Left Side: Now with the gradient */}
      <div className="hidden bg-gray-900 lg:block">
        <BgGradient className="flex h-full flex-col items-center justify-center p-12 text-white">
          <h1 className="mb-4 text-center text-4xl font-bold">
            Welcome to VoiceCraftAI
          </h1>
          <p className="text-center text-lg text-gray-300">
          Turn your videos and audios into words for blogs, notes, and more.
          </p>
        </BgGradient>
      </div>

      {/* Right Side: Sign-In Form */}
      <div className="flex items-center justify-center bg-white p-8">
        <SignIn />
      </div>
    </div>
  );
}