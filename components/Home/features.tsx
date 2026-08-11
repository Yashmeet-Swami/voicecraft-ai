import { Users, ShieldCheck, FileText } from "lucide-react";

const features = [
  {
    icon: ShieldCheck,
    title: "Grounded, not guessed",
    description:
      "Every decision and action item links back to a real transcript segment and timestamp — so you can always verify what the AI extracted.",
  },
  {
    icon: Users,
    title: "Built for teams",
    description:
      "Share a meeting with a teammate, assign action items automatically by name, and track status together.",
  },
  {
    icon: FileText,
    title: "Still your content",
    description:
      "Turn any meeting's summary into a polished blog recap in one click — the same engine that started this whole project.",
  },
];

export default function Features() {
  return (
    <section className="py-20 sm:py-24 relative overflow-hidden">
      <div className="relative z-10 max-w-5xl mx-auto px-4 grid grid-cols-1 sm:grid-cols-3 gap-8">
        {features.map((feature) => {
          const Icon = feature.icon;
          return (
            <div key={feature.title} className="flex flex-col items-center text-center gap-3">
              <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center shadow-md shadow-purple-500/20">
                <Icon className="w-6 h-6 text-white" />
              </div>
              <h4 className="font-semibold text-gray-900">{feature.title}</h4>
              <p className="text-sm text-gray-500 leading-relaxed max-w-xs">{feature.description}</p>
            </div>
          );
        })}
      </div>
    </section>
  );
}
