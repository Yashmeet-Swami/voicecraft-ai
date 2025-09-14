"use client";

import { z } from "zod";
import { Button } from "../ui/button";
import { toast } from "sonner";
import { useUploadThing } from "../utils/uploadthing";
import { transcribeUploadedFile, generateBlogPostAction } from "@/actions/upload-actions";
import { useState, useRef } from "react";
import { Upload, FileAudio, Video, X, Loader2 } from "lucide-react";

const schema = z.object({
  file: z
    .instanceof(File, { message: "Invalid file" })
    .refine((file) => file.size <= 20 * 1024 * 1024, "File size must not exceed 20MB")
    .refine(
      (file) => file.type.startsWith("audio/") || file.type.startsWith("video/"),
      "File must be an audio or a video file"
    ),
});

export default function UploadForm() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { startUpload } = useUploadThing("videoOrAudioUploader", {
    onClientUploadComplete: () => {
      toast.success("✅ Uploaded successfully!");
    },
    onUploadError: (err) => {
      console.error("Error occurred", err);
      toast.error("❌ Upload failed. Please try again.");
      setIsUploading(false);
    },
    onUploadBegin: () => {
      toast("🚀 Upload has begun!");
      setIsUploading(true);
    },
  });

  const handleFileSelect = (file: File) => {
    const validated = schema.safeParse({ file });
    if (!validated.success) {
      toast.error(
        validated.error.flatten().fieldErrors.file?.[0] ?? "Please upload a valid file."
      );
      return;
    }
    setSelectedFile(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) {
      handleFileSelect(files[0]);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      handleFileSelect(files[0]);
    }
  };

  const removeFile = () => {
    setSelectedFile(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleTranscribe = async () => {
    if (!selectedFile) {
      toast.error("❌ No file selected!");
      return;
    }

    try {
      const uploadResp = await startUpload([selectedFile]);
      if (!uploadResp || uploadResp.length === 0) {
        toast.error("❌ Upload failed.");
        setIsUploading(false);
        return;
      }

      toast("🎙️ Transcription in progress...");

      // Transform the upload response to match transcribeUploadedFile expectations
      const transcribeInput = uploadResp.map(upload => ({
        userId: upload.serverData?.userId || "default-user-id",
        fileUrl: upload.url,
        fileName: upload.name || selectedFile.name
      }));

      const result = await transcribeUploadedFile(transcribeInput);
      const { data } = result || {};

      if (!data) {
        toast.error("❌ Transcription failed. Please try again.");
        setIsUploading(false);
        return;
      }

      toast("🤖 Generating AI blog post...");

      await generateBlogPostAction({
        transcriptions: data.transcription ? { text: data.transcription } : { text: "" },
        userId: data.userId,
      });

      toast.success("🎉 Woohoo! Your AI blog is created! 🎊");
      setSelectedFile(null);
      setIsUploading(false);
      
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    } catch (err) {
      console.error(err);
      toast.error("❌ Something went wrong during upload or blog generation.");
      setIsUploading(false);
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const getFileIcon = (fileType: string) => {
    if (fileType.startsWith('audio/')) {
      return <FileAudio className="w-8 h-8 text-purple-500" />;
    } else if (fileType.startsWith('video/')) {
      return <Video className="w-8 h-8 text-purple-500" />;
    }
    return <Upload className="w-8 h-8 text-purple-500" />;
  };

  return (
    <div className="w-full max-w-2xl mx-auto space-y-6">
      {/* Upload Area */}
      <div
        className={`
          relative border-2 border-dashed rounded-2xl p-8 text-center transition-all duration-300 cursor-pointer
          ${isDragOver 
            ? 'border-purple-400 bg-purple-50 scale-[1.02]' 
            : 'border-gray-300 hover:border-purple-400 hover:bg-gray-50'
          }
          ${selectedFile ? 'bg-gradient-to-br from-purple-50 to-pink-50 border-purple-300' : ''}
        `}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onClick={() => fileInputRef.current?.click()}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept="audio/*,video/*"
          onChange={handleFileInputChange}
          className="hidden"
        />

        {!selectedFile ? (
          <div className="space-y-4">
            <div className="mx-auto w-16 h-16 bg-gradient-to-br from-purple-500 to-pink-500 rounded-2xl flex items-center justify-center transform rotate-3 hover:rotate-6 transition-transform duration-300">
              <Upload className="w-8 h-8 text-white" />
            </div>
            
            <div className="space-y-2">
              <h3 className="text-xl font-semibold text-gray-700">
                Drop your files here
              </h3>
              <p className="text-gray-500">
                or <span className="text-purple-600 font-medium">browse</span> to choose files
              </p>
            </div>
            
            <div className="flex items-center justify-center space-x-4 text-sm text-gray-400">
              <div className="flex items-center space-x-1">
                <FileAudio className="w-4 h-4" />
                <span>Audio</span>
              </div>
              <div className="w-1 h-1 bg-gray-300 rounded-full"></div>
              <div className="flex items-center space-x-1">
                <Video className="w-4 h-4" />
                <span>Video</span>
              </div>
              <div className="w-1 h-1 bg-gray-300 rounded-full"></div>
              <span>Max 20MB</span>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-center space-x-3">
              {getFileIcon(selectedFile.type)}
              <div className="text-left">
                <p className="font-medium text-gray-700 truncate max-w-xs">
                  {selectedFile.name}
                </p>
                <p className="text-sm text-gray-500">
                  {formatFileSize(selectedFile.size)}
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={(e) => {
                  e.stopPropagation();
                  removeFile();
                }}
                className="ml-auto hover:bg-red-50 hover:border-red-200"
              >
                <X className="w-4 h-4" />
              </Button>
            </div>
            
            <div className="text-sm text-green-600 font-medium">
              ✓ File ready for transcription
            </div>
          </div>
        )}
      </div>

      {/* Action Button */}
      <div className="flex justify-center">
        <Button
          onClick={handleTranscribe}
          disabled={!selectedFile || isUploading}
          className="px-8 py-3 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 text-white font-semibold rounded-xl shadow-lg hover:shadow-xl transition-all duration-300 transform hover:scale-[1.02] disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none"
        >
          {isUploading ? (
            <>
              <Loader2 className="w-5 h-5 mr-2 animate-spin" />
              Processing...
            </>
          ) : (
            <>
              <Upload className="w-5 h-5 mr-2" />
              Start Transcription
            </>
          )}
        </Button>
      </div>

      {/* Progress Indicator */}
      {isUploading && (
        <div className="bg-white rounded-xl p-4 border shadow-sm">
          <div className="flex items-center space-x-3">
            <div className="w-3 h-3 bg-purple-500 rounded-full animate-pulse"></div>
            <span className="text-sm text-gray-600">Processing your file...</span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-2 mt-3">
            <div className="bg-gradient-to-r from-purple-500 to-pink-500 h-2 rounded-full animate-pulse" style={{width: '60%'}}></div>
          </div>
        </div>
      )}
    </div>
  );
}