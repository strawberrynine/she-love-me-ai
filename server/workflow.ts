import { z } from 'zod';
import { zodTextFormat } from 'openai/helpers/zod';
import { AnalysisReport, BasicMetrics, ChatMessage, EmotionResult, FengchuAnalysis, InteractionResult, KnowledgeResult, RelationshipResult, ReportResult, RiskResult } from '../shared/types.js';
import { emotionAgent, interactionAgent, relationshipAgent, reportAgent, riskAgent } from './agents.js';
import { extractFeatures } from './features.js';
import { buildKnowledge } from './knowledge.js';
import { sanitizeEvidenceAnchors, type AnalysisSource } from './evidence.js';
import { analyzeWithSol } from './openai.js';
import { adaptSolAnalysis } from './sol-adapter.js';
import { applyAffectionRules, detectAffectionRules } from './affection-rules.js';
import { selectAncestorMessage } from './ancestor-messages.js';
import { selectStrategistAdvice } from './strategist-advice.js';
import { buildFengchuAnalysis, groundFengchuAnalysis } from './fengchu.js';

const evidenceLevelSchema = z.enum(['high', 'medium', 'low', 'insufficient']);
const evidenceSchema = z.object({ quote: z.string(), speaker: z.string(), timestamp: z.string(), interpretation: z.string(), evidenceLevel: evidenceLevelSchema, signalType: z.string(), signalGrade: z.enum(['S', 'A', 'B', 'C', 'negative']), direction: z.enum(['them_to_me', 'me_to_them', 'unknown']) });
const emotionSchema = z.object({ overall: z.enum(['positive', 'mixed', 'neutral', 'negative']), score: z.number().min(0).max(100), trend: z.enum(['rising', 'stable', 'falling', 'volatile']), moments: z.array(z.object({ label: z.string(), value: z.number().min(0).max(100), note: z.string() })).min(1), evidence: z.array(z.string()) });
const interactionSchema = z.object({ score: z.number().min(0).max(100), initiation: z.number().min(0).max(100), reciprocity: z.number().min(0).max(100), continuity: z.number().min(0).max(100), responsiveness: z.number().min(0).max(100), patterns: z.array(z.string()), evidence: z.array(z.string()) });
const relationshipSchema = z.object({ score: z.number().min(0).max(100), confidence: z.number().min(0).max(100), label: z.string(), summary: z.string(), dimensions: z.array(z.object({ key: z.string(), label: z.string(), score: z.number().min(0).max(100), description: z.string() })).min(4), signalScores: z.object({ languageIntimacy: z.number().min(0).max(100), behaviorIntimacy: z.number().min(0).max(100), initiative: z.number().min(0).max(100), topicContinuity: z.number().min(0).max(100), relationshipProgress: z.number().min(0).max(100), supportiveResponse: z.number().min(0).max(100), recent7: z.number().min(0).max(100), recent30: z.number().min(0).max(100), allHistory: z.number().min(0).max(100) }) });
const reportSchema = z.object({ headline: z.string(), summary: z.string(), keyEvidence: z.array(evidenceSchema), counterEvidence: z.array(evidenceSchema), advice: z.array(z.string()).min(1), nextStep: z.string(), limitations: z.array(z.string()), disclaimer: z.string(), strategistAdvice: z.array(z.string()).min(1), ancestorMessage: z.string().min(1) });
const fengchuSchema = z.object({
  coreJudgment: z.string(), deepInterpretation: z.string(),
  keyEvidence: z.array(z.object({ messageId: z.string(), quote: z.string(), speaker: z.enum(['me', 'them', 'unknown']), timestamp: z.string(), surfaceBehavior: z.string(), hiddenSignal: z.string(), whyItMatters: z.string() })).min(1).max(5),
  insights: z.array(z.string()).min(1).max(3), extraordinaryAdvice: z.array(z.string()).min(1).max(3), highlight: z.string(),
});

type LocalLlmTrace = { attempts: number; successes: number };

async function localStructuredCall<T>(agent: string, task: string, context: unknown, schema: z.ZodType<T>, fallback: () => T, trace?: LocalLlmTrace): Promise<T> {
  if (process.env.OLLAMA_ENABLED !== 'true') return fallback();
  const baseUrl = new URL(process.env.OLLAMA_BASE_URL ?? 'http://127.0.0.1:11434');
  if (!['127.0.0.1', 'localhost', '::1'].includes(baseUrl.hostname)) return fallback();
  if (trace) trace.attempts += 1;
  try {
    const outputFormat = zodTextFormat(schema, 'agent_output').schema;
    const response = await fetch(new URL('/api/chat', baseUrl), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: process.env.OLLAMA_MODEL ?? 'qwen3:1.7b',
        stream: false,
        think: false,
        format: outputFormat,
        keep_alive: '10m',
        options: { temperature: 0.15, num_predict: 1600 },
        messages: [
          { role: 'system', content: `你是 ${agent}。${task}\n约束：严格遵守请求附带的 JSON Schema，只输出 JSON；不得心理诊断或断言真实想法；只可引用 context.evidence 中逐字存在的原话；证据不足必须留白或降低置信度；所有评分为 0-100。` },
          { role: 'user', content: JSON.stringify(context) },
        ],
      }),
    });
    if (!response.ok) throw new Error(`Ollama returned ${response.status}`);
    const data = await response.json() as { message?: { content?: string } };
    const parsed = schema.parse(JSON.parse(data.message?.content ?? '{}'));
    if (trace) trace.successes += 1;
    return parsed;
  } catch (error) {
    console.warn(`${agent} used its deterministic fallback:`, error);
    return fallback();
  }
}

function compactKnowledge(knowledge: KnowledgeResult) {
  return {
    principles: knowledge.methodology.principles,
    symmetry: knowledge.symmetry,
    sternberg: knowledge.sternberg,
    gottman: knowledge.gottman,
    relationshipStage: knowledge.relationshipStage,
    communicationCycle: knowledge.communicationCycle,
    emotionalAvailability: knowledge.emotionalAvailability,
    relationshipSignals: knowledge.relationshipSignals,
  };
}

function keepGroundedQuotes(quotes: string[], messages: ChatMessage[], fallback: string[]): string[] {
  const grounded = quotes.filter((quote) => messages.some((message) => message.text === quote));
  return grounded.length ? grounded : fallback;
}

export async function runWorkflow(messages: ChatMessage[], metrics: BasicMetrics, onStage: (step: string) => void, source: AnalysisSource = 'text'): Promise<AnalysisReport> {
  const emitStage = async (step: string) => { onStage(step); await new Promise((resolve) => setTimeout(resolve, 90)); };
  await emitStage('parser');

  const features = extractFeatures(messages);
  await emitStage('metrics');

  const knowledge = buildKnowledge(messages, features, metrics.myShare);
  await emitStage('knowledge');

  const messageById = new Map(messages.map((message) => [message.id, message]));
  const ledgerContextMessages = features.relationshipSignals.signalLedger
    .flatMap((entry) => entry.contextMessageIds.map((id) => messageById.get(id)))
    .filter((message): message is ChatMessage => Boolean(message));
  const evidence = [...new Map([...ledgerContextMessages, ...Object.values(features.evidenceWindows).flat(), ...features.timeInvestment.evidence]
    .map((message) => [message.id, { id: message.id, name: message.name, speaker: message.speaker, text: message.text, timestamp: message.timestamp ?? '' }])).values()].slice(0, 320);
  const context = { metrics, features: { ...features, evidenceWindows: undefined }, knowledge: compactKnowledge(knowledge), evidence };
  const timeInvestmentEvidence = features.timeInvestment.evidence.map((message) => ({
    quote: message.text,
    speaker: message.name,
    timestamp: message.timestamp,
    interpretation: '实时通话或语音陪伴属于有时间成本的关系投入，需结合主动性、持续性和后续行动判断。',
    evidenceLevel: features.timeInvestment.durationMinutes >= 20 ? 'high' as const : 'medium' as const,
    signalType: '实时陪伴 / 时间投入',
    signalGrade: 'A' as const,
    direction: message.speaker === 'them' ? 'them_to_me' as const : 'unknown' as const,
  }));

  const deterministicEmotion = emotionAgent(messages, features);
  const deterministicInteraction = interactionAgent(messages, metrics, features, knowledge);
  const deterministicRisk = riskAgent(messages, metrics, features, knowledge);
  const deterministicRelationship = applyAffectionRules(relationshipAgent(metrics, features, knowledge, deterministicEmotion, deterministicInteraction, deterministicRisk, messages), messages);
  const deterministicReport = reportAgent(messages, features, knowledge, deterministicRelationship, deterministicEmotion, deterministicInteraction, deterministicRisk, source);
  const deterministicFengchu = buildFengchuAnalysis({ messages, features, knowledge, emotion: deterministicEmotion, interaction: deterministicInteraction, risk: deterministicRisk, relationship: deterministicRelationship });
  const sol = await analyzeWithSol(messages, metrics, features, knowledge);

  if (sol.ok) {
    const adapted = adaptSolAnalysis(sol.analysis, messages, { emotion: deterministicEmotion, interaction: deterministicInteraction, risk: deterministicRisk, relationship: deterministicRelationship, report: deterministicReport, fengchu: deterministicFengchu });
    adapted.relationship = applyAffectionRules(adapted.relationship, messages);
    const affectionEvidence = [...features.relationshipSignals.positiveSignals, ...detectAffectionRules(messages).strongMatches.map((message) => ({ quote: message.text, speaker: message.name, timestamp: message.timestamp, interpretation: '对方使用了亲密称呼，是本产品的高权重关系信号。', evidenceLevel: 'high' as const, signalType: '亲密称呼', signalGrade: 'S' as const, direction: 'them_to_me' as const })), ...detectAffectionRules(messages).ambiguousMatches.map((message) => ({ quote: message.text, speaker: message.name, timestamp: message.timestamp, interpretation: '对方使用了暧昧角色称呼，是本产品的强暧昧信号。', evidenceLevel: 'high' as const, signalType: '暧昧角色称呼', signalGrade: 'A' as const, direction: 'them_to_me' as const }))]
      .filter((item) => item.direction === 'them_to_me' || messages.some((message) => message.text === item.quote && message.speaker === 'them'))
      .slice(0, 10);
    adapted.report.keyEvidence = [...new Map([...adapted.report.keyEvidence, ...timeInvestmentEvidence, ...affectionEvidence].map((item) => [`${item.timestamp}-${item.quote}`, item])).values()].slice(0, 6);
    adapted.report.counterEvidence = [...new Map([...adapted.report.counterEvidence, ...features.relationshipSignals.negativeSignals].map((item) => [`${item.timestamp}-${item.quote}`, item])).values()].slice(0, 6);
    adapted.report.strategistAdvice = selectStrategistAdvice({ messages, relationship: adapted.relationship, interaction: adapted.interaction, risk: adapted.risk, features });
    adapted.report.ancestorMessage = selectAncestorMessage({ messages, relationship: adapted.relationship, risk: adapted.risk });
    await emitStage('emotion'); await emitStage('interaction'); await emitStage('risk'); await emitStage('relationship'); await emitStage('report');
    return {
      id: `analysis-${Date.now()}`, createdAt: new Date().toISOString(), metrics, features, knowledge,
      ...adapted, deepAnalysis: sol.analysis,
      engine: { provider: 'openai', model: sol.model, reasoningEffort: sol.reasoningEffort, usedFallback: false, contextMode: sol.context.mode, sourceMessageCount: sol.context.sourceMessageCount, includedMessageCount: sol.context.includedMessageCount },
    };
  }

  const localTrace: LocalLlmTrace = { attempts: 0, successes: 0 };
  const fallbackEmotion = deterministicEmotion;
  const emotion = await localStructuredCall<EmotionResult>('Emotion Agent', '综合全量情绪词统计、近期趋势和证据窗口，分析情绪氛围及变化。趋势结论必须服从时间序列，不能凭单句决定。', context, emotionSchema, () => fallbackEmotion, localTrace);
  emotion.evidence = keepGroundedQuotes(emotion.evidence, messages, fallbackEmotion.evidence);
  await emitStage('emotion');

  const fallbackInteraction = deterministicInteraction;
  const interaction = await localStructuredCall<InteractionResult>('Interaction Agent', '基于会话发起、有效回复样本、追发、修复重启、对称性与沟通循环评估互动。客观字段不可被语义直觉覆盖。', { ...context, emotion }, interactionSchema, () => fallbackInteraction, localTrace);
  interaction.score = fallbackInteraction.score;
  interaction.initiation = fallbackInteraction.initiation;
  interaction.reciprocity = fallbackInteraction.reciprocity;
  interaction.continuity = fallbackInteraction.continuity;
  interaction.responsiveness = fallbackInteraction.responsiveness;
  interaction.evidence = keepGroundedQuotes(interaction.evidence, messages, fallbackInteraction.evidence);
  await emitStage('interaction');

  // Risk classification stays deterministic: an LLM may explain evidence, but cannot bypass dual thresholds.
  const risk: RiskResult = deterministicRisk;
  await emitStage('risk');

  const fallbackRelationship = applyAffectionRules(relationshipAgent(metrics, features, knowledge, emotion, interaction, risk, messages), messages);
  const relationship = await localStructuredCall<RelationshipResult>('Relationship Agent', '综合工具指标、专业知识层、Emotion/Interaction 和程序裁决的 Risk。分数代表可观察信号，不代表爱意概率。', { ...context, emotion, interaction, risk }, relationshipSchema, () => fallbackRelationship, localTrace);
  relationship.score = fallbackRelationship.score;
  relationship.confidence = fallbackRelationship.confidence;
  relationship.dimensions = fallbackRelationship.dimensions;
  relationship.signalScores = fallbackRelationship.signalScores;
  relationship.liking = fallbackRelationship.liking;
  relationship.advancedDimensions = fallbackRelationship.advancedDimensions;
  relationship.relationshipStage = fallbackRelationship.relationshipStage;
  await emitStage('relationship');

  const fallbackReport = reportAgent(messages, features, knowledge, relationship, emotion, interaction, risk, source);
  const finalReport = await localStructuredCall<ReportResult>('Report Agent', '先描述行为画面，再解释框架；建议必须具体、尊重边界、不玩操控策略；保留限制和免责声明。', { ...context, emotion, interaction, risk, relationship }, reportSchema, () => fallbackReport, localTrace);
  finalReport.keyEvidence = sanitizeEvidenceAnchors(finalReport.keyEvidence.filter((item) => messages.some((message) => message.text === item.quote)), source);
  if (!finalReport.keyEvidence.length) finalReport.keyEvidence = sanitizeEvidenceAnchors(fallbackReport.keyEvidence, source);
  const affectionEvidence = [...features.relationshipSignals.positiveSignals, ...detectAffectionRules(messages).strongMatches.map((message) => ({ quote: message.text, speaker: message.name, timestamp: message.timestamp, interpretation: '对方使用了亲密称呼，是本产品的高权重关系信号。', evidenceLevel: 'high' as const, signalType: '亲密称呼', signalGrade: 'S' as const, direction: 'them_to_me' as const })), ...detectAffectionRules(messages).ambiguousMatches.map((message) => ({ quote: message.text, speaker: message.name, timestamp: message.timestamp, interpretation: '对方使用了暧昧角色称呼，是本产品的强暧昧信号。', evidenceLevel: 'high' as const, signalType: '暧昧角色称呼', signalGrade: 'A' as const, direction: 'them_to_me' as const }))]
    .filter((item) => item.direction === 'them_to_me' || messages.some((message) => message.text === item.quote && message.speaker === 'them'))
    .slice(0, 10);
  finalReport.keyEvidence = sanitizeEvidenceAnchors([...new Map([...finalReport.keyEvidence, ...timeInvestmentEvidence, ...affectionEvidence].map((item) => [`${item.timestamp}-${item.quote}`, item])).values()].slice(0, 6), source);
  finalReport.disclaimer = fallbackReport.disclaimer;
  finalReport.strategistAdvice = selectStrategistAdvice({ messages, relationship, interaction, risk, features });
  finalReport.ancestorMessage = selectAncestorMessage({ messages, relationship, risk });
  const fengchuSuccessesBefore = localTrace.successes;
  const groundedFengchu = groundFengchuAnalysis(await localStructuredCall<FengchuAnalysis>('凤雏分析', '对完整聊天上下文进行潜台词和情绪动态二次推理。必须输出六段凤雏结构，严格引用 context.evidence 中存在的原话，区分强/中强/弱/反向证据，给出歧义解释、隐藏洞察和可验证的非凡建议，总长度不超过 500 字。', { ...context, emotion, interaction, risk, relationship, report: finalReport }, fengchuSchema, () => deterministicFengchu, localTrace), messages);
  if (!groundedFengchu && localTrace.successes > fengchuSuccessesBefore) localTrace.successes -= 1;
  const fengchu = groundedFengchu ?? deterministicFengchu;
  await emitStage('report');

  return {
    id: `analysis-${Date.now()}`, createdAt: new Date().toISOString(), metrics, features, knowledge, emotion, interaction, risk, relationship, report: finalReport, fengchu,
    engine: { provider: localTrace.successes > 0 ? 'ollama' : 'deterministic', model: localTrace.successes > 0 ? process.env.OLLAMA_MODEL ?? 'qwen3:1.7b' : 'relationship-evidence-framework/1.0', reasoningEffort: 'none', usedFallback: localTrace.successes < localTrace.attempts, contextMode: sol.context.mode, sourceMessageCount: sol.context.sourceMessageCount, includedMessageCount: sol.context.includedMessageCount },
  };
}
