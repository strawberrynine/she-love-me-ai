import assert from 'node:assert/strict';
import test from 'node:test';
import { applyAffectionRules } from './affection-rules.js';
import { emotionAgent, interactionAgent, relationshipAgent, riskAgent } from './agents.js';
import { buildFengchuAnalysis, fengchuCharacterCount } from './fengchu.js';
import { extractFeatures } from './features.js';
import { buildKnowledge } from './knowledge.js';
import { calculateMetrics, parseChat } from './parser.js';
import { runWorkflow } from './workflow.js';

function analyze(text: string) {
  const messages = parseChat(text);
  const metrics = calculateMetrics(messages);
  const features = extractFeatures(messages);
  const knowledge = buildKnowledge(messages, features, metrics.myShare);
  const emotion = emotionAgent(messages, features);
  const interaction = interactionAgent(messages, metrics, features, knowledge);
  const risk = riskAgent(messages, metrics, features, knowledge);
  const relationship = applyAffectionRules(relationshipAgent(metrics, features, knowledge, emotion, interaction, risk), messages);
  return { messages, result: buildFengchuAnalysis({ messages, features, knowledge, emotion, interaction, risk, relationship }) };
}

test('Fengchu analysis uses direct affection as grounded high-weight evidence', () => {
  const { messages, result } = analyze(`2026-08-01 09:00 我：今天有点累
2026-08-01 09:02 她：宝宝，我陪你，爱你
2026-08-01 12:00 她：周末一起吃饭吗？
2026-08-01 12:04 我：好呀`);
  assert.match(result.coreJudgment, /高权重|靠近/);
  assert.ok(result.keyEvidence.some((item) => item.quote === '宝宝，我陪你，爱你' && item.speaker === 'them'));
  assert.ok(result.keyEvidence.every((item) => messages.some((message) => message.id === item.messageId && message.text === item.quote && message.speaker === item.speaker && (message.timestamp ?? '') === item.timestamp)));
  assert.ok(fengchuCharacterCount(result) <= 500);
});

test('the user saying I love you is not treated as evidence of the other person liking them', () => {
  const { result } = analyze(`2026-08-01 09:00 我：我爱你
2026-08-01 09:02 她：谢谢
2026-08-01 09:04 我：周末见吗？`);
  const userQuote = result.keyEvidence.find((item) => item.quote === '我爱你');
  assert.ok(!userQuote || /你的投入/.test(userQuote.hiddenSignal));
  assert.doesNotMatch(result.coreJudgment, /高权重靠近信号/);
});

test('explicit rejection is treated as counter-evidence instead of being sugar-coated', () => {
  const { result } = analyze(`2026-08-01 09:00 我：周末一起看电影吗？
2026-08-01 09:02 她：别误会，我不喜欢你，只想做朋友
2026-08-01 09:04 我：明白了`);
  assert.match(result.coreJudgment, /拒绝|边界|降温/);
  assert.ok(result.keyEvidence.some((item) => item.quote.includes('不喜欢你') && item.hiddenSignal.includes('边界')));
  assert.match(result.highlight, /^凤雏Highlight：/);
});

test('workflow always returns Fengchu analysis when OpenAI is unavailable', async () => {
  const previous = process.env.OPENAI_ENABLED;
  process.env.OPENAI_ENABLED = 'false';
  try {
    const messages = parseChat('我：今天累了\n她：辛苦了，我陪你聊聊\n她：周末一起吃饭吗？');
    const report = await runWorkflow(messages, calculateMetrics(messages), () => undefined);
    assert.ok(report.fengchu.coreJudgment.length > 0);
    assert.ok(report.fengchu.extraordinaryAdvice.length >= 1);
    assert.ok(fengchuCharacterCount(report.fengchu) <= 500);
  } finally {
    if (previous == null) delete process.env.OPENAI_ENABLED;
    else process.env.OPENAI_ENABLED = previous;
  }
});
