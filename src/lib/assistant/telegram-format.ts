// telegram's html mode understands a few tags and nothing else, so the model's markdown is
// turned into those tags after everything else is escaped

function escape(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function toTelegramHtml(markdown: string): string {
  let out = escape(markdown.trim());
  // links first, so the url inside is not touched by the bold or code rules
  out = out.replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, (_m, label: string, url: string) => `<a href="${url.replace(/"/g, "&quot;")}">${label}</a>`);
  out = out.replace(/`([^`\n]+)`/g, "<code>$1</code>");
  out = out.replace(/\*\*([^*\n]+)\*\*/g, "<b>$1</b>");
  out = out.replace(/^#{1,6}\s+(.+)$/gm, "<b>$1</b>");
  out = out.replace(/^\s*[-*]\s+/gm, "- ");
  // telegram caps a message at 4096 characters
  return out.length > 4000 ? out.slice(0, 3990) + "..." : out;
}
