import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluationDataset } from './evaluation-dataset.js';
import { calculateMetrics } from './parser.js';
import { extractFeatures } from './features.js';
import { buildKnowledge } from './knowledge.js';
import { emotionAgent, interactionAgent, relationshipAgent, riskAgent } from './agents.js';

function evaluate(item: typeof evaluationDataset[number]) {
  const metrics = calculateMetrics(item.messages);
  const features = extractFeatures(item.messages);
  const knowledge = buildKnowledge(item.messages, features, metrics.myShare);
  const emotion = emotionAgent(item.messages, features);
  const interaction = interactionAgent(item.messages, metrics, features, knowledge);
  const risk = riskAgent(item.messages, metrics, features, knowledge);
  const relationship = relationshipAgent(metrics, features, knowledge, emotion, interaction, risk, item.messages);
  return { metrics, features, relationship, risk };
}

test('evaluation dataset covers eight relationship patterns with grounded ledgers', () => {
  const results = evaluationDataset.map((item) => ({ item, result: evaluate(item) }));
  assert.equal(results.length, 8);
  for (const { item, result } of results) {
    assert.ok(result.features.relationshipSignals.signalLedger.length >= 1, `${item.id} should produce ledger entries`);
    for (const entry of result.features.relationshipSignals.signalLedger) {
      assert.ok(entry.messageId && entry.quote);
      assert.ok(entry.contextMessageIds.includes(entry.messageId));
      assert.ok(entry.strength >= 0 && entry.strength <= 100);
      assert.ok(entry.confidence >= 0 && entry.confidence <= 1);
      assert.equal(item.messages.find((message) => message.id === entry.messageId)?.text, entry.quote);
    }
    assert.ok(result.relationship.liking, `${item.id} should have an independent liking result`);
  }

  const byId = Object.fromEntries(results.map(({ item, result }) => [item.id, result]));
  assert.equal(byId.A.relationship.liking?.label, 'high');
  assert.equal(byId.E.relationship.liking?.label, 'high');
  assert.ok((byId.C.relationship.liking?.probability ?? 0) >= 60);
  for (const id of ['B', 'D', 'F', 'G', 'H']) assert.ok(['low', 'uncertain', 'mixed'].includes(byId[id].relationship.liking?.label ?? ''), `${id} must not be classified as high liking`);
  assert.equal(byId.F.relationship.relationshipStage, 'cooling_or_unsafe');
  assert.ok(byId.F.features.relationshipSignals.negativeSignals.length >= 1);
  assert.ok(byId.H.features.relationshipSignals.negativeSignals.some((signal) => signal.quote.includes('只把你当朋友') || signal.quote.includes('别再约我')));
  assert.ok(byId.D.features.relationshipSignals.signalLedger.every((entry) => entry.speaker !== 'them' || entry.strength < 82 || entry.category === 'initiative'));
});

test('regression chat recognizes time investment, care, sustained interaction, and natural affection', () => {
  const messages = [
    { id: 'r-1', speaker: 'them' as const, name: '她', timestamp: '2026-08-01 20:00', text: '刚忙完' },
    { id: 'r-2', speaker: 'me' as const, name: '我', timestamp: '2026-08-01 20:01', text: '抱抱你' },
    { id: 'r-3', speaker: 'them' as const, name: '她', timestamp: '2026-08-01 20:02', text: '通话 21:03' },
    { id: 'r-4', speaker: 'them' as const, name: '她', timestamp: '2026-08-01 20:03', text: '我接个电话' },
    { id: 'r-5', speaker: 'them' as const, name: '她', timestamp: '2026-08-01 20:04', text: '好的呀' },
    { id: 'r-6', speaker: 'them' as const, name: '她', timestamp: '2026-08-01 20:05', text: '你也不要太晚' },
    { id: 'r-7', speaker: 'them' as const, name: '她', timestamp: '2026-08-01 20:06', text: '😁😁' },
    { id: 'r-8', speaker: 'them' as const, name: '她', timestamp: '2026-08-01 20:07', text: '爱你❤️' },
    { id: 'r-9', speaker: 'me' as const, name: '我', timestamp: '2026-08-01 20:08', text: '爱妮～' },
  ];
  const metrics = calculateMetrics(messages);
  const features = extractFeatures(messages);
  const knowledge = buildKnowledge(messages, features, metrics.myShare);
  const emotion = emotionAgent(messages, features);
  const interaction = interactionAgent(messages, metrics, features, knowledge);
  const risk = riskAgent(messages, metrics, features, knowledge);
  const relationship = relationshipAgent(metrics, features, knowledge, emotion, interaction, risk, messages);
  const themEntries = features.relationshipSignals.signalLedger.filter((entry) => entry.speaker === 'them' && entry.direction === 'them_to_me');
  assert.ok(features.timeInvestment.eventCount >= 1);
  assert.ok(features.timeInvestment.durationMinutes >= 21);
  assert.ok(themEntries.some((entry) => entry.category === 'time_investment'));
  assert.ok(themEntries.some((entry) => entry.category === 'care'));
  assert.ok(themEntries.some((entry) => entry.category === 'explicit_affection' && entry.spontaneous));
  assert.ok((relationship.liking?.probability ?? 0) > 55);
  assert.ok(!features.relationshipSignals.signalLedger.some((entry) => entry.quote === '爱妮～' && entry.direction === 'them_to_me'));
});
