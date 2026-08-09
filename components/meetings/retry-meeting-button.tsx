"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { RefreshCw, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { retryMeetingAction } from "@/actions/meeting-actions";
import { useRouter } from "next/navigation";

export default function RetryMeetingButton({ meetingId }: { meetingId: number }) {
  const [isRetrying, setIsRetrying] = useState(false);
  const router = useRouter();

  const handleRetry = async () => {
    setIsRetrying(true);
    try {
      const result = await retryMeetingAction(meetingId);
      if (result.success) {
        toast.success(result.message);
        router.refresh();
      } else {
        toast.error(result.message);
      }
    } catch (error) {
      console.error(error);
      toast.error("Failed to retry processing due to an unexpected error.");
    } finally {
      setIsRetrying(false);
    }
  };

  return (
    <Button onClick={handleRetry} disabled={isRetrying} variant="outline" size="sm">
      {isRetrying ? (
        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
      ) : (
        <RefreshCw className="w-4 h-4 mr-2" />
      )}
      {isRetrying ? "Retrying..." : "Retry Processing"}
    </Button>
  );
}
