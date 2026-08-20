import assert from 'node:assert/strict';
import test from 'node:test';
import { cleanScreenshotOcrText, isReliableEvidenceQuote, sanitizeChatMessages, sanitizeEvidenceAnchors } from './evidence.js';
import { parseChat } from './parser.js';

test('screenshot evidence rejects OCR markers and fragmented noise', () => {
  assert.equal(isReliableEvidenceQuote('嗯 beike？ 又讨RET？', 'screenshot'), false);
  assert.equal(isReliableEvidenceQuote('她今天问我吃饭了吗？', 'screenshot'), true);
  assert.equal(isReliableEvidenceQuote('我在开会，be right back', 'screenshot'), true);
});

test('text evidence preserves ordinary English input', () => {
  assert.equal(isReliableEvidenceQuote('嗯 beike？ 又讨RET？', 'text'), true);
});

test('evidence sanitizer removes only unreliable anchors', () => {
  const result = sanitizeEvidenceAnchors([
    { quote: '嗯 beike？ 又讨RET？', speaker: '她', interpretation: 'x', evidenceLevel: 'medium' },
    { quote: '今天工作还顺利吗？', speaker: '她', interpretation: 'y', evidenceLevel: 'high' },
  ], 'screenshot');
  assert.deepEqual(result.map((item) => item.quote), ['今天工作还顺利吗？']);
});

test('screenshot sanitizer removes the isolated WeChat OCR prefix without changing normal text', () => {
  assert.equal(cleanScreenshotOcrText('网刚到担心啦'), '刚到担心啦');
  assert.equal(cleanScreenshotOcrText('网干嘛呢'), '干嘛呢');
  assert.equal(cleanScreenshotOcrText('网络今天有点慢'), '网络今天有点慢');
  const messages = sanitizeChatMessages(parseChat('她：网亲爱的\n我：网刚到家'), 'screenshot');
  assert.deepEqual(messages.map((message) => message.text), ['亲爱的', '刚到家']);
});
