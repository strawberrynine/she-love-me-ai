import type { PaddleOcrService } from 'ppu-paddle-ocr/web';

export type OcrProgress = {
  imageIndex: number;
  progress: number;
  status: string;
};

export type OcrImageResult = {
  text: string;
  messageCount: number;
  confidence: number;
  error?: string;
};

export type OcrQuality = {
  usableText: string;
  usableMessages: number;
  totalMessages: number;
  reviewMessages: number;
  cjkRatio: number;
  acceptable: boolean;
};

/**
 * PaddleOCR can assign a good confidence score to a visually plausible but
 * semantically broken token. Keep this check independent from confidence so
 * mixed Chinese/Latin fragments cannot become report evidence.
 */
export function isSuspiciousOcrText(value: string): boolean {
  const text = value.trim();
  if (!text || text.includes('【请校对】') || text.includes('�')) return true;
  const cjk = text.match(/[\u3400-\u9fff]/g)?.length ?? 0;
  const latin = text.match(/[A-Za-z]/g)?.length ?? 0;
  const latinTokens = text.match(/[A-Za-z]{2,}/g) ?? [];
  if (!cjk || latin < 3) return false;
  const cjkRatio = cjk / (cjk + latin);
  const hasFragmentedTokens = latinTokens.length >= 2;
  const hasOddCasing = latinTokens.some((token) => token.length >= 3 && /[A-Z]{2,}/.test(token));
  // A single natural English word in a Chinese message is valid (for example
  // "belike 嗯？又讨厌了？"). Require a stronger multi-fragment signal.
  return (hasFragmentedTokens && hasOddCasing && cjkRatio < 0.7) || (hasFragmentedTokens && cjkRatio < 0.42);
}

type RecognizeOptions = {
  leftIsThem: boolean;
  onProgress?: (progress: OcrProgress) => void;
  onImageResult?: (imageIndex: number, result: OcrImageResult) => void;
};

type PositionedText = {
  text: string;
  confidence: number;
  x0: number;
  x1: number;
  y0: number;
  y1: number;
};

const TIMESTAMP_PATTERN = /^(?:(?:19|20)\d{2}[-年/.]\d{1,2}[-月/.]\d{1,2}日?\s*)?(?:\d{1,2}月\d{1,2}日\s*)?(?:星期[一二三四五六日天]\s*)?(?:上午|下午|晚上|凌晨)?\s*\d{1,2}:\d{2}$/;
const SYSTEM_PATTERN = /^(?:以下为新消息|消息已发出|按住说话|切换到键盘|微信|WeChat)$/i;
let paddleServicePromise: Promise<PaddleOcrService> | null = null;

function getPaddleService() {
  if (!paddleServicePromise) {
    paddleServicePromise = import('ppu-paddle-ocr/web').then(async ({ PaddleOcrService, V6_TINY_MODEL }) => {
      const service = new PaddleOcrService({
        model: V6_TINY_MODEL,
        processing: { engine: 'canvas-native' },
        detection: { maxSideLength: 'auto', minimumAreaThreshold: 25 },
        recognition: { strategy: 'per-line', minimumConfidence: 0.35, mainThreadYieldMs: 10, charactersDictionary: [] },
      });
      await service.initialize();
      return service;
    });
  }
  return paddleServicePromise;
}

function cleanText(value: string) {
  return value
    .replace(/\s*\n\s*/g, ' ')
    .replace(/([\u3400-\u9fff])\s+(?=[\u3400-\u9fff])/g, '$1')
    .replace(/\s+/g, ' ')
    .replace(/^[|丨]+|[|丨]+$/g, '')
    .trim();
}

function inferSide(item: PositionedText, imageWidth: number): 'left' | 'right' {
  if (item.x0 >= imageWidth * 0.42) return 'right';
  if (item.x1 <= imageWidth * 0.58) return 'left';
  return item.x0 <= imageWidth - item.x1 ? 'left' : 'right';
}

function paragraphsToChat(paragraphs: PositionedText[], imageWidth: number, leftIsThem: boolean) {
  const messages: Array<{ speaker: '她' | '我'; text: string; timestamp: string; x0: number; x1: number; y1: number; lineHeight: number; confidence: number }> = [];
  let pendingTimestamp = '';

  for (const paragraph of paragraphs) {
    const normalized = paragraph.text.replace(/[，,。.]$/, '').trim();
    const isCentered = Math.abs((paragraph.x0 + paragraph.x1) / 2 - imageWidth / 2) < imageWidth * 0.2;
    if (TIMESTAMP_PATTERN.test(normalized)) {
      pendingTimestamp = normalized;
      continue;
    }
    if (isCentered && /^\d{3,4}$/.test(normalized)) continue;
    if (SYSTEM_PATTERN.test(normalized) || normalized.length < 1) continue;
    if (isCentered && paragraph.x0 > imageWidth * 0.25 && paragraph.x1 < imageWidth * 0.75 && normalized.length <= 16) continue;

    const side = inferSide(paragraph, imageWidth);
    const isThem = side === 'left' ? leftIsThem : !leftIsThem;
    const speaker = isThem ? '她' : '我';
    const lineHeight = paragraph.y1 - paragraph.y0 + 1;
    const previous = messages.at(-1);
    const sameBubble = previous
      && previous.speaker === speaker
      && paragraph.y0 - previous.y1 <= Math.max(12, lineHeight * 0.55)
      && Math.min(previous.x1, paragraph.x1) - Math.max(previous.x0, paragraph.x0) > -imageWidth * 0.08;
    if (sameBubble) {
      previous.text = `${previous.text}${paragraph.text}`;
      previous.y1 = paragraph.y1;
      previous.x0 = Math.min(previous.x0, paragraph.x0);
      previous.x1 = Math.max(previous.x1, paragraph.x1);
      previous.confidence = Math.min(previous.confidence, paragraph.confidence);
    } else {
      messages.push({ speaker, text: paragraph.text, timestamp: pendingTimestamp, x0: paragraph.x0, x1: paragraph.x1, y1: paragraph.y1, lineHeight, confidence: paragraph.confidence });
    }
    pendingTimestamp = '';
  }

  return messages.map((message) => {
    const prefix = message.timestamp ? `[${message.timestamp}] ` : '';
    const letters = message.text.match(/[\p{L}\p{N}]/gu)?.length ?? 0;
    const cjk = message.text.match(/[\u3400-\u9fff]/g)?.length ?? 0;
    const lowConfidence = message.confidence < 42 && letters >= 3 && cjk / letters < 0.45;
    return `${prefix}${message.speaker}：${lowConfidence ? '【请校对】' : ''}${message.text}`;
  }).join('\n');
}

export function mergeOcrTexts(chunks: string[]) {
  const merged: string[] = [];
  for (const chunk of chunks) {
    const incoming = chunk.split('\n').map((line) => line.trim()).filter(Boolean);
    let overlap = 0;
    const maxOverlap = Math.min(merged.length, incoming.length, 12);
    for (let size = maxOverlap; size > 0; size -= 1) {
      const previous = merged.slice(-size).map(normalizeForDeduplication);
      const next = incoming.slice(0, size).map(normalizeForDeduplication);
      if (previous.every((line, index) => line === next[index])) {
        overlap = size;
        break;
      }
    }
    merged.push(...incoming.slice(overlap));
  }
  return merged.join('\n');
}

function normalizeForDeduplication(line: string) {
  return line.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
}

export function swapSpeakerLabels(text: string) {
  return text.split('\n').map((line) => line
    .replace(/(^|\]\s*)她([：:])/, '$1__ME__$2')
    .replace(/(^|\]\s*)我([：:])/, '$1她$2')
    .replace('__ME__', '我')).join('\n');
}

export function assessOcrQuality(text: string): OcrQuality {
  const lines = text.split('\n').map((line) => line.trim()).filter(Boolean);
  const usableLines = lines.filter((line) => !isSuspiciousOcrText(line));
  const speakers = new Set(usableLines.map((line) => line.match(/^(?:\[[^\]]+\]\s*)?([她我])[：:]/)?.[1]).filter(Boolean));
  const content = usableLines.map((line) => line.replace(/^(?:\[[^\]]+\]\s*)?[她我][：:]/, '')).join('');
  const letters = content.match(/[\p{L}\p{N}]/gu)?.length ?? 0;
  const cjk = content.match(/[\u3400-\u9fff]/g)?.length ?? 0;
  const cjkRatio = letters ? cjk / letters : 0;
  return {
    usableText: usableLines.join('\n'),
    usableMessages: usableLines.length,
    totalMessages: lines.length,
    reviewMessages: lines.length - usableLines.length,
    cjkRatio,
    acceptable: usableLines.length >= 2 && speakers.size === 2 && cjkRatio >= 0.35 && lines.length - usableLines.length <= Math.max(2, Math.floor(lines.length / 2)),
  };
}

export async function recognizeChatScreenshots(files: File[], options: RecognizeOptions) {
  return recognizeWithPaddle(files, options);
}

async function imageCanvas(file: File) {
  const bitmap = await createImageBitmap(file);
  const scale = bitmap.width < 2200 ? Math.min(2, 2200 / bitmap.width) : 1;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const context = canvas.getContext('2d');
  if (!context) {
    bitmap.close();
    throw new Error('浏览器无法读取图片');
  }
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas;
}

async function recognizeWithPaddle(files: File[], options: RecognizeOptions) {
  const service = await getPaddleService();
  const results: OcrImageResult[] = [];
  for (let index = 0; index < files.length; index += 1) {
    options.onProgress?.({ imageIndex: index, progress: 8, status: '准备中文识别模型' });
    try {
      const canvas = await imageCanvas(files[index]);
      options.onProgress?.({ imageIndex: index, progress: 18, status: '检测聊天文字区域' });
      const recognition = await service.recognize(canvas, { flatten: true, strategy: 'per-line' });
      options.onProgress?.({ imageIndex: index, progress: 92, status: '整理说话人和消息顺序' });
      const positioned = recognition.results
        .filter((item) => item.text.trim() && item.confidence >= 0.35)
        .map((item) => ({
          text: cleanText(item.text),
          confidence: item.confidence * 100,
          x0: item.box.x,
          x1: item.box.x + item.box.width,
          y0: item.box.y,
          y1: item.box.y + item.box.height,
        }))
        .sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);
      const text = paragraphsToChat(positioned, canvas.width, options.leftIsThem);
      const result = { text, messageCount: text ? text.split('\n').length : 0, confidence: Math.round(recognition.confidence * 100) };
      results.push(result);
      options.onProgress?.({ imageIndex: index, progress: 100, status: `读取到 ${result.messageCount} 条聊天` });
      options.onImageResult?.(index, result);
    } catch (cause) {
      const result: OcrImageResult = { text: '', messageCount: 0, confidence: 0, error: cause instanceof Error ? cause.message : 'PaddleOCR 无法读取这张图' };
      results.push(result);
      options.onImageResult?.(index, result);
    }
  }
  return { results, text: mergeOcrTexts(results.map((result) => result.text)) };
}
