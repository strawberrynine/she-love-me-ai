import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateMetrics, parseChat } from './parser.js';
import { runWorkflow } from './workflow.js';

const chat = `2026-08-01 09:00 我：早呀，今天忙吗？
2026-08-01 09:02 她：早！十点有会，你呢？
2026-08-01 12:00 她：午饭吃了吗？记得休息。
2026-08-01 12:04 我：吃啦，谢谢你。`;

test('parser extracts speakers, timestamps, and objective metrics', () => {
  const messages = parseChat(chat);
  const metrics = calculateMetrics(messages);
  assert.equal(messages.length, 4);
  assert.equal(messages[0].speaker, 'me');
  assert.equal(messages[1].speaker, 'them');
  assert.equal(messages[0].timestamp, '2026-08-01 09:00');
  assert.equal(metrics.myMessages, 2);
  assert.equal(metrics.theirMessages, 2);
});

test('workflow executes all real stages and returns structured output', async () => {
  const messages = parseChat(chat);
  const metrics = calculateMetrics(messages);
  const stages: string[] = [];
  const result = await runWorkflow(messages, metrics, (stage) => stages.push(stage));
  assert.deepEqual(stages, ['parser', 'metrics', 'knowledge', 'emotion', 'interaction', 'risk', 'relationship', 'report']);
  assert.ok(result.relationship.score >= 0 && result.relationship.score <= 100);
  assert.equal(result.relationship.dimensions.length, 4);
  assert.equal(result.knowledge.methodology.version, 'relationship-evidence-framework/1.1');
  assert.ok(result.knowledge.sternberg.triangleScore >= 0 && result.knowledge.sternberg.triangleScore <= 100);
  assert.ok(result.knowledge.sternberg.triangleConfidence >= 0 && result.knowledge.sternberg.triangleConfidence <= 100);
  assert.ok(result.report.strategistAdvice.length >= 1);
  assert.match(result.report.ancestorMessage, /祖师爷寄语/);
  assert.ok(result.knowledge.symmetry.derivation.includes('会话发起'));
  assert.equal(result.features.conversation.sessionCount, 1);
  assert.ok(result.report.disclaimer.includes('无法确定'));
});

test('JSON object exports and millisecond timestamps are normalized', () => {
  const input = JSON.stringify({ messages: [
    { sender: 'me', content: '你好', timestamp: 1785546000000 },
    { sender: 'them', content: '你好呀', timestamp: 1785546060000 },
  ] });
  const messages = parseChat(input, 'json');
  assert.equal(messages.length, 2);
  assert.equal(messages[0].speaker, 'me');
  assert.equal(messages[1].speaker, 'them');
});

test('risk dual threshold downgrades a single evidence channel to observation', async () => {
  const textOnly = `2026-08-01 09:00 我：你在吗？\n2026-08-01 09:01 她：你太敏感了\n2026-08-01 09:02 我：好吧`;
  const messages = parseChat(textOnly);
  const result = await runWorkflow(messages, calculateMetrics(messages), () => undefined);
  const signal = result.risk.signals.find((item) => item.type.includes('现实扭曲'));
  assert.equal(signal?.status, 'observation');
  assert.equal(signal?.triggerStatus.textual, 'not_met');
});

test('risk dual threshold highlights repeated quantitative and textual evidence', async () => {
  const repeated = `2026-08-01 09:00 我：我们昨天说过这件事\n2026-08-01 09:01 她：你太敏感了\n2026-08-01 09:02 我：但我记得很清楚\n2026-08-01 09:03 她：你想太多了\n2026-08-01 09:04 我：好吧`;
  const messages = parseChat(repeated);
  const result = await runWorkflow(messages, calculateMetrics(messages), () => undefined);
  const signal = result.risk.signals.find((item) => item.type.includes('现实扭曲'));
  assert.equal(signal?.status, 'warning');
  assert.equal(signal?.evidenceLevel, 'high');
});

test('screenshot workflow never falls back to unreliable OCR evidence', async () => {
  const screenshotMessages = parseChat('她：嗯 beike？ 又讨RET？\n我：哈哈\n她：今天吃饭了吗？\n我：吃过了，谢谢');
  const result = await runWorkflow(screenshotMessages, calculateMetrics(screenshotMessages), () => undefined, 'screenshot');
  assert.ok(result.report.keyEvidence.every((item) => !item.quote.includes('beike') && !item.quote.includes('RET')));
});

test('affectionate address raises relationship and chemistry scores without an explicit confession', async () => {
  const messages = parseChat('2026-08-01 09:00 我：早呀\n2026-08-01 09:01 她：宝宝早，今天也想见你\n2026-08-01 12:00 她：午饭吃了吗？晚上六点一起吃饭吧\n2026-08-01 12:03 我：好呀');
  const result = await runWorkflow(messages, calculateMetrics(messages), () => undefined);
  assert.ok(result.relationship.score >= 85);
  assert.ok((result.knowledge.sternberg.passion.score ?? 0) >= 88);
  assert.ok((result.knowledge.sternberg.intimacy.score ?? 0) >= 59);
  assert.ok((result.knowledge.sternberg.commitment.score ?? 0) >= 65);
  assert.ok(result.report.keyEvidence.some((item) => item.quote.includes('宝宝')));
  assert.match(result.report.ancestorMessage, /称呼|亲昵|亲密|心动/);
});
