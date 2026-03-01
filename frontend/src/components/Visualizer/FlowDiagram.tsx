"use client";

import { useMemo, useCallback } from "react";
import {
  ReactFlow,
  Controls,
  Background,
  BackgroundVariant,
  MarkerType,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
  type NodeMouseHandler,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import MethodNode from "./nodes/MethodNode";
import StateVariableNode from "./nodes/StateVariableNode";
import SubroutineNode from "./nodes/SubroutineNode";
import OffsetSmoothStepEdge from "./edges/OffsetSmoothStepEdge";
import type { ContractAnalysis } from "@/types";

const nodeTypes = {
  method: MethodNode,
  stateVariable: StateVariableNode,
  subroutine: SubroutineNode,
};

const edgeTypes = {
  offsetSmoothStep: OffsetSmoothStepEdge,
};

/* ── Edge color palette ── */
const EDGE_COLORS = {
  call: "#FF6B6B",
  read: "#4ECDC4",
  write: "#FFE66D",
  itxn: "#C084FC",
};

interface FlowDiagramProps {
  analysis: ContractAnalysis;
  onNodeClick?: (nodeId: string, nodeType: string) => void;
  onNodeDoubleClick?: (nodeId: string, lineNumber: number | null) => void;
}

/** Distribute N items evenly from 15% to 85% along an edge */
function spreadPos(index: number, total: number): number {
  if (total <= 1) return 50;
  return 15 + (index * 70) / (total - 1);
}

export interface DynHandle {
  id: string;
  hType: "source" | "target";
  leftPct: number;
  color: string;
}

function buildNodesAndEdges(analysis: ContractAnalysis) {
  const nodes: Node[] = [];
  const edges: Edge[] = [];

  /* ── Layout constants ── */
  const NODE = 240;
  const H_GAP = 80;
  const V_GAP = 280;
  const ROW1 = 40;
  const ROW2 = ROW1 + 120 + V_GAP;   // methods ~120px tall + gap
  const ROW3 = ROW2 + 80 + V_GAP * 0.5;  // state vars ~80px tall + gap

  const nM = analysis.methods.length;
  const nS = analysis.state_variables.length;
  const nSub = analysis.subroutines.length;
  const rowW = (n: number) => n * NODE + Math.max(0, n - 1) * H_GAP;
  const maxW = Math.max(rowW(nM), rowW(nS), rowW(nSub), NODE);
  const offX = (n: number) => (maxW - rowW(n)) / 2;

  /* ── Pre-compute storage connections ── */
  const storageMap = new Map<string, { reads: boolean; writes: boolean }>();
  for (const sa of analysis.storage_access_map) {
    const key = `${sa.method}|${sa.variable}`;
    const ex = storageMap.get(key) || { reads: false, writes: false };
    if (sa.access_type === "write") ex.writes = true;
    else ex.reads = true;
    storageMap.set(key, ex);
  }

  // method → set of connected variable names
  const mVars = new Map<string, string[]>();
  // variable → set of connected method names
  const vMethods = new Map<string, string[]>();
  storageMap.forEach((_, key) => {
    const [m, v] = key.split("|");
    if (!mVars.has(m)) mVars.set(m, []);
    const vars = mVars.get(m)!;
    if (!vars.includes(v)) vars.push(v);
    if (!vMethods.has(v)) vMethods.set(v, []);
    const methods = vMethods.get(v)!;
    if (!methods.includes(m)) methods.push(m);
  });

  // method → call targets
  const mCalls = new Map<string, string[]>();
  analysis.call_graph.forEach((cg) => {
    if (!mCalls.has(cg.from)) mCalls.set(cg.from, []);
    mCalls.get(cg.from)!.push(cg.to);
  });

  /* ── Build method nodes (Row 1) ── */
  analysis.methods.forEach((m, i) => {
    const x = offX(nM) + i * (NODE + H_GAP);
    const connVars = mVars.get(m.name) || [];
    const callTargets = mCalls.get(m.name) || [];

    // Build bottom handle slots: writes, reads, then calls — each gets unique position
    const slots: { id: string; hType: "source" | "target"; color: string }[] = [];
    connVars.forEach((v) => {
      const acc = storageMap.get(`${m.name}|${v}`)!;
      if (acc.writes) slots.push({ id: `w-${v}`, hType: "source", color: EDGE_COLORS.write });
      if (acc.reads) slots.push({ id: `r-${v}`, hType: "target", color: EDGE_COLORS.read });
    });
    callTargets.forEach((t) => {
      slots.push({ id: `c-${t}`, hType: "source", color: EDGE_COLORS.call });
    });

    const bottomHandles: DynHandle[] = slots.map((s, idx) => ({
      ...s,
      leftPct: spreadPos(idx, slots.length),
    }));

    nodes.push({
      id: m.name,
      type: "method",
      position: { x, y: ROW1 },
      data: {
        label: m.name,
        decorator: m.decorator,
        is_readonly: m.is_readonly,
        is_create: m.is_create,
        params: m.params,
        return_type: m.return_type,
        guards_count: m.guards_count,
        inner_txns: m.inner_txns,
        emits_events: m.emits_events,
        bottomHandles,
      },
    });
  });

  /* ── Build state variable nodes (Row 2) ── */
  analysis.state_variables.forEach((sv, i) => {
    const x = offX(nS) + i * (NODE + H_GAP);
    const connMethods = vMethods.get(sv.name) || [];
    const id = `state-${sv.name}`;

    // Build top handle slots: write-targets, read-sources
    const slots: { id: string; hType: "source" | "target"; color: string }[] = [];
    connMethods.forEach((m) => {
      const acc = storageMap.get(`${m}|${sv.name}`)!;
      if (acc.writes) slots.push({ id: `w-${m}`, hType: "target", color: EDGE_COLORS.write });
      if (acc.reads) slots.push({ id: `r-${m}`, hType: "source", color: EDGE_COLORS.read });
    });

    const topHandles: DynHandle[] = slots.map((s, idx) => ({
      ...s,
      leftPct: spreadPos(idx, slots.length),
    }));

    nodes.push({
      id,
      type: "stateVariable",
      position: { x, y: ROW2 },
      data: {
        label: sv.name,
        storage_type: sv.storage_type,
        data_type: sv.data_type,
        default_value: sv.default_value,
        topHandles,
      },
    });
  });

  /* ── Build subroutine nodes (Row 3) ── */
  analysis.subroutines.forEach((sub, i) => {
    const x = offX(nSub) + i * (NODE + H_GAP);
    nodes.push({
      id: sub.name,
      type: "subroutine",
      position: { x, y: ROW3 },
      data: {
        label: sub.name,
        params: sub.params,
        return_type: sub.return_type,
      },
    });
  });

  /* ── Global edge counter for unique offset per edge ── */
  let edgeOrdinal = 0;
  const OFFSET_STEP = 30;  // 30px between parallel vertical segments

  /* ── Call graph edges ── */
  analysis.call_graph.forEach((cg, i) => {
    edges.push({
      id: `call-${i}`,
      source: cg.from,
      target: cg.to,
      sourceHandle: `c-${cg.to}`,
      targetHandle: "target-top",
      type: "offsetSmoothStep",
      animated: true,
      data: { routingOffset: edgeOrdinal * OFFSET_STEP },
      style: { stroke: EDGE_COLORS.call, strokeWidth: 2.5 },
      markerEnd: { type: MarkerType.ArrowClosed, color: EDGE_COLORS.call, width: 18, height: 18 },
      label: "calls",
      labelStyle: { fill: EDGE_COLORS.call, fontSize: 10, fontWeight: 700 },
      labelBgStyle: { fill: "#0d0d1a", fillOpacity: 0.95, rx: 6, ry: 6 },
      labelBgPadding: [8, 4] as [number, number],
    } as Edge);
    edgeOrdinal++;
  });

  /* ── Storage edges ── */
  let sIdx = 0;
  storageMap.forEach((access, key) => {
    const [method, variable] = key.split("|");
    const stateId = `state-${variable}`;

    if (access.writes) {
      edges.push({
        id: `sw-${sIdx}`,
        source: method,
        target: stateId,
        sourceHandle: `w-${variable}`,
        targetHandle: `w-${method}`,
        type: "offsetSmoothStep",
        animated: true,
        data: { routingOffset: edgeOrdinal * OFFSET_STEP },
        style: { stroke: EDGE_COLORS.write, strokeWidth: 2.5 },
        markerEnd: { type: MarkerType.ArrowClosed, color: EDGE_COLORS.write, width: 16, height: 16 },
        label: "writes",
        labelStyle: { fill: EDGE_COLORS.write, fontSize: 9, fontWeight: 700 },
        labelBgStyle: { fill: "#0d0d1a", fillOpacity: 0.95, rx: 5, ry: 5 },
        labelBgPadding: [6, 3] as [number, number],
      } as Edge);
      edgeOrdinal++;
    }

    if (access.reads) {
      edges.push({
        id: `sr-${sIdx}`,
        source: stateId,
        target: method,
        sourceHandle: `r-${method}`,
        targetHandle: `r-${variable}`,
        type: "offsetSmoothStep",
        data: { routingOffset: edgeOrdinal * OFFSET_STEP },
        style: { stroke: EDGE_COLORS.read, strokeWidth: 2, strokeDasharray: "6 4" },
        markerEnd: { type: MarkerType.ArrowClosed, color: EDGE_COLORS.read, width: 14, height: 14 },
        label: "reads",
        labelStyle: { fill: EDGE_COLORS.read, fontSize: 9, fontWeight: 700 },
        labelBgStyle: { fill: "#0d0d1a", fillOpacity: 0.95, rx: 5, ry: 5 },
        labelBgPadding: [6, 3] as [number, number],
      } as Edge);
      edgeOrdinal++;
    }

    sIdx++;
  });

  /* ── Inner transaction edges (self-ref) ── */
  analysis.inner_txn_map.forEach((itx, i) => {
    const exists = nodes.find((n) => n.id === itx.method);
    if (exists) {
      edges.push({
        id: `itxn-${i}`,
        source: itx.method,
        target: itx.method,
        type: "offsetSmoothStep",
        animated: true,
        data: { routingOffset: edgeOrdinal * OFFSET_STEP },
        style: { stroke: EDGE_COLORS.itxn, strokeWidth: 2 },
        markerEnd: { type: MarkerType.ArrowClosed, color: EDGE_COLORS.itxn, width: 14, height: 14 },
        label: `\u26A1 ${itx.txn_type}`,
        labelStyle: { fill: "#E9D5FF", fontSize: 9, fontWeight: 700 },
        labelBgStyle: { fill: "#1e1040", fillOpacity: 0.95, rx: 5, ry: 5 },
        labelBgPadding: [6, 3] as [number, number],
      } as Edge);
      edgeOrdinal++;
    }
  });

  return { nodes, edges };
}

export default function FlowDiagram({
  analysis,
  onNodeClick,
  onNodeDoubleClick,
}: FlowDiagramProps) {
  const { nodes: initialNodes, edges: initialEdges } = useMemo(
    () => buildNodesAndEdges(analysis),
    [analysis]
  );

  const [nodes, , onNodesChange] = useNodesState(initialNodes);
  const [edges, , onEdgesChange] = useEdgesState(initialEdges);

  const handleNodeClick: NodeMouseHandler = useCallback(
    (_, node) => {
      onNodeClick?.(node.id, node.type || "method");
    },
    [onNodeClick]
  );

  const handleNodeDoubleClick: NodeMouseHandler = useCallback(
    (_, node) => {
      const method = analysis.methods.find((m) => m.name === node.id);
      const sub = analysis.subroutines.find((s) => s.name === node.id);
      const lineNumber = method?.line_number ?? sub?.line_number ?? null;
      onNodeDoubleClick?.(node.id, lineNumber);
    },
    [analysis, onNodeDoubleClick]
  );

  return (
    <ReactFlow
      key={`${analysis.contract_name}-${analysis.methods.length}`}
      nodes={nodes}
      edges={edges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onNodeClick={handleNodeClick}
      onNodeDoubleClick={handleNodeDoubleClick}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      nodesDraggable={true}
      fitView
      fitViewOptions={{ padding: 0.3 }}
      minZoom={0.3}
      maxZoom={2}
      proOptions={{ hideAttribution: true }}
    >
      <Background variant={BackgroundVariant.Dots} gap={24} size={1.2} color="rgba(255,255,255,.06)" />
      <Controls showInteractive={false} />
    </ReactFlow>
  );
}
