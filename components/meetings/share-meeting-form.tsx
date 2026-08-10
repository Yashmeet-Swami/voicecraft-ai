"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Loader2, UserPlus, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { shareMeetingAction, removeCollaboratorAction } from "@/actions/meeting-actions";

export interface CollaboratorView {
  userId: string;
  name: string;
}

export default function ShareMeetingForm({
  meetingId,
  collaborators,
}: {
  meetingId: number;
  collaborators: CollaboratorView[];
}) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [isSharing, setIsSharing] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);

  const handleShare = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || isSharing) return;

    setIsSharing(true);
    try {
      const result = await shareMeetingAction(meetingId, email.trim());
      if (result.success) {
        toast.success(result.message);
        setEmail("");
        router.refresh();
      } else {
        toast.error(result.message);
      }
    } catch (error) {
      console.error(error);
      toast.error("Failed to share meeting due to an unexpected error.");
    } finally {
      setIsSharing(false);
    }
  };

  const handleRemove = async (userId: string) => {
    setRemovingId(userId);
    try {
      const result = await removeCollaboratorAction(meetingId, userId);
      if (result.success) {
        toast.success(result.message);
        router.refresh();
      } else {
        toast.error(result.message);
      }
    } catch (error) {
      console.error(error);
      toast.error("Failed to remove collaborator due to an unexpected error.");
    } finally {
      setRemovingId(null);
    }
  };

  return (
    <div className="bg-white p-4 rounded-lg shadow-sm border space-y-3">
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Share this meeting</p>

      <form onSubmit={handleShare} className="flex gap-2">
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="teammate@example.com"
          className="flex-1 rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400"
        />
        <Button type="submit" size="sm" disabled={isSharing || !email.trim()}>
          {isSharing ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />}
        </Button>
      </form>

      <p className="text-xs text-gray-400">
        They need a VoiceCraft account already (no invite email is sent yet).
      </p>

      {collaborators.length > 0 && (
        <div className="pt-2 border-t space-y-1.5">
          {collaborators.map((c) => (
            <div key={c.userId} className="flex items-center justify-between text-sm">
              <span className="text-gray-700">{c.name}</span>
              <button
                type="button"
                onClick={() => handleRemove(c.userId)}
                disabled={removingId === c.userId}
                className="bg-transparent hover:bg-transparent text-gray-400 hover:text-red-500"
                aria-label={`Remove ${c.name}`}
              >
                {removingId === c.userId ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <X className="w-3.5 h-3.5" />
                )}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
