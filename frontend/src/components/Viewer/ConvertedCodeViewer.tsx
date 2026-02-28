// ConvertedCodeViewer — Read-only Monaco viewer for Algorand Python/TEAL output
"use client";

import dynamic from "next/dynamic";

const Editor = dynamic(() => import("@monaco-editor/react"), { ssr: false });

interface ConvertedCodeViewerProps {
  code: string;
  language: string;
  isLoading?: boolean;
}

export default function ConvertedCodeViewer({
  code,
  language,
  isLoading = false,
}: ConvertedCodeViewerProps) {
  // Map our language ids to Monaco language ids
  const monacoLang = language === "sol" ? "sol" : language === "python" ? "python" : "plaintext";

  if (isLoading) {
    return (
      <div
        className="w-full h-full flex items-center justify-center"
        style={{ backgroundColor: "var(--bg-editor)" }}
      >
        <div className="flex flex-col items-center gap-3">
          <div className="animate-spin w-8 h-8 border-2 border-transparent rounded-full" style={{ borderTopColor: "var(--accent)" }} />
          <span className="text-sm" style={{ color: "var(--text-muted)" }}>
            {language === "python" ? "Converting..." : "Compiling..."}
          </span>
        </div>
      </div>
    );
  }

  if (!code) {
    return (
      <div
        className="w-full h-full flex items-center justify-center"
        style={{ backgroundColor: "var(--bg-editor)" }}
      >
        <div className="text-center space-y-2 max-w-xs">
          <div className="text-lg" style={{ color: "var(--text-muted)" }}>
            {language === "python" ? "🔄" : "📄"}
          </div>
          <div className="text-sm" style={{ color: "var(--text-muted)" }}>
            {language === "python"
              ? "Convert your Solidity code to see Algorand Python here."
              : "Compile your Algorand Python to see TEAL here."}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full h-full" style={{ backgroundColor: "var(--bg-editor)" }}>
      <Editor
        height="100%"
        language={monacoLang}
        theme="vs-dark"
        value={code}
        options={{
          readOnly: true,
          minimap: { enabled: true },
          fontSize: 14,
          fontFamily: "'JetBrains Mono', monospace",
          lineNumbers: "on",
          wordWrap: "on",
          scrollBeyondLastLine: false,
          automaticLayout: true,
          padding: { top: 8 },
          renderLineHighlight: "none",
          domReadOnly: true,
          smoothScrolling: true,
        }}
        loading={
          <div
            className="w-full h-full flex items-center justify-center"
            style={{ backgroundColor: "var(--bg-editor)" }}
          >
            <span className="text-sm" style={{ color: "var(--text-muted)" }}>
              Loading viewer...
            </span>
          </div>
        }
      />
    </div>
  );
}
