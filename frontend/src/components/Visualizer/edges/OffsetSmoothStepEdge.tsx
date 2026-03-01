"use client";

import {
  getSmoothStepPath,
  BaseEdge,
  EdgeLabelRenderer,
  type EdgeProps,
} from "@xyflow/react";

/**
 * Custom smoothstep edge that actually applies a routing offset.
 *
 * React Flow's built-in "smoothstep" edge ignores `pathOptions` set on the
 * edge config object.  This component reads `data.routingOffset` and passes
 * it directly to `getSmoothStepPath`, guaranteeing that each edge's
 * horizontal middle segment is shifted by a unique amount so no two edges
 * share the same vertical corridor.
 */
export default function OffsetSmoothStepEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  style,
  markerEnd,
  markerStart,
  label,
  labelStyle,
  labelShowBg = true,
  labelBgStyle,
  labelBgPadding,
  labelBgBorderRadius = 6,
}: EdgeProps) {
  const offset = (data?.routingOffset as number) ?? 0;

  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    borderRadius: 8,
    offset,
  });

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        style={style}
        markerEnd={markerEnd}
        markerStart={markerStart}
      />
      {label && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: "absolute",
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
              pointerEvents: "all",
              fontSize: 9,
              fontWeight: 700,
              ...(labelStyle as React.CSSProperties),
            }}
            className="nodrag nopan"
          >
            {labelShowBg && (
              <span
                style={{
                  padding: labelBgPadding
                    ? `${labelBgPadding[1]}px ${labelBgPadding[0]}px`
                    : "3px 6px",
                  borderRadius: labelBgBorderRadius,
                  ...(labelBgStyle as React.CSSProperties),
                }}
              >
                {label}
              </span>
            )}
            {!labelShowBg && label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
