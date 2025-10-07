"use client";
import dynamic from "next/dynamic";
import { useRef, useState, useCallback, useActionState } from "react";
import { MDXEditorMethods, headingsPlugin, listsPlugin, quotePlugin, thematicBreakPlugin } from "@mdxeditor/editor";
import { Button } from "../ui/button";
import { Download, Edit2 } from "lucide-react";
import { updatePostAction } from "@/actions/edit-actions";

type PostType = { id: string; title: string; content: string };

const initialState = { success: false };
const MDXEditor = dynamic(
  () => import("@mdxeditor/editor").then((mod) => mod.MDXEditor),
  { ssr: false }
);
export default function ContentEditor({ posts = [] }: { posts: PostType[] }) {
  const hasPost = posts.length > 0;
  const post = hasPost ? posts[0] : { id: "", title: "", content: "" };

  const editorRef = useRef<MDXEditorMethods>(null);
  const [content, setContent] = useState(post.content);
  const [isChanged, setIsChanged] = useState(false);

  // Form action
  const noopAction = async (state: { success: boolean }) => state;
  const updatedPostAction: (state: { success: boolean }) => Promise<{ success: boolean }> | { success: boolean } = hasPost
    ? (async () => await updatePostAction({ postId: post.id, content }))
    : noopAction;

  const [, formAction] = useActionState(updatedPostAction, initialState);

  // Update content on editor change
  const handleContentChange = (value: string) => {
    setContent(value);
    setIsChanged(true);
  };

  // Export markdown
  const handleExport = useCallback(() => {
    if (!hasPost) return;
    const filename = `${post.title || "blog-post"}.md`;
    const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);

    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    URL.revokeObjectURL(url);
  }, [content, post.title, hasPost]);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div className="flex justify-between items-center border-b-2 border-gray-200/50 pb-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-800 mb-2 flex items-center gap-2">📝 Edit your post</h2>
          <p className="text-gray-600">Start editing your blog post below...</p>
        </div>

        <div className="flex gap-4">
          <Button
            type="submit"
            className="w-40 bg-gradient-to-r from-purple-900 to-indigo-600 hover:from-purple-600 hover:to-indigo-900 text-white font-semibold py-2 px-4 rounded-full shadow-lg transform transition duration-200 ease-in-out hover:scale-105 focus:outline-none focus:ring-2"
            disabled={!isChanged || !hasPost}
          >
            <Edit2 className="w-5 h-5 mr-2" />
            Update Text
          </Button>

          <Button
            type="button"
            onClick={handleExport}
            disabled={!hasPost}
            className="w-40 bg-gradient-to-r from-amber-500 to-amber-900 hover:from-amber-600 hover:to-amber-700 text-white font-semibold py-2 px-4 rounded-full shadow-lg transform transition duration-200 ease-in-out hover:scale-105 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-opacity-50"
          >
            <Download className="w-5 h-5 mr-2" />
            Export
          </Button>
        </div>
      </div>

      {!hasPost ? (
        <div className="text-red-500 mt-4">⚠️ No posts available</div>
      ) : (
        <MDXEditor
          ref={editorRef}
          markdown={post.content}
          onChange={handleContentChange}
          contentEditableClassName="prose min-h-[400px] border border-gray-700 rounded-xl p-4 focus:outline-none focus:ring-2 focus:ring-blue-500"
          plugins={[headingsPlugin(), listsPlugin(), quotePlugin(), thematicBreakPlugin()]}
        />
      )}
    </form>
  );
}
