import { BrainIcon, MoveRight } from "lucide-react";

export default function HowItWorks() {
  return (
    <section className="py-24 relative overflow-hidden">
      {/* Gradient Background - Bottom left corner only */}
      <div className="absolute bottom-0 left-0 w-[600px] h-[600px] bg-gradient-to-tr from-purple-200/30 via-pink-200/20 to-transparent rounded-full blur-3xl"></div>
      <div className="absolute bottom-0 left-0 w-[400px] h-[400px] bg-gradient-to-tr from-pink-300/25 to-transparent rounded-full blur-2xl"></div>

      {/* Content with relative z-index */}
      <div className="relative z-10">
        <div className="flex items-center justify-center w-full pb-6">
          <h2 className="font-bold text-xl uppercase mb-8 text-purple-600">
            How it works
          </h2>
        </div>
        <h3 className="flex items-center justify-center mb-24 text-center font-bold">
          Easily repurpose your content into SEO focused blog posts.
        </h3>

        <div className="flex items-center justify-center gap-4 lg:gap-24">
          <div className="flex flex-col gap-4">
            <p className="text-7xl text-center">🎥</p>
            <p className="text-center font-medium">Upload a Video</p>
          </div>
          <MoveRight size={64} strokeWidth={0.5} className="text-purple-500" />
          <div className="flex flex-col gap-4">
            <p className="flex items-center justify-center">
              <BrainIcon size={64} strokeWidth={0.5} />
            </p>
            <p className="text-center font-medium">AI Magic ✨</p>
          </div>
          <MoveRight size={64} strokeWidth={0.5} className="text-purple-500" />
          <div className="flex flex-col gap-4">
            <p className="text-7xl text-center">📜</p>
            <p className="text-center font-medium">Blog</p>
          </div>
        </div>
      </div>
    </section>
  );
}