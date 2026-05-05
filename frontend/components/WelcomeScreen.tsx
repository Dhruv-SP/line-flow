"use client";

interface WelcomeScreenProps {
  onSelectPrompt: (prompt: string) => void;
}

const EXAMPLE_PROMPTS = [
  "Describe an e-commerce order fulfillment system with inventory, payments, and shipping.",
  "Map out a telecom network with routers, cell towers, and customer devices.",
  "Model a banking platform with accounts, credit cards, and fraud detection.",
];

export default function WelcomeScreen({ onSelectPrompt }: WelcomeScreenProps) {
  return (
    <div className="flex flex-col items-center justify-center flex-1 gap-8 px-6 py-12 text-center">
      {/* Icon + heading */}
      <div className="flex flex-col items-center gap-3">
        <span
          className="material-symbols-outlined text-indigo-400"
          style={{ fontSize: "60px" }}
        >
          graph_3
        </span>
        <h1 className="text-2xl font-semibold text-gray-100 tracking-tight">
          Welcome to SystemFlow
        </h1>
        <p className="text-sm text-gray-400 max-w-sm leading-relaxed">
          Describe a system and I&apos;ll generate a structured description and an interactive
          line graph for analysis.
        </p>
      </div>

      {/* Example prompt chips */}
      <div className="flex flex-col gap-3 w-full max-w-lg">
        <p className="text-xs font-semibold uppercase tracking-widest text-gray-500">
          Try an example
        </p>
        {EXAMPLE_PROMPTS.map((prompt) => (
          <button
            key={prompt}
            onClick={() => onSelectPrompt(prompt)}
            className="rounded-xl border border-gray-700 bg-gray-800/60 px-4 py-3 text-left text-sm text-gray-300 hover:border-indigo-500/60 hover:bg-gray-800 hover:text-gray-100 transition-colors"
          >
            {prompt}
          </button>
        ))}
      </div>
    </div>
  );
}
