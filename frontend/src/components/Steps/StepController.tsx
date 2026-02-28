// StepController — Compact step progress indicator (used in SidePanel header)
"use client";

interface StepControllerProps {
  currentStep: number;
}

const STEPS = ["Paste", "Convert", "Compile", "Connect", "Deploy"];

export default function StepController({ currentStep }: StepControllerProps) {
  return (
    <div className="flex items-center gap-1 px-3 py-2">
      {STEPS.map((label, i) => (
        <div key={label} className="flex items-center gap-1">
          <div
            className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold"
            style={{
              backgroundColor:
                i < currentStep
                  ? "var(--success)"
                  : i === currentStep
                  ? "var(--accent)"
                  : "var(--bg-surface)",
              color: i <= currentStep ? "#fff" : "var(--text-muted)",
            }}
            title={label}
          >
            {i < currentStep ? "✓" : i + 1}
          </div>
          {i < STEPS.length - 1 && (
            <div
              className="w-3 h-0.5"
              style={{
                backgroundColor: i < currentStep ? "var(--success)" : "var(--border)",
              }}
            />
          )}
        </div>
      ))}
    </div>
  );
}
