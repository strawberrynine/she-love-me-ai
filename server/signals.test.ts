import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateMetrics, parseChat } from './parser.js';
import { runWorkflow } from './workflow.js';

test('the other person saying 爱你 raises intimacy and keeps grounded evidence', async () => {
  const messages = parseChat('2026-08-01 09:00 我：今天有点累\n2026-08-01 09:02 她：我陪你，爱你\n2026-08-01 09:04 她：周末一起吃饭吗？');
  const result = await runWorkflow(messages, calculateMetrics(messages), () => undefined);
  assert.ok((result.features.relationshipSignals.languageIntimacy ?? 0) > 0);
  assert.ok((result.knowledge.sternberg.intimacy.score ?? 0) > 0);
  assert.ok((result.relationship.signalScores?.languageIntimacy ?? 0) > 0);
  assert.ok(result.report.keyEvidence.some((item) => item.quote.includes('爱你') && item.speaker === '她'));
  assert.ok(result.report.keyEvidence.every((item) => messages.some((message) => message.text === item.quote)));
});

test('the users own 爱你 is recorded as user investment, not the other persons liking signal', async () => {
  const messages = parseChat('2026-08-01 09:00 我：我爱你\n2026-08-01 09:02 她：谢谢你，早点休息');
  const result = await runWorkflow(messages, calculateMetrics(messages), () => undefined);
  assert.equal(result.features.relationshipSignals.languageIntimacy, 0);
  assert.equal(result.features.relationshipSignals.counts.s, 0);
  assert.ok((result.knowledge.sternberg.intimacy.score ?? 0) > 0, 'ordinary care can still produce intimacy; the users love declaration must not do so');
  assert.ok(!result.report.keyEvidence.some((item) => item.quote === '我爱你' && item.direction === 'them_to_me'));
});

test('contextual or joking 爱你 does not become an S-level partner signal', async () => {
  const messages = parseChat('2026-08-01 09:00 我：你好吗\n2026-08-01 09:02 她：妈妈爱你\n2026-08-01 09:03 她：哈哈哈爱你个头');
  const result = await runWorkflow(messages, calculateMetrics(messages), () => undefined);
  assert.equal(result.features.relationshipSignals.counts.s, 0);
  assert.ok((result.features.relationshipSignals.languageIntimacy ?? 0) < 70);
});

test('an explicit rejection remains negative evidence instead of matching 爱你 as a substring', async () => {
  const messages = parseChat('2026-08-01 09:00 我：我喜欢你\n2026-08-01 09:02 她：我不喜欢你，只是朋友');
  const result = await runWorkflow(messages, calculateMetrics(messages), () => undefined);
  assert.equal(result.features.relationshipSignals.counts.s, 0);
  assert.ok(result.features.relationshipSignals.negativeSignals.some((item) => item.quote.includes('不喜欢你')));
});

test('an active meeting proposal is a relationship-progress signal', async () => {
  const messages = parseChat('2026-08-01 09:00 我：最近工作好累\n2026-08-01 09:02 她：周末一起吃饭吗？我想见你');
  const result = await runWorkflow(messages, calculateMetrics(messages), () => undefined);
  assert.ok(result.features.relationshipSignals.relationshipProgress >= 70);
  assert.ok(result.knowledge.sternberg.commitment.score !== undefined);
});

test('real-time contact is scored as time investment and contextualizes later affection', async () => {
  const messages = parseChat(`2026-08-01 20:00 我：今晚聊得很开心
2026-08-01 20:01 她：通话 21:03
2026-08-01 20:02 她：通话 53:01
2026-08-01 20:03 她：爱你❤️`);
  const result = await runWorkflow(messages, calculateMetrics(messages), () => undefined);
  assert.equal(result.features.timeInvestment.eventCount, 2);
  assert.equal(result.features.timeInvestment.longEventCount, 2);
  assert.ok(result.features.timeInvestment.durationMinutes >= 74);
  assert.ok(result.features.relationshipSignals.timeInvestment >= 50);
  assert.ok(result.features.relationshipSignals.positiveSignals.some((item) => item.signalType === '实时陪伴 / 时间投入'));
  assert.ok(result.features.relationshipSignals.positiveSignals.some((item) => item.signalType === '互动后自然表达爱意'));
  assert.ok(result.report.keyEvidence.some((item) => item.quote === '通话 21:03'));
});
