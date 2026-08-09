"use client";

import { useState } from "react";
import { Loader2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface AskSourceView {
  meetingId: number;
  meetingTitle: string;
  segmentId: number | null;
  startSeconds: number | null;
  snippet: string;
}

interface AskOutcome {
  success: boolean;
  message: string;
  answer?: string;
  sources?: AskSourceView[];
}

// Generic ask-a-question UI shared by "Ask this meeting" (meeting detail
// page) and "Ask across meetings" (/meetings/ask). The caller supplies the
// server action to call and how to render each source citation, since the
// two contexts need different citation behavior (jump-in-page vs link to
// another meeting).
export default function AskPanel({
  onAsk,
  renderSource,
  placeholder = "Ask a question...",
}: {
  onAsk: (question: string) => Promise<AskOutcome>;
  renderSource: (source: AskSourceView, index: number) => React.ReactNode;
  placeholder?: string;
}) {
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [answer, setAnswer] = useState<string | null>(null);
  const [sources, setSources] = useState<AskSourceView[]>([]);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = question.trim();
    if (!trimmed || loading) return;

    setLoading(true);
    setError(null);
    setAnswer(null);

    try {
      const result = await onAsk(trimmed);
      if (!result.success) {
        setError(result.message);
      } else {
        setAnswer(result.answer ?? "");
        setSources(result.sources ?? []);
      }
    } catch (err) {
      console.error(err);
      setError("Something went wrong answering that question.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <form onSubmit={handleSubmit} className="flex gap-2">
        <input
          type="text"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder={placeholder}
          className="flex-1 rounded-lg border border-gray-300 px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400"
        />
        <Button type="submit" disabled={loading || !question.trim()}>
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
        </Button>
      </form>

      {error && <p className="text-red-600 text-sm">{error}</p>}

      {answer && (
        <div className="bg-white p-4 rounded-lg shadow-sm border space-y-3">
          <p className="text-gray-800 whitespace-pre-wrap">{answer}</p>
          {sources.length > 0 && (
            <div className="pt-3 border-t space-y-2">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                Sources
              </p>
              {sources.map((s, i) => (
                <div key={`${s.meetingId}-${s.segmentId ?? i}`}>{renderSource(s, i)}</div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
