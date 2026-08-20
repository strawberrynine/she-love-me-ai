import type { ChatMessage, EvidenceAnchor } from '../shared/types.js';

export type AnalysisSource = 'text' | 'file' | 'screenshot';

const screenshotPrefixArtifact = /^网(?=(?:刚|你|我|干|好|在|为什么|咋|怎么|别|没|亲|宝|姐|妹|哈|嗯|哦|喂|晚|早|吃|睡|忙|想|可以|要|不|是|那|这|都|又|有|还|行|真的|今天|明天|现在))/;

export function cleanScreenshotOcrText(value: string): string {
  return value.trim().replace(screenshotPrefixArtifact, '').trim();
}

function looksLikeOcrNoise(value: string): boolean {
  const text = value.trim();
  if (!text || text.includes('【请校对】') || text.includes('�')) return true;
  const cjk = text.match(/[\u3400-\u9fff]/g)?.length ?? 0;
  const latin = text.match(/[A-Za-z]/g)?.length ?? 0;
  if (!cjk || latin < 3) return false;
  const tokens = text.match(/[A-Za-z]{2,}/g) ?? [];
  const ratio = cjk / (cjk + latin);
  const oddCasing = tokens.some((token) => token.length >= 3 && /[A-Z]{2,}/.test(token));
  // Natural phrases such as "be right back" are valid mixed-language chat.
  // The stronger indicator here is fragmented/odd capitalization from OCR.
  return tokens.length >= 2 && oddCasing && ratio < 0.7;
}

export function isReliableEvidenceQuote(quote: string, source: AnalysisSource = 'text'): boolean {
  const normalized = quote.trim();
  if (normalized.length < 2 || normalized.includes('【请校对】') || normalized.includes('�')) return false;
  return source !== 'screenshot' || !looksLikeOcrNoise(normalized);
}

export function sanitizeEvidenceAnchors(items: EvidenceAnchor[], source: AnalysisSource = 'text'): EvidenceAnchor[] {
  return items
    .map((item) => source === 'screenshot' ? { ...item, quote: cleanScreenshotOcrText(item.quote) } : item)
    .filter((item) => isReliableEvidenceQuote(item.quote, source));
}

export function sanitizeChatMessages(messages: ChatMessage[], source: AnalysisSource = 'text'): ChatMessage[] {
  return source === 'screenshot'
    ? messages
      .map((message) => ({ ...message, text: cleanScreenshotOcrText(message.text) }))
      .filter((message) => isReliableEvidenceQuote(message.text, source))
    : messages;
}
