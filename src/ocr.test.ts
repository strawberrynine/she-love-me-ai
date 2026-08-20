import assert from 'node:assert/strict';
import test from 'node:test';
import { assessOcrQuality, isSuspiciousOcrText, mergeOcrTexts, swapSpeakerLabels } from './ocr.js';

test('OCR text merge removes exact overlap between adjacent screenshots', () => {
  const merged = mergeOcrTexts([
    '她：今天还好吗？\n我：刚开完会。\n她：记得吃饭。',
    '我：刚开完会。\n她：记得吃饭。\n我：谢谢你。',
  ]);
  assert.equal(merged, '她：今天还好吗？\n我：刚开完会。\n她：记得吃饭。\n我：谢谢你。');
});

test('speaker swap preserves timestamps and message text', () => {
  const swapped = swapSpeakerLabels('[下午 3:20] 她：今天还好吗？\n我：刚开完会。');
  assert.equal(swapped, '[下午 3:20] 我：今天还好吗？\n她：刚开完会。');
});

test('OCR quality gate rejects a single line of Latin-heavy noise', () => {
  const result = assessOcrQuality('她：【请校对】可四_ EE BEI TINS ER LWA');
  assert.equal(result.acceptable, false);
  assert.equal(result.usableMessages, 0);
});

test('OCR quality gate rejects messages assigned to only one speaker', () => {
  const result = assessOcrQuality('她：今天还好吗？\n她：记得吃饭。\n她：早点休息。');
  assert.equal(result.acceptable, false);
});

test('OCR quality gate keeps usable Chinese messages and removes flagged noise', () => {
  const result = assessOcrQuality('她：今天还好吗？\n我：【请校对】NFR BRE\n我：刚开完会，有点累。\n她：记得吃饭。');
  assert.equal(result.acceptable, true);
  assert.equal(result.usableMessages, 3);
  assert.doesNotMatch(result.usableText, /NFR/);
});

test('OCR quality gate keeps natural Chinese and English mixed messages', () => {
  assert.equal(isSuspiciousOcrText('belike 嗯？又讨厌了？'), false);
  assert.equal(assessOcrQuality('她：belike 嗯？又讨厌了？\n我：哈哈').acceptable, true);
});

test('OCR quality gate rejects fragmented Latin noise inside Chinese', () => {
  assert.equal(isSuspiciousOcrText('嗯 beike？ 又讨RET？'), true);
});
