import { lazy, Suspense, useMemo } from "react";
import { cn } from "@/lib/utils";

// Dynamic-import ReactQuill so react-quill-new (~208 KB) only enters the
// chunk graph for routes that actually mount a RichTextEditor.
const ReactQuill = lazy(() =>
  Promise.all([
    import("react-quill-new"),
    import("react-quill-new/dist/quill.snow.css"),
  ]).then(([m]) => ({ default: m.default })),
);

interface RichTextEditorProps {
  content: string;
  onChange: (html: string) => void;
  placeholder?: string;
  className?: string;
}

const modules = {
  toolbar: [
    [{ header: [2, 3, false] }],
    ["bold", "italic", "underline"],
    [{ list: "ordered" }, { list: "bullet" }],
    ["blockquote", "link"],
    ["clean"],
  ],
};

const formats = [
  "header",
  "bold",
  "italic",
  "underline",
  "list",
  "blockquote",
  "link",
];

export function RichTextEditor({ content, onChange, placeholder, className }: RichTextEditorProps) {
  const quillModules = useMemo(() => modules, []);

  return (
    <div className={cn("rich-text-editor", className)}>
      <Suspense
        fallback={
          <div
            className="min-h-[180px] rounded-md border border-input bg-muted/30 animate-pulse"
            aria-label="Loading editor"
            role="status"
          />
        }
      >
        <ReactQuill
          theme="snow"
          value={content}
          onChange={onChange}
          modules={quillModules}
          formats={formats}
          placeholder={placeholder}
        />
      </Suspense>
    </div>
  );
}
