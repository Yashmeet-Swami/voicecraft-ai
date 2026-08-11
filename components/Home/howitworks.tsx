import { Upload, Wand2, ListChecks, MessageCircleQuestion } from "lucide-react";

const steps = [
  {
    icon: Upload,
    title: "Upload a recording",
    description: "Drop in an audio or video file of any meeting, call, or standup.",
  },
  {
    icon: Wand2,
    title: "AI transcribes & extracts",
    description: "Speaker-aware transcription, then a summary, decisions, and action items.",
  },
  {
    icon: ListChecks,
    title: "Every fact is grounded",
    description: "Click any decision or action item to jump to the exact moment it was said.",
  },
  {
    icon: MessageCircleQuestion,
    title: "Ask across meetings",
    description: "“What did we decide about pricing last month?” — answered, with sources.",
  },
];

export default function HowItWorks() {
  return (
    <section className="py-20 sm:py-28 relative overflow-hidden">
      <div className="relative z-10 max-w-5xl mx-auto px-4">
        <div className="text-center mb-16">
          <h2 className="font-semibold text-sm uppercase tracking-wide text-purple-600 mb-3">
            How it works
          </h2>
          <h3 className="text-2xl sm:text-3xl font-bold text-gray-900">
            From recording to searchable knowledge, automatically
          </h3>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {steps.map((step, i) => {
            const Icon = step.icon;
            return (
              <div
                key={step.title}
                className="relative bg-white rounded-2xl border border-gray-100 shadow-sm p-6 flex flex-col gap-3"
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-purple-100 flex items-center justify-center">
                    <Icon className="w-5 h-5 text-purple-600" />
                  </div>
                  <span className="text-xs font-semibold text-gray-400">Step {i + 1}</span>
                </div>
                <h4 className="font-semibold text-gray-900">{step.title}</h4>
                <p className="text-sm text-gray-500 leading-relaxed">{step.description}</p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
