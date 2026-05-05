"use client";

import dynamic from "next/dynamic";
import type { GraphData } from "@/lib/types";
import GraphAnimation from "@/components/GraphAnimation";

// ---------------------------------------------------------------------------
// Cytoscape loaded client-side only (requires browser APIs)
// ---------------------------------------------------------------------------

const GraphPanelInner = dynamic(() => import("@/components/GraphPanelInner"), {
  ssr: false,
  loading: () => <GraphSkeleton />,
});

// ---------------------------------------------------------------------------
// Skeleton shown while Cytoscape is loading or graph is being generated
// ---------------------------------------------------------------------------

function GraphSkeleton() {
  return (
    <div className="flex h-full flex-col">
      <div className="mb-2 h-3 w-32 rounded bg-gray-700 animate-pulse" />
      <div className="flex-1 rounded-lg border border-gray-700 bg-gray-800 animate-pulse" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Public component
// ---------------------------------------------------------------------------

interface GraphPanelProps {
  graph: GraphData | null;
  isLoading: boolean;
}

export default function GraphPanel({ graph, isLoading }: GraphPanelProps) {
  if (isLoading && !graph) {
    return <GraphSkeleton />;
  }
  if (!graph) {
    return <GraphAnimation />;
  }
  return <GraphPanelInner graph={graph} />;
}
