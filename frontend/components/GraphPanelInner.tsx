"use client";

import { useRef, useState, useEffect } from "react";
import CytoscapeComponent from "react-cytoscapejs";
import type { Core, ElementDefinition, StylesheetStyle, EventObject, NodeSingular } from "cytoscape";
import type { GraphData } from "@/lib/types";

// ---------------------------------------------------------------------------
// Category → colour mapping (all 38 valid labels from backend util.py)
// ---------------------------------------------------------------------------

const NODE_COLOURS: Record<string, string> = {
  // transport
  flight:         "#3B82F6",
  train:          "#3B82F6",
  directions_car: "#3B82F6",
  local_shipping: "#3B82F6",

  // location
  place: "#10B981",
  flag:  "#10B981",

  // comms
  translate:       "#8B5CF6",
  alternate_email: "#8B5CF6",
  email:           "#8B5CF6",
  chat:            "#8B5CF6",
  phone:           "#8B5CF6",
  language:        "#8B5CF6",

  // network
  wifi:       "#06B6D4",
  router:     "#06B6D4",
  cell_tower: "#06B6D4",

  // finance
  credit_card:     "#F59E0B",
  wallet:          "#F59E0B",
  account_balance: "#F59E0B",
  sell:            "#F59E0B",

  // security
  lock:  "#EF4444",
  key:   "#EF4444",
  badge: "#EF4444",

  // commerce
  store:         "#F97316",
  shopping_cart: "#F97316",
  business:      "#F97316",
  inventory:     "#F97316",

  // people
  person: "#6366F1",
  group:  "#6366F1",

  // devices
  smartphone: "#6B7280",
  sim_card:   "#6B7280",
  laptop:     "#6B7280",
  monitor:    "#6B7280",
  storage:    "#6B7280",
  cloud:      "#6B7280",
  dns:        "#6B7280",

  // general
  description: "#94A3B8",
  folder:      "#94A3B8",
  swap_horiz:  "#94A3B8",
  link:        "#94A3B8",
};

const DEFAULT_NODE_COLOUR = "#94A3B8";

// ---------------------------------------------------------------------------
// Emoji fallbacks (displayed inside the SVG circle on each node)
// ---------------------------------------------------------------------------

const LABEL_EMOJI: Record<string, string> = {
  flight:          "✈",
  train:           "🚆",
  directions_car:  "🚗",
  local_shipping:  "🚚",
  place:           "📍",
  flag:            "🚩",
  translate:       "🌐",
  alternate_email: "@",
  email:           "✉",
  chat:            "💬",
  phone:           "📞",
  language:        "🌍",
  wifi:            "📶",
  router:          "📡",
  cell_tower:      "📡",
  credit_card:     "💳",
  wallet:          "👛",
  account_balance: "🏦",
  sell:            "🏷",
  lock:            "🔒",
  key:             "🔑",
  badge:           "🪪",
  store:           "🏪",
  shopping_cart:   "🛒",
  business:        "🏢",
  inventory:       "📦",
  person:          "👤",
  group:           "👥",
  smartphone:      "📱",
  sim_card:        "📲",
  laptop:          "💻",
  monitor:         "🖥",
  storage:         "💾",
  cloud:           "☁",
  dns:             "🖧",
  description:     "📄",
  folder:          "📁",
  swap_horiz:      "⇄",
  link:            "🔗",
};

function getColour(label: string): string {
  return NODE_COLOURS[label?.toLowerCase()] ?? DEFAULT_NODE_COLOUR;
}

function makeIconSvg(iconName: string, colour: string): string {
  const emoji = LABEL_EMOJI[iconName] ?? "⚙";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="60" height="60" viewBox="0 0 60 60">
    <circle cx="30" cy="30" r="30" fill="${colour}"/>
    <text x="30" y="33" text-anchor="middle" dominant-baseline="middle"
      font-size="28" fill="white">${emoji}</text>
  </svg>`;
  return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
}

// ---------------------------------------------------------------------------
// Cytoscape stylesheet
// ---------------------------------------------------------------------------

function buildStylesheet(showEdgeLabels = true): StylesheetStyle[] {
  const nodeStyles: StylesheetStyle[] = Object.entries(NODE_COLOURS).map(
    ([label, colour]) => ({
      selector: `node[label = "${label}"]`,
      style: {
        "background-color": colour,
        "background-image": makeIconSvg(label, colour),
        "background-fit": "cover",
        "background-clip": "none",
      },
    })
  );

  return [
    {
      selector: "node",
      style: {
        "background-color": DEFAULT_NODE_COLOUR,
        "background-image": makeIconSvg("link", DEFAULT_NODE_COLOUR),
        "background-fit": "cover",
        "background-clip": "none",
        label: "data(name)",
        color: "rgba(255,255,255,0.9)",
        "font-size": "10px",
        "text-valign": "bottom",
        "text-halign": "center",
        "text-margin-y": 6,
        "text-wrap": "wrap",
        "text-max-width": "80px",
        width: 60,
        height: 60,
        "border-width": 2,
        "border-color": "rgba(255,255,255,0.13)",
      },
    },
    ...nodeStyles,
    {
      selector: "edge",
      style: {
        width: 2,
        "line-color": "rgba(107,114,128,1)",
        "target-arrow-color": "rgba(107,114,128,1)",
        "target-arrow-shape": "triangle",
        "curve-style": "bezier",
        label: "data(label)",
        "font-size": "9px",
        color: showEdgeLabels ? "rgba(156,163,175,1)" : "rgba(0,0,0,0)",
        "text-rotation": "autorotate",
        "text-margin-y": -8,
      },
    },
    {
      selector: "node:selected",
      style: {
        "border-width": 3,
        "border-color": "rgba(96,165,250,1)",
      },
    },
    {
      selector: ".faded",
      style: {
        opacity: 0.15,
        "text-opacity": 0.15,
      } as Record<string, unknown>,
    },
  ];
}

// ---------------------------------------------------------------------------
// Layout cycle order
// ---------------------------------------------------------------------------

const LAYOUTS = ["breadthfirst", "circle", "concentric", "grid", "cose"] as const;
type LayoutName = typeof LAYOUTS[number];

// ---------------------------------------------------------------------------
// Inner component (client-only, rendered by GraphPanel via dynamic import)
// ---------------------------------------------------------------------------

interface GraphPanelInnerProps {
  graph: GraphData;
}

export default function GraphPanelInner({ graph }: GraphPanelInnerProps) {
  const cyRef = useRef<Core | null>(null);
  const [cyInstance, setCyInstance] = useState<Core | null>(null);
  const [layoutIndex, setLayoutIndex] = useState(0);
  const [showEdgeLabels, setShowEdgeLabels] = useState(true);
  const [tooltip, setTooltip] = useState<{ visible: boolean; x: number; y: number; name: string; description: string; }>(
    { visible: false, x: 0, y: 0, name: "", description: "" }
  );
  const graphKey = graph.nodes.map((n) => n.data.id).join("-") || "empty";

  // ---- Node tap / highlight (runs once cyRef is populated) ----

  useEffect(() => {
    const cy = cyInstance;
    if (!cy) return;

    const onNodeTap = (evt: EventObject) => {
      const node = evt.target as NodeSingular;
      const pos = evt.renderedPosition as { x: number; y: number };
      // Highlight connected neighbourhood
      cy.elements().addClass("faded");
      node.closedNeighborhood().removeClass("faded");
      // Show tooltip
      setTooltip({
        visible: true,
        x: pos.x,
        y: pos.y,
        name: node.data("name") as string,
        description: node.data("description") as string,
      });
    };

    const onBgTap = (evt: EventObject) => {
      if (evt.target === cy) {
        cy.elements().removeClass("faded");
        setTooltip((t) => ({ ...t, visible: false }));
      }
    };

    cy.on("tap", "node", onNodeTap);
    cy.on("tap", onBgTap);

    return () => {
      cy.removeListener("tap", "node", onNodeTap as never);
      cy.removeListener("tap", onBgTap as never);
    };
  }, [cyInstance]);

  // ---- Tier 1 handlers ----

  function handleZoomIn() {
    const cy = cyRef.current;
    if (!cy) return;
    cy.zoom({ level: cy.zoom() * 1.2, renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 } });
  }

  function handleZoomOut() {
    const cy = cyRef.current;
    if (!cy) return;
    cy.zoom({ level: cy.zoom() * 0.8, renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 } });
  }

  function handleFit() {
    cyRef.current?.fit(undefined, 40);
  }

  function handleReset() {
    const cy = cyRef.current;
    if (!cy) return;
    cy.zoom(1);
    cy.center();
  }

  function handleExport() {
    const cy = cyRef.current;
    if (!cy) return;
    const blob = cy.png({ output: "blob", bg: "#1f2937", full: true, scale: 2 });
    const url = URL.createObjectURL(blob as Blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "system-flow.png";
    a.click();
    URL.revokeObjectURL(url);
  }

  // ---- Tier 2 handler ----

  function handleCycleLayout() {
    const next = (layoutIndex + 1) % LAYOUTS.length;
    setLayoutIndex(next);
    cyRef.current?.layout({
      name: LAYOUTS[next] as LayoutName,
      animate: true,
      animationDuration: 400,
      padding: 40,
      spacingFactor: 1.8,
      avoidOverlap: true,
    } as Parameters<Core["layout"]>[0]).run();
  }

  // ---- Edge label toggle ----

  function handleToggleEdgeLabels() {
    setShowEdgeLabels((prev) => !prev);
  }

  const elements: ElementDefinition[] = [
    ...graph.nodes.map((n) => ({
      data: {
        id: String(n.data.id),
        label: n.data.label?.toLowerCase() ?? "link",
        name: n.data.name ?? "",
        description: n.data.description ?? "",
      },
    })),
    ...graph.edges.map((e) => ({
      data: {
        id: String(e.data.id),
        label: e.data.label ?? "",
        source: String(e.data.source),
        target: String(e.data.target),
      },
    })),
  ];

  // ---- Toolbar button helper ----

  function ToolbarBtn({ icon, label, onClick, active }: {
    icon: string; label: string; onClick: () => void; active?: boolean;
  }) {
    return (
      <div className="relative group">
        <button
          onClick={onClick}
          className={`flex items-center justify-center w-8 h-8 rounded-lg transition-colors
            ${active
              ? "bg-indigo-600 text-white hover:bg-indigo-500"
              : "text-gray-400 hover:text-gray-100 hover:bg-gray-700"
            }`}
          aria-label={label}
        >
          <span className="material-icons text-[18px]">{icon}</span>
        </button>
        <div className="pointer-events-none absolute bottom-full mb-1.5 left-1/2 -translate-x-1/2 z-50 opacity-0 group-hover:opacity-100 transition-opacity duration-150">
          <div className="whitespace-nowrap rounded-md bg-gray-800 border border-gray-700 px-2 py-1 text-xs text-gray-200 shadow-lg">{label}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-2">
      {/* ---- Toolbar ---- */}
      <div className="flex items-center gap-1 flex-shrink-0">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-gray-400 mr-auto">
          System Flow Graph
        </h2>
        {/* Tier 1 */}
        <ToolbarBtn icon="zoom_in"      label="Zoom in"      onClick={handleZoomIn} />
        <ToolbarBtn icon="zoom_out"     label="Zoom out"     onClick={handleZoomOut} />
        <ToolbarBtn icon="fit_screen"   label="Fit to screen" onClick={handleFit} />
        <ToolbarBtn icon="restart_alt"  label="Reset zoom"   onClick={handleReset} />
        <ToolbarBtn icon="download"     label="Export PNG"   onClick={handleExport} />
        {/* Divider */}
        <div className="w-px h-5 bg-gray-700 mx-1" />
        {/* Tier 2 */}
        <div className="relative group">
          <button
            onClick={handleCycleLayout}
            className="flex items-center gap-1 px-2 h-8 rounded-lg text-gray-400 hover:text-gray-100 hover:bg-gray-700 transition-colors"
            aria-label="Cycle layout"
          >
            <span className="material-icons text-[18px]">loop</span>
            <span className="text-[11px] font-medium capitalize">{LAYOUTS[layoutIndex]}</span>
          </button>
          <div className="pointer-events-none absolute bottom-full mb-1.5 left-1/2 -translate-x-1/2 z-50 opacity-0 group-hover:opacity-100 transition-opacity duration-150">
            <div className="whitespace-nowrap rounded-md bg-gray-800 border border-gray-700 px-2 py-1 text-xs text-gray-200 shadow-lg">Cycle layout</div>
          </div>
        </div>
        {/* Edge labels toggle */}
        <ToolbarBtn
          icon={showEdgeLabels ? "label" : "label_off"}
          label={showEdgeLabels ? "Hide edge labels" : "Show edge labels"}
          onClick={handleToggleEdgeLabels}
          active={!showEdgeLabels}
        />
      </div>

      {/* ---- Canvas ---- */}
      <div
        className="relative flex-1 rounded-lg overflow-hidden border border-gray-700 bg-gray-800"
        aria-label="System architecture graph"
        role="img"
      >
        {/* Node tooltip */}
        {tooltip.visible && (
          <div
            className="pointer-events-none absolute z-50 max-w-[220px] rounded-lg bg-gray-900 border border-gray-700 shadow-xl p-3"
            style={{ left: tooltip.x + 12, top: tooltip.y - 8 }}
          >
            <p className="text-xs font-semibold text-indigo-300 mb-1 truncate">{tooltip.name}</p>
            {tooltip.description
              ? <p className="text-xs text-gray-300 leading-relaxed line-clamp-4">{tooltip.description}</p>
              : <p className="text-xs text-gray-500 italic">No description</p>
            }
          </div>
        )}
        <CytoscapeComponent
          key={graphKey}
          elements={elements}
          stylesheet={buildStylesheet(showEdgeLabels)}
          layout={{
            name: "breadthfirst",
            directed: true,
            padding: 40,
            spacingFactor: 1.8,
            avoidOverlap: true,
            animate: true,
            animationDuration: 400,
          }}
          style={{ width: "100%", height: "100%" }}
          cy={(cy) => { cyRef.current = cy; setCyInstance(cy); }}
        />
      </div>
    </div>
  );
}
