// Card — Container with dark surface styling
"use client";

import React from "react";

interface CardProps {
  children: React.ReactNode;
  className?: string;
  noPadding?: boolean;
}

export default function Card({ children, className = "", noPadding = false }: CardProps) {
  return (
    <div
      className={`rounded-lg ${noPadding ? "" : "p-4"} ${className}`}
      style={{
        backgroundColor: "var(--bg-surface)",
        border: "1px solid var(--border)",
      }}
    >
      {children}
    </div>
  );
}
