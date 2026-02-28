// SolidityEditor — Monaco editor component for Solidity code input
"use client";

import dynamic from "next/dynamic";
import type { editor } from "monaco-editor";

const Editor = dynamic(() => import("@monaco-editor/react"), { ssr: false });

interface SolidityEditorProps {
  value: string;
  onChange: (value: string) => void;
  readOnly?: boolean;
  onCursorChange?: (line: number, col: number) => void;
}

export default function SolidityEditor({
  value,
  onChange,
  readOnly = false,
  onCursorChange,
}: SolidityEditorProps) {
  const handleEditorMount = (editorInstance: editor.IStandaloneCodeEditor) => {
    if (onCursorChange) {
      editorInstance.onDidChangeCursorPosition((e) => {
        onCursorChange(e.position.lineNumber, e.position.column);
      });
    }
  };

  return (
    <div className="relative w-full h-full" style={{ backgroundColor: "var(--bg-editor)" }}>
      {/* Placeholder overlay when editor is empty */}
      {!value && (
        <div
          className="absolute inset-0 z-10 flex items-center justify-center pointer-events-none"
          style={{ backgroundColor: "var(--bg-editor)" }}
        >
          <div className="text-center space-y-3 max-w-sm px-4">
            <div className="text-3xl">◆</div>
            <div className="text-sm font-medium" style={{ color: "var(--text-secondary)" }}>
              Paste your Solidity contract here
            </div>
            <div className="text-xs" style={{ color: "var(--text-muted)" }}>
              or load a sample from the&nbsp;
              <span style={{ color: "var(--accent)" }}>File Explorer</span>
              &nbsp;panel
            </div>
            <div className="text-[10px] mt-4" style={{ color: "var(--text-muted)" }}>
              Supports Solidity 0.8.x contracts
            </div>
          </div>
        </div>
      )}

      <Editor
        height="100%"
        language="sol"
        theme="vs-dark"
        value={value}
        onChange={(v) => onChange(v ?? "")}
        onMount={handleEditorMount}
        options={{
          readOnly,
          minimap: { enabled: true },
          fontSize: 14,
          fontFamily: "'JetBrains Mono', monospace",
          lineNumbers: "on",
          wordWrap: "on",
          scrollBeyondLastLine: false,
          automaticLayout: true,
          padding: { top: 8 },
          renderLineHighlight: "all",
          glyphMargin: true,
          tabSize: 4,
          smoothScrolling: true,
          cursorBlinking: "smooth",
          cursorSmoothCaretAnimation: "on",
          bracketPairColorization: { enabled: true },
        }}
        loading={
          <div
            className="w-full h-full flex items-center justify-center"
            style={{ backgroundColor: "var(--bg-editor)" }}
          >
            <span className="text-sm" style={{ color: "var(--text-muted)" }}>
              Loading editor...
            </span>
          </div>
        }
      />
    </div>
  );
}
