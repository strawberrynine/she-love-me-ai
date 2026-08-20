import { ChatMessage, BasicMetrics, Speaker } from '../shared/types.js';
import { parse as parseCsv } from 'csv-parse/sync';

const ME_NAMES = new Set(['我', 'me', '我方', '自己', 'you']);
const THEM_NAMES = new Set(['她', '对方', 'them', 'her', '女友', '女生']);

function speakerFor(name: string, index: number): Speaker {
  const normalized = name.trim().toLowerCase();
  if (ME_NAMES.has(normalized)) return 'me';
  if (THEM_NAMES.has(normalized)) return 'them';
  return index % 2 === 0 ? 'me' : 'them';
}

function messageFromRecord(item: Record<string, unknown>, index: number): ChatMessage {
  const rawSpeaker = String(item.speaker ?? item.sender ?? item.name ?? (index % 2 === 0 ? '我' : '她'));
  const normalizedSpeaker = rawSpeaker === 'me' || rawSpeaker === 'them' ? rawSpeaker : speakerFor(rawSpeaker, index);
  const name = String(item.name ?? (normalizedSpeaker === 'me' ? '我' : normalizedSpeaker === 'them' ? '她' : rawSpeaker));
  const text = String(item.text ?? item.message ?? item.content ?? item.transcript ?? item.voice_transcript ?? '');
  const rawTimestamp = item.timestamp ?? item.time ?? item.createTime ?? item.create_time ?? item.sendTime;
  return { id: `m-${index}`, speaker: normalizedSpeaker, name, text, timestamp: rawTimestamp == null ? undefined : String(rawTimestamp) };
}

export function parseChat(input: string, format?: string): ChatMessage[] {
  const cleaned = input.replace(/\r/g, '').trim();
  if (!cleaned) return [];
  if (format === 'csv') {
    try {
      const rows = parseCsv(cleaned, { columns: true, skip_empty_lines: true, trim: true }) as Array<Record<string, string>>;
      const csvMessages = rows.map((item, index) => {
        const name = item.speaker ?? item.name ?? item.sender ?? (index % 2 === 0 ? '我' : '她');
        return { id: `m-${index}`, speaker: speakerFor(name, index), name, text: item.text ?? item.message ?? item.content ?? '', timestamp: item.timestamp ?? item.time };
      }).filter((item) => item.text.trim());
      if (csvMessages.length) return csvMessages;
    } catch { /* fall through to the text parser */ }
  }
  if (format === 'json' || cleaned.startsWith('[') || cleaned.startsWith('{')) {
    try {
      const payload = JSON.parse(cleaned) as Array<Record<string, unknown>> | { messages?: Array<Record<string, unknown>> };
      const data = Array.isArray(payload) ? payload : payload.messages;
      if (Array.isArray(data)) return data.map(messageFromRecord).filter((item) => item.text.trim());
    } catch { /* fall through to line parser */ }
  }
  const lines = cleaned.split('\n').map((line) => line.trim()).filter(Boolean);
  return lines.map((line, index) => {
    const match = line.match(/^(?:\[([^\]]+)\]\s*|((?:19|20)\d{2}[-/]\d{1,2}[-/]\d{1,2}(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?)\s+)?([^:：]{1,20})\s*[:：]\s*(.+)$/);
    const name = match?.[3]?.trim() || (index % 2 === 0 ? '我' : '她');
    const text = match?.[4]?.trim() || line;
    const timestamp = match?.[1] ?? match?.[2];
    return { id: `m-${index}`, speaker: speakerFor(name, index), name, text, timestamp };
  });
}

export function calculateMetrics(messages: ChatMessage[]): BasicMetrics {
  const mine = messages.filter((message) => message.speaker === 'me');
  const theirs = messages.filter((message) => message.speaker === 'them');
  const questionCount = messages.filter((message) => /[?？]|吗$|呢$|什么|怎么/.test(message.text)).length;
  const pairs = messages.slice(1).filter((message, index) => message.speaker !== messages[index].speaker).length;
  const emojiCount = messages.filter((message) => /(?:[\u{1F300}-\u{1FAFF}]|❤|💕|💬)/u.test(message.text)).length;
  return {
    messageCount: messages.length,
    myMessages: mine.length,
    theirMessages: theirs.length,
    myShare: messages.length ? Math.round((mine.length / messages.length) * 100) : 0,
    avgMyLength: mine.length ? Math.round(mine.reduce((sum, item) => sum + item.text.length, 0) / mine.length) : 0,
    avgTheirLength: theirs.length ? Math.round(theirs.reduce((sum, item) => sum + item.text.length, 0) / theirs.length) : 0,
    questionRate: messages.length ? Math.round((questionCount / messages.length) * 100) : 0,
    responsePairs: Math.floor(pairs / 2),
    responseRate: messages.length > 1 ? Math.min(100, Math.round((pairs / (messages.length - 1)) * 100)) : 0,
    emojiRate: messages.length ? Math.round((emojiCount / messages.length) * 100) : 0,
  };
}
