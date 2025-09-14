import Banner from "@/components/Home/banner";
import BgGradient from "@/components/common/bg-gradient";
import { Dot } from "lucide-react";
import HowItWorks from "@/components/Home/howitworks";
import Pricing from "@/components/Home/pricing";
export default function Home() {
  return (
    <main className="mx-auto w-full inset-0 h-full bg-[radial-gradient(#e5e7eb_1px), transparent_1px)]
    [background-size:16px_16px]">
      <BgGradient />
      <Banner />
      <div className="flex items-center justify-center">
        <Dot className="text-purple-400"></Dot>
        <Dot className="text-purple-400"></Dot>
        <Dot className="text-purple-400"></Dot>
      </div>

      <HowItWorks />
      <div className="flex items-center justify-center">
        <Dot className="text-purple-400"></Dot>
        <Dot className="text-purple-400"></Dot>
        <Dot className="text-purple-400"></Dot>
      </div>
      
      <Pricing />
      <div className="flex items-center justify-center">
        <Dot className="text-purple-400"></Dot>
        <Dot className="text-purple-400"></Dot>
        <Dot className="text-purple-400"></Dot>
      </div>
      
      <footer className="bg-gray-100/20 flex h-20 py-24 px-12 z-20 relative overflow-hidden flex-col gap-2 items-end">
        <p>All Rights Reserved, {new Date().getFullYear()}</p>
        <a href="/" target="_blank">
          Built by Yashmeet 🚀
        </a>
      </footer>
    </main>
  );
}
