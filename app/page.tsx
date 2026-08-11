import Banner from "@/components/Home/banner";
import BgGradient from "@/components/common/gradient";
import HowItWorks from "@/components/Home/howitworks";
import Features from "@/components/Home/features";

export default function Home() {
  return (
    <main className="mx-auto w-full">
      <BgGradient>
        <Banner />
      </BgGradient>

      <HowItWorks />
      <div className="border-t border-gray-100" />
      <Features />

      <footer className="border-t border-gray-100 bg-gray-50/50 py-10 px-6 sm:px-12">
        <div className="max-w-5xl mx-auto flex flex-col sm:flex-row justify-between items-center gap-2 text-sm text-gray-500">
          <p>© {new Date().getFullYear()} VoiceCraft. All rights reserved.</p>
          <p>Built by Yashmeet 🚀</p>
        </div>
      </footer>
    </main>
  );
}
