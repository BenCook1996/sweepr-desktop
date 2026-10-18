/**
 * Search-engine and AI crawler detection by User-Agent.
 * Note: User-Agents can be spoofed. Hits are "claimed" bot visits; reverse-DNS verification is not performed.
 */
const BOT_PATTERNS: Array<[string, RegExp]> = [
  ["OAI-SearchBot", /OAI-SearchBot/i],
  ["ChatGPT-User", /ChatGPT-User/i],
  ["GPTBot", /GPTBot/i],
  ["PerplexityBot", /PerplexityBot/i],
  ["Perplexity-User", /Perplexity-User/i],
  ["ClaudeBot", /ClaudeBot/i],
  ["Claude-User", /Claude-(User|SearchBot)/i],
  ["Google-Extended", /Google-Extended/i],
  ["Googlebot", /Googlebot|Google-InspectionTool|GoogleOther/i],
  ["Bingbot", /bingbot/i],
  ["Applebot", /Applebot/i],
  ["DuckDuckBot", /DuckDuckBot|DuckAssistBot/i],
  ["YandexBot", /YandexBot/i],
  ["Baiduspider", /Baiduspider/i],
  ["Bytespider", /Bytespider/i],
  ["Meta-ExternalAgent", /meta-externalagent|facebookexternalhit/i],
  ["AhrefsBot", /AhrefsBot/i],
  ["SemrushBot", /SemrushBot/i],
  ["CCBot", /CCBot/i],
];

export const AI_BOTS = new Set([
  "OAI-SearchBot",
  "ChatGPT-User",
  "GPTBot",
  "PerplexityBot",
  "Perplexity-User",
  "ClaudeBot",
  "Claude-User",
  "Google-Extended",
  "Applebot",
  "Bytespider",
  "Meta-ExternalAgent",
  "CCBot",
]);

export function detectBot(userAgent: string | undefined | null): string | null {
  if (!userAgent) return null;
  for (const [name, re] of BOT_PATTERNS) if (re.test(userAgent)) return name;
  return null;
}

/** Only log page-like requests (no assets / API) to keep the table meaningful and small. */
export function isTrackablePath(path: string): boolean {
  if (/^\/(api|v1|crm|admin|webhooks|dev)(\/|$)/i.test(path)) return false;
  if (/\.(js|css|png|jpe?g|gif|svg|webp|ico|woff2?|map|exe|msi|apk|dmg)$/i.test(path)) return false;
  return true;
}
