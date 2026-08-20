import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateMetrics, parseChat } from './parser.js';
import { extractFeatures } from './features.js';
import { selectStrategistAdvice } from './strategist-advice.js';

function context(chat: string, score = 60) {
  const messages = parseChat(chat);
  const features = extractFeatures(messages);
  return {
    messages,
    features,
    relationship: { score, confidence: 65, label: '', summary: '', dimensions: [] },
    interaction: { score: 60, initiation: 60, reciprocity: 60, continuity: 60, responsiveness: 60, patterns: [], evidence: [] },
    risk: { level: 'low' as const, score: 0, signals: [] },
    metrics: calculateMetrics(messages),
  };
}

test('strategist library recommends a concrete next step for affectionate address', () => {
  const input = context('我：早呀\n她：宝宝早，今晚想见你\n我：好呀', 88);
  const advice = selectStrategistAdvice(input);
  assert.equal(advice.length, 2);
  assert.match(advice.join(''), /称呼|亲昵|邀约|相处机会/);
  assert.match(advice.join(''), /行动|见面|时间|安排/);
});

test('strategist library prioritizes boundaries when risk is high', () => {
  const input = context('我：可以好好说吗\n她：闭嘴，必须听我的\n我：好吧');
  const advice = selectStrategistAdvice({ ...input, risk: { level: 'high', score: 35, signals: [] } });
  assert.match(advice.join(''), /边界|尊重|安全感|拉开距离/);
});

