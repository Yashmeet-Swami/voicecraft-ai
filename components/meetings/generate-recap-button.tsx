"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Loader2, FileText } from "lucide-react";
import { generateBlogRecapAction } from "@/actions/blog-recap-actions";

export default function GenerateRecapButton({ meetingId }: { meetingId: number }) {
  const router = useRouter();
  const [isGenerating, setIsGenerating] = useState(false);

  const handleClick = async () => {
    setIsGenerating(true);
    try {
      const result = await generateBlogRecapAction(meetingId);
      if (result.success && result.postId) {
        toast.success("Blog recap generated!");
        router.push(`/posts/${result.postId}`);
      } else {
        toast.error(result.message);
      }
    } catch (error) {
      console.error(error);
      toast.error("Failed to generate recap due to an unexpected error.");
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <Button onClick={handleClick} disabled={isGenerating} variant="outline" size="sm">
      {isGenerating ? (
        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
      ) : (
        <FileText className="w-4 h-4 mr-2" />
      )}
      {isGenerating ? "Generating..." : "Generate Blog Recap"}
    </Button>
  );
}
