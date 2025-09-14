import { ArrowRight, CheckIcon } from "lucide-react";
import { Button } from "../ui/button";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { plansMap } from "@/lib/constants";

export default function Pricing() {
  return (
    <section className="relative overflow-hidden" id="pricing">
      {/* Gradient Background - Bottom corner only */}
      <div className="absolute bottom-0 right-0 w-[600px] h-[600px] bg-gradient-to-tl from-purple-200/30 via-pink-200/20 to-transparent rounded-full blur-3xl"></div>
      <div className="absolute bottom-0 right-0 w-[400px] h-[400px] bg-gradient-to-tl from-pink-300/25 to-transparent rounded-full blur-2xl"></div>

      {/* Content */}
      <div className="relative z-10 py-12 lg:py-24 max-w-5xl mx-auto px-12 lg:px-0">
        <div className="flex items-center justify-center w-full pb-12">
          <h2 className="font-bold text-xl uppercase mb-8 text-purple-600">
            Pricing
          </h2>
        </div>
        <div className="relative flex justify-center flex-col lg:flex-row items-center lg:items-stretch gap-8">
          {plansMap.map(
            ({ name, price, description, items, id }, idx) => (
              <div className="relative w-full max-w-lg" key={idx}>
                <div
                  className={cn(
                    "relative flex flex-col h-full gap-4 lg:gap-8 z-10 p-8 rounded-box border-[1px] border-gray-500/20 rounded-2xl bg-white/80 backdrop-blur-sm",
                    id === "pro" && "border-violet-500 gap-5 border-2 bg-white/90"
                  )}
                >
                  <div className="flex justify-between items-center gap-4">
                    <div>
                      <p className="text-lg lg:text-xl font-bold capitalize">
                        {name}
                      </p>
                      <p className="text-base-content/80 mt-2">{description}</p>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <p className="text-5xl tracking-tight font-extrabold">
                      ${price}
                    </p>
                    <div className="flex flex-col justify-end mb-[4px]">
                      <p className="text-xs text-base-content/60 uppercase font-semibold">
                        USD
                      </p>
                      <p className="text-xs text-base-content/60">/month</p>
                    </div>
                  </div>
                  <ul className="space-y-2.5 leading-relaxed text-base flex-1">
                    {items.map((item, idx) => (
                      <li className="flex items-center gap-2" key={idx}>
                        <CheckIcon size={18}></CheckIcon>
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                  <div className="space-y-2">
                    <Button
                      variant={"link"}
                      className={cn(
                        "border-2 rounded-full flex gap-2 bg-black text-gray-100",
                        id === "pro" && "border-amber-300 px-4"
                      )}
                    >
                      <Link
                        href="/"
                        className="flex gap-1 items-center"
                      >
                        Get SpeakEasy <ArrowRight size={18} />
                      </Link>
                    </Button>
                  </div>
                </div>
              </div>
            )
          )}
        </div>
      </div>
    </section>
  );
}