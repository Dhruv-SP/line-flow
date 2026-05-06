"use client";

import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import type { Easing } from "framer-motion";

// ---------------------------------------------------------------------------
// Procedural graph generation
// ---------------------------------------------------------------------------

const VIEWBOX = 200;
const PADDING = 18;       // min distance from SVG edge
const MIN_DIST = 28;      // min distance between any two nodes
const MAX_RETRIES = 40;   // max placement attempts per node

interface GNode { id: number; x: number; y: number }
interface GEdge { id: string; source: number; target: number }
interface StyledNode extends GNode { r: number; stroke: string }

function dist(a: GNode, b: GNode) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function placeNodes(count: number): GNode[] {
  const nodes: GNode[] = [];
  for (let i = 0; i < count; i++) {
    let placed = false;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      const x = PADDING + Math.random() * (VIEWBOX - PADDING * 2);
      const y = PADDING + Math.random() * (VIEWBOX - PADDING * 2);
      const candidate = { id: i, x, y };
      if (nodes.every((n) => dist(n, candidate) >= MIN_DIST)) {
        nodes.push(candidate);
        placed = true;
        break;
      }
    }
    // If placement failed after retries, relax and place anywhere valid
    if (!placed) {
      nodes.push({
        id: i,
        x: PADDING + Math.random() * (VIEWBOX - PADDING * 2),
        y: PADDING + Math.random() * (VIEWBOX - PADDING * 2),
      });
    }
  }
  return nodes;
}

// Random spanning tree — shuffles node order, connects each node to a random
// already-visited predecessor, guaranteeing full connectivity with no cycles.
function buildSpanningTree(nodes: GNode[]): GEdge[] {
  const shuffled = [...nodes].sort(() => Math.random() - 0.5);
  const edges: GEdge[] = [];
  for (let i = 1; i < shuffled.length; i++) {
    const target = shuffled[i];
    const source = shuffled[Math.floor(Math.random() * i)];
    edges.push({ id: `e-${source.id}-${target.id}`, source: source.id, target: target.id });
  }
  return edges;
}

// Add extra random edges (up to floor(N * 0.6)) for architectural complexity.
// Skips pairs that already have an edge to avoid duplicates.
function addExtraEdges(nodes: GNode[], existing: GEdge[]): GEdge[] {
  const edgeSet = new Set(existing.map((e) => `${e.source}-${e.target}`));
  const extra: GEdge[] = [];
  const cap = Math.floor(nodes.length * 0.6);

  for (let i = 0; i < nodes.length && extra.length < cap; i++) {
    for (let j = i + 1; j < nodes.length && extra.length < cap; j++) {
      const key = `${nodes[i].id}-${nodes[j].id}`;
      const keyRev = `${nodes[j].id}-${nodes[i].id}`;
      if (!edgeSet.has(key) && !edgeSet.has(keyRev) && Math.random() < 0.35) {
        extra.push({ id: `e-${nodes[i].id}-${nodes[j].id}`, source: nodes[i].id, target: nodes[j].id });
        edgeSet.add(key);
      }
    }
  }
  return extra;
}

// Compute degree map: nodeId → number of connected edges
function computeDegrees(nodes: GNode[], edges: GEdge[]): Map<number, number> {
  const deg = new Map<number, number>(nodes.map((n) => [n.id, 0]));
  for (const e of edges) {
    deg.set(e.source, (deg.get(e.source) ?? 0) + 1);
    deg.set(e.target, (deg.get(e.target) ?? 0) + 1);
  }
  return deg;
}

// Visual properties based on degree
function nodeStyle(degree: number): { r: number; stroke: string } {
  if (degree >= 3) return { r: 10, stroke: "#818cf8" }; // hub — bright indigo
  if (degree === 2) return { r: 8,  stroke: "#6366f1" }; // default
  return            { r: 6,  stroke: "#4f46e5" };         // leaf — dim
}

// Keyframe timing: 0→appear, 0.22→hold start, 0.75→hold end, 1→gone
const TIMES = [0, 0.22, 0.75, 1];
const LOOP_DURATION = 4;   // seconds per cycle
const REPEAT_DELAY = 0.6;  // pause between cycles
const STAGGER = 0.09;      // seconds between each outer node

function nodeAnim(delay: number) {
  return {
    scale: [0, 1, 1, 0],
    opacity: [0, 1, 1, 0],
    transition: {
      duration: LOOP_DURATION,
      times: TIMES,
      ease: ["backOut", "linear", "easeIn"] as Easing[],
      delay,
    },
  };
}

function edgeAnim(delay: number) {
  return {
    opacity: [0, 0.65, 0.65, 0],
    transition: {
      duration: LOOP_DURATION,
      times: TIMES,
      ease: "easeInOut" as const,
      delay,
    },
  };
}

// Build a new random graph — called fresh every cycle
function generateGraph(): { nodes: StyledNode[]; edges: GEdge[] } {
  const count = 10 + Math.floor(Math.random() * 5); // 10–14 nodes
  const rawNodes = placeNodes(count);
  const spanTree = buildSpanningTree(rawNodes);
  const extra = addExtraEdges(rawNodes, spanTree);
  const allEdges = [...spanTree, ...extra];
  const deg = computeDegrees(rawNodes, allEdges);
  const styledNodes: StyledNode[] = rawNodes.map((n) => ({
    ...n,
    ...nodeStyle(deg.get(n.id) ?? 0),
  }));
  return { nodes: styledNodes, edges: allEdges };
}

export default function GraphAnimation() {
  const [graph, setGraph] = useState<{ nodes: StyledNode[]; edges: GEdge[] } | null>(null);
  const [cycleKey, setCycleKey] = useState(0);

  useEffect(() => {
    const newGraph = generateGraph();
    setGraph(newGraph);
    // Fire next cycle just after the last node finishes its disappear
    const duration = ((newGraph.nodes.length - 1) * STAGGER + LOOP_DURATION + REPEAT_DELAY) * 1000;
    const timer = setTimeout(() => setCycleKey((k) => k + 1), duration);
    return () => clearTimeout(timer);
  }, [cycleKey]);

  if (!graph) return null; // SSR renders nothing — no hydration mismatch

  const { nodes, edges } = graph;
  // Build a lookup map for fast edge rendering
  const nodeById = new Map(nodes.map((n) => [n.id, n]));

  return (
    <div className="flex h-full flex-col items-center justify-center gap-4">
      <svg
        key={cycleKey}
        viewBox={`0 0 ${VIEWBOX} ${VIEWBOX}`}
        className="w-52 h-52"
        aria-hidden="true"
      >
        {/* Edges — staggered fade-in/out */}
        {edges.map((edge, i) => {
          const src = nodeById.get(edge.source);
          const tgt = nodeById.get(edge.target);
          if (!src || !tgt) return null;
          return (
            <motion.line
              key={edge.id}
              x1={src.x}
              y1={src.y}
              x2={tgt.x}
              y2={tgt.y}
              stroke="#6366f1"
              strokeWidth="1.5"
              strokeLinecap="round"
              initial={{ opacity: 0 }}
              animate={edgeAnim(i * STAGGER)}
            />
          );
        })}

        {/* Nodes — staggered, sized and coloured by degree */}
        {nodes.map((node, i) => (
          <motion.circle
            key={`node-${node.id}`}
            cx={node.x}
            cy={node.y}
            r={node.r}
            fill="#1e1b4b"
            stroke={node.stroke}
            strokeWidth="1.5"
            style={{ transformBox: "fill-box", transformOrigin: "center" }}
            initial={{ scale: 0, opacity: 0 }}
            animate={nodeAnim(i * STAGGER)}
          />
        ))}
      </svg>

      <p className="text-sm text-gray-500 italic">
        Graph will appear here after your first message.
      </p>
    </div>
  );
}
