import Link from "next/link";
import { Button } from "../ui/button";
import { ArrowRight, Sparkles } from "lucide-react";
import { SignedIn, SignedOut } from "@clerk/nextjs";

export default function Banner() {
  return (
    <section className="lg:max-w-5xl mx-auto flex flex-col z-0 items-center justify-center px-4 py-24 sm:py-32 text-center transition-all animate-in">
      <div className="inline-flex items-center gap-2 rounded-full border border-purple-200 bg-purple-50 px-4 py-1.5 text-sm font-medium text-purple-700 mb-8">
        <Sparkles className="w-4 h-4" />
        Now with AI-powered meeting intelligence
      </div>

      <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight text-gray-900">
        Turn every meeting into{" "}
        <span className="text-purple-600">structured, searchable knowledge</span>
      </h1>

      <p className="mt-6 text-lg sm:text-xl text-gray-600 leading-relaxed max-w-2xl">
        Upload a recording and get a summary, decisions, and action items — each one traceable
        back to the exact moment it was said. Then ask questions across every meeting you&rsquo;ve
        ever had.
      </p>

      <div className="mt-10 flex flex-col sm:flex-row items-center gap-4">
        <SignedIn>
          <Button
            asChild
            className="text-base rounded-full px-8 py-6 bg-purple-600 hover:bg-purple-700 text-white font-semibold shadow-lg shadow-purple-600/20"
          >
            <Link href="/meetings" className="flex gap-2 items-center">
              Go to your meetings
              <ArrowRight className="w-4 h-4" />
            </Link>
          </Button>
        </SignedIn>
        <SignedOut>
          <Button
            asChild
            className="text-base rounded-full px-8 py-6 bg-purple-600 hover:bg-purple-700 text-white font-semibold shadow-lg shadow-purple-600/20"
          >
            <Link href="/sign-up" className="flex gap-2 items-center">
              Get started free
              <ArrowRight className="w-4 h-4" />
            </Link>
          </Button>
        </SignedOut>
      </div>
    </section>
  );
}
