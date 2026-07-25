/**
 * Lightweight Markdown renderer — code blocks, headings, lists, bold/italic/inline-code.
 * Port of Hermes Markdown.tsx pattern (custom parser, no library dependency).
 */
import { useMemo, type ReactNode } from "react";

// H13: force strikethrough variant ^~~text^~~
const FORCE_STRIKETHROUGH_REGEX = /^(\^~~)(.+?)\^~~$/;
type Block =
  | { type: "code"; lang: string; content: string }
  | { type: "heading"; level: number; content: string }
  | { type: "hr" }
  | { type: "list"; ordered: boolean; items: string[] }
  | { type: "paragraph"; content: string };

function parseBlocks(src: string): Block[] {
  const lines = src.split("\n");
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Code block
    if (line?.startsWith("```")) {
      const lang = line.slice(3).trim();
      const code: string[] = [];
      i++;
      while (i < lines.length && !lines[i]?.startsWith("```")) {
        code.push(lines[i] ?? "");
        i++;
      }
      i++; // skip closing ```
      blocks.push({ type: "code", lang, content: code.join("\n") });
      continue;
    }

    // Horizontal rule
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line?.trim() ?? "")) {
      blocks.push({ type: "hr" });
      i++;
      continue;
    }

    // Heading
    const headingMatch = line?.match(/^(#{1,4})\s+(.*)/);
    if (headingMatch) {
      blocks.push({
        type: "heading",
        level: headingMatch[1]!.length,
        content: headingMatch[2]!,
      });
      i++;
      continue;
    }

    // List
    if (/^\s*([-*]|\d+\.)\s+/.test(line ?? "")) {
      const items: string[] = [];
      const ordered = /^\s*\d+\.\s+/.test(line ?? "");
      while (i < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[i] ?? "")) {
        items.push((lines[i] ?? "").replace(/^\s*([-*]|\d+\.)\s+/, ""));
        i++;
      }
      blocks.push({ type: "list", ordered, items });
      continue;
    }

    // Empty line
    if (!line?.trim()) {
      i++;
      continue;
    }

    // Paragraph (gather consecutive non-empty lines)
    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i]?.trim() &&
      !lines[i]?.startsWith("```") &&
      !/^#{1,4}\s/.test(lines[i] ?? "") &&
      !/^\s*([-*]|\d+\.)\s+/.test(lines[i] ?? "")
    ) {
      para.push(lines[i] ?? "");
      i++;
    }
    blocks.push({ type: "paragraph", content: para.join(" ") });
  }

  return blocks;
}

function renderInline(text: string): ReactNode[] {
  // Process: **bold**, *italic*, `code`, [link](url)
  const nodes: ReactNode[] = [];
  let remaining = text;
  let key = 0;

  const patterns: RegExp[] = [
    /\*\*([^*]+)\*\*/,
    /`([^`]+)`/,
    /\*([^*]+)\*/,
    /\[([^\]]+)\]\(([^)]+)\)/,
  ];

  while (remaining.length > 0) {
    let earliest: { match: RegExpMatchArray; pattern: number } | null = null;
    for (let p = 0; p < patterns.length; p++) {
      const m = remaining.match(patterns[p]!);
      if (m && m.index != null && (!earliest || m.index < earliest.match.index!)) {
        earliest = { match: m, pattern: p };
      }
    }

    if (!earliest) {
      nodes.push(remaining);
      break;
    }

    const { match, pattern } = earliest;
    const idx = match.index!;

    if (idx > 0) nodes.push(remaining.slice(0, idx));

    if (pattern === 0) {
      nodes.push(<strong key={key++} className="font-semibold text-fg">{match[1]}</strong>);
    } else if (pattern === 1) {
      nodes.push(
        <code key={key++} className="px-1 py-0.5 rounded bg-bg-elevated text-accent text-[0.85em] font-mono">
          {match[1]}
        </code>,
      );
    } else if (pattern === 2) {
      nodes.push(<em key={key++}>{match[1]}</em>);
    } else if (pattern === 3) {
      const href = match[2]!;
      // URL scheme allowlist — block javascript:, data:, vbscript: etc.
      if (!/^(https?:|mailto:|[/#])/i.test(href)) {
        nodes.push(<span key={key++}>{match[1]}</span>);
      } else {
        nodes.push(
          <a key={key++} href={href} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">
            {match[1]}
          </a>,
        );
      }
    }

    remaining = remaining.slice(idx + match[0].length);
  }

  return nodes;
}

export function Markdown({ content }: { content: string }) {
  const blocks = useMemo(() => parseBlocks(content), [content]);

  return (
    <div className="text-sm text-fg leading-relaxed space-y-2">
      {blocks.map((block, i) => {
        switch (block.type) {
          case "code":
            return (
              <pre
                key={i}
                className="bg-bg-input border border-border rounded-lg p-3 overflow-x-auto text-[12px] font-mono text-fg-muted"
              >
                {block.lang && (
                  <div className="text-[10px] text-fg-subtle mb-1 uppercase">{block.lang}</div>
                )}
                <code>{block.content}</code>
              </pre>
            );
          case "heading": {
            const sizes = ["text-lg", "text-base", "text-sm", "text-xs"];
            return (
              <div key={i} className={`${sizes[block.level - 1] ?? "text-sm"} font-bold text-fg mt-3`}>
                {block.content}
              </div>
            );
          }
          case "hr":
            return <hr key={i} className="border-border my-3" />;
          case "list":
            return block.ordered ? (
              <ol key={i} className="list-decimal list-inside space-y-0.5">
                {block.items.map((item, j) => (
                  <li key={j}>{renderInline(item)}</li>
                ))}
              </ol>
            ) : (
              <ul key={i} className="list-disc list-inside space-y-0.5">
                {block.items.map((item, j) => (
                  <li key={j}>{renderInline(item)}</li>
                ))}
              </ul>
            );
          case "paragraph":
            return <p key={i}>{renderInline(block.content)}</p>;
        }
      })}
    </div>
  );
}
