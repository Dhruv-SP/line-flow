"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export default function MarkdownContent({ children }: { children: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        p: ({ children }) => <p className="mb-2 last:mb-0 leading-relaxed">{children}</p>,
        ul: ({ children }) => <ul className="list-disc pl-4 mb-2 space-y-1">{children}</ul>,
        ol: ({ children }) => <ol className="list-decimal pl-4 mb-2 space-y-1">{children}</ol>,
        li: ({ children }) => <li className="leading-relaxed">{children}</li>,
        strong: ({ children }) => <strong className="font-semibold text-white">{children}</strong>,
        em: ({ children }) => <em className="italic text-gray-300">{children}</em>,
        code: ({ children }) => (
          <code className="bg-gray-700 rounded px-1 py-0.5 text-xs font-mono text-gray-200">
            {children}
          </code>
        ),
        pre: ({ children }) => (
          <pre className="bg-gray-700 rounded p-3 overflow-x-auto text-xs font-mono mb-2 text-gray-200">
            {children}
          </pre>
        ),
        h1: ({ children }) => <h1 className="text-base font-bold mb-2 text-white">{children}</h1>,
        h2: ({ children }) => <h2 className="text-sm font-bold mb-1 text-white">{children}</h2>,
        h3: ({ children }) => <h3 className="text-sm font-semibold mb-1 text-gray-100">{children}</h3>,
        blockquote: ({ children }) => (
          <blockquote className="border-l-2 border-gray-500 pl-3 italic text-gray-400 mb-2">
            {children}
          </blockquote>
        ),
        hr: () => <hr className="border-gray-600 my-2" />,
      }}
    >
      {children}
    </ReactMarkdown>
  );
}
