import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateMetrics, parseChat } from './parser.js';
import { extractFeatures } from './features.js';
import { buildKnowledge } from './knowledge.js';
import { analyzeWithSol, buildChronologicalContext, groundSolAnalysis, solAnalysisSchema } from './openai.js';

const romanticChat = `2026-08-01 09:00 我：早呀
2026-08-01 09:02 她：早！今天也想见你
2026-08-01 12:00 她：午饭吃了吗？晚上一起吃饭吧
2026-08-01 12:04 我：好呀
2026-08-01 12:05 她：那六点半见，我来订位置`;

function mockAnalysis() {
  return solAnalysisSchema.parse({
    liking: null,
    conclusion: { category: 'high_probability_romantic_interest', probability: 84, summary: '多个独立信号指向较高情感兴趣', rationale: '对方主动表达想见面、关心并落实具体安排。' },
    confidence: 82,
    supportingEvidence: [{ messageId: 'm-1', quote: '早！今天也想见你', speaker: 'them', timestamp: '2026-08-01 09:02', interpretation: '主动表达见面意愿。' }],
    counterEvidence: [],
    relationshipSignals: Object.fromEntries(['initiative', 'emotionalResponse', 'flirtation', 'topicContinuity', 'selfDisclosure', 'meetingIntent', 'investment', 'timeTrend'].map((key) => [key, { score: 75, finding: `${key} 信号积极`, evidenceMessageIds: ['m-1'] }])),
    emotionalTrajectory: { score: 76, trend: 'rising', phases: [{ label: '整体', score: 76, finding: '互动升温' }] },
    communicationPatterns: ['对方会主动推进见面安排'], risks: [], recommendations: ['确认一次具体邀约并观察后续兑现。'],
    fengchu: {
      coreJudgment: '关系已明显超过普通礼貌，但仍要看行动能否持续。',
      deepInterpretation: '表层是主动见面；可能是认真靠近、亲密友谊或临时热情，目前第一种解释更可能。',
      keyEvidence: [{ messageId: 'm-1', quote: '早！今天也想见你', speaker: 'them', timestamp: '2026-08-01 09:02', surfaceBehavior: '主动表达想见面', hiddenSignal: '拉近现实距离', whyItMatters: '主动且带有明确对象' }],
      insights: ['对方不是被动答应，而是主动提出靠近。'],
      extraordinaryAdvice: ['确认一次具体见面，观察她是否主动落实时间与后续安排。'],
      highlight: '凤雏Highlight：想见是温度，落实才是关系的重量。',
    },
  });
}

test('chronological context keeps the full ordered transcript when it fits', () => {
  const messages = parseChat(romanticChat);
  const context = buildChronologicalContext(messages);
  assert.equal(context.mode, 'full');
  assert.equal(context.includedMessageCount, messages.length);
  assert.ok(context.transcript.indexOf('[m-0]') < context.transcript.indexOf('[m-4]'));
});

test('long context samples every chronological segment instead of truncating the tail', () => {
  const messages = Array.from({ length: 200 }, (_, index) => ({ id: `m-${index}`, speaker: index % 2 ? 'them' as const : 'me' as const, name: index % 2 ? '她' : '我', text: `第 ${index} 条消息 ${'内容'.repeat(20)}`, timestamp: `2026-08-${String((index % 28) + 1).padStart(2, '0')}` }));
  const context = buildChronologicalContext(messages, 4_000);
  assert.equal(context.mode, 'balanced');
  assert.match(context.transcript, /时间段 1\//);
  assert.match(context.transcript, /时间段 4\//);
  assert.match(context.transcript, /\[m-199\]/);
});

test('evidence grounding rejects fabricated quotes', () => {
  const messages = parseChat(romanticChat);
  const analysis = mockAnalysis();
  analysis.supportingEvidence[0].quote = '模型编造的原话';
  assert.equal(groundSolAnalysis(analysis, messages), null);
});

test('invalid Fengchu evidence is discarded without losing the grounded Sol analysis', () => {
  const messages = parseChat(romanticChat);
  const analysis = mockAnalysis();
  analysis.fengchu!.keyEvidence[0].quote = '不存在的凤雏证据';
  const grounded = groundSolAnalysis(analysis, messages);
  assert.ok(grounded);
  assert.equal(grounded.fengchu, undefined);
});

test('Responses API request uses Sol, high reasoning, full context and structured output', async () => {
  const messages = parseChat(romanticChat);
  const metrics = calculateMetrics(messages);
  const features = extractFeatures(messages);
  const knowledge = buildKnowledge(messages, features, metrics.myShare);
  let request: Record<string, unknown> | undefined;
  const client = { responses: { parse: async (input: Record<string, unknown>) => { request = input; return { output_parsed: mockAnalysis(), model: 'gpt-5.6-sol' }; } } };
  const result = await analyzeWithSol(messages, metrics, features, knowledge, { client: client as never, apiKey: 'test-key', model: 'gpt-5.6-sol', reasoningEffort: 'high' });
  assert.equal(result.ok, true);
  assert.equal(request?.model, 'gpt-5.6-sol');
  assert.deepEqual(request?.reasoning, { effort: 'high' });
  assert.equal(request?.store, false);
  assert.equal((request?.text as { format?: unknown }).format != null, true);
  const requestInput = request?.input as Array<{ role: string; content: string }>;
  assert.match(requestInput[0].content, /时间投入/);
  assert.match(requestInput[0].content, /短期.*长期|长期.*稳定/);
  assert.match(requestInput[1].content, /timeInvestment/);
  assert.equal(result.ok && result.analysis.conclusion.category, 'high_probability_romantic_interest');
  assert.notEqual(result.ok && result.analysis.conclusion.category, 'uncertain_mixed');
});
