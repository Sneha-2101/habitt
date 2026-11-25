export const MAX_CONTENT_LENGTH = 20000;

export type ContentBlock =
  | { type: "h2"; text: string }
  | { type: "p"; lines: string[] }
  | { type: "ul"; items: string[] };

/**
 * Pure, dependency-free structured text renderer.
 * Supports:
 * - "## " heading lines -> { type: "h2", text }
 * - "- " bullet lines -> { type: "ul", items }
 * - Blank-line separated paragraphs with single newlines preserved as lines -> { type: "p", lines }
 * No raw HTML or link parsing. Enforces max length (20000 chars).
 */
export function renderContentBlocks(
  input: string,
  maxLength: number = MAX_CONTENT_LENGTH
): ContentBlock[] {
  if (input.length > maxLength) {
    throw new Error(`Content exceeds maximum length of ${maxLength} characters`);
  }

  const normalized = input.replace(/\r\n/g, "\n");
  const rawLines = normalized.split("\n");
  const blocks: ContentBlock[] = [];

  let currentParagraph: string[] = [];
  let currentList: string[] = [];

  const flushParagraph = () => {
    if (currentParagraph.length > 0) {
      blocks.push({ type: "p", lines: currentParagraph });
      currentParagraph = [];
    }
  };

  const flushList = () => {
    if (currentList.length > 0) {
      blocks.push({ type: "ul", items: currentList });
      currentList = [];
    }
  };

  for (const rawLine of rawLines) {
    const trimmed = rawLine.trim();

    if (trimmed === "") {
      flushParagraph();
      flushList();
      continue;
    }

    if (trimmed.startsWith("## ")) {
      flushParagraph();
      flushList();
      const text = trimmed.slice(3).trim();
      if (text.length > 0) {
        blocks.push({ type: "h2", text });
      }
      continue;
    }

    if (trimmed.startsWith("- ")) {
      flushParagraph();
      const item = trimmed.slice(2).trim();
      if (item.length > 0) {
        currentList.push(item);
      }
      continue;
    }

    flushList();
    currentParagraph.push(trimmed);
  }

  flushParagraph();
  flushList();

  return blocks;
}
