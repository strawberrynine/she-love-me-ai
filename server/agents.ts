import { BasicMetrics, ChatMessage, EmotionResult, EvidenceAnchor, FeatureSet, InteractionResult, KnowledgeResult, RelationshipResult, ReportResult, RiskResult, RiskSignal } from '../shared/types.js';
import { sanitizeEvidenceAnchors, type AnalysisSource } from './evidence.js';
import { selectAncestorMessage } from './ancestor-messages.js';
import { selectStrategistAdvice } from './strategist-advice.js';

const positiveWords = ['哈哈', '开心', '喜欢', '想你', '晚安', '期待', '好呀', '谢谢', '爱', '一起', '加油'];
const negativeWords = ['烦', '不想', '随便', '滚', '讨厌', '冷淡', '呵呵', '无语', '分手', '别找', '闭嘴'];
const careWords = ['吃饭', '到家', '早点', '休息', '注意', '还好吗', '想你', '加油', '记得', '辛苦'];
const clamp = (value: number, min = 0, max = 100) => Math.max(min, Math.min(max, value));
const countHits = (messages: ChatMessage[], words: string[]) => messages.reduce((count, message) => count + words.filter((word) => message.text.includes(word)).length, 0);

function quoteAnchor(messages: ChatMessage[], quote: string, interpretation: string): EvidenceAnchor {
  const message = messages.find((item) => item.text === quote);
  return { quote, speaker: message?.name ?? '对方', timestamp: message?.timestamp, interpretation, evidenceLevel: message ? 'medium' : 'low' };
}

export function emotionAgent(messages: ChatMessage[], features: FeatureSet): EmotionResult {
  const positive = countHits(messages, positiveWords);
  const negative = countHits(messages, negativeWords);
  const score = clamp(54 + positive * 5 - negative * 7);
  const chunks = [messages.slice(0, Math.ceil(messages.length / 3)), messages.slice(Math.ceil(messages.length / 3), Math.ceil((messages.length * 2) / 3)), messages.slice(Math.ceil((messages.length * 2) / 3))];
  const moments = chunks.map((chunk, index) => ({
    label: `阶段 ${index + 1}`,
    value: clamp(50 + countHits(chunk, positiveWords) * 8 - countHits(chunk, negativeWords) * 10),
    note: index === 0 ? '早期互动窗口' : index === 1 ? '中段互动窗口' : '近期互动窗口',
  }));
  const delta = moments.at(-1)!.value - moments[0].value;
  const recentChange = features.recent.volumeChangePercent;
  const trend = Math.abs(delta) > 18 ? (delta > 0 ? 'rising' : 'falling') : recentChange != null && recentChange < -45 ? 'falling' : 'stable';
  const evidence = messages.filter((message) => positiveWords.some((word) => message.text.includes(word)) || negativeWords.some((word) => message.text.includes(word))).slice(-4).map((message) => message.text);
  return { overall: score > 68 ? 'positive' : score < 42 ? 'negative' : positive || negative ? 'mixed' : 'neutral', score, trend, moments, evidence };
}

export function interactionAgent(messages: ChatMessage[], metrics: BasicMetrics, features: FeatureSet, knowledge: KnowledgeResult): InteractionResult {
  const theirQuestions = messages.filter((message) => message.speaker === 'them' && /[?？]|吗$|呢$|什么|怎么|为什么/.test(message.text)).length;
  const theirCare = features.linguistic.careSignals.them;
  const timeInvestment = features.relationshipSignals.timeInvestment;
  const initiation = features.conversation.sessionCount
    ? clamp(Math.round((features.conversation.theirStarts / features.conversation.sessionCount) * 100))
    : clamp(Math.round((metrics.theirMessages / Math.max(metrics.myMessages, 1)) * 55));
  const replyBalance = features.conversation.myAvgReplyMinutes != null && features.conversation.theirAvgReplyMinutes != null
    ? clamp(Math.round(100 - Math.abs(features.conversation.myAvgReplyMinutes - features.conversation.theirAvgReplyMinutes) / 14.4))
    : metrics.responseRate;
  const reciprocity = clamp(Math.round(knowledge.symmetry.score * 7 + theirCare * 5 + Math.min(theirQuestions, 4) * 3 + timeInvestment * 0.18));
  const continuity = clamp(Math.round(40 + Math.min(theirQuestions, 6) * 7 + Math.min(metrics.avgTheirLength, 30)));
  const responsiveness = clamp(Math.round(replyBalance * 0.65 + metrics.responseRate * 0.35));
  const score = Math.round((initiation + reciprocity + continuity + responsiveness) / 4);
  const patterns = [
    initiation >= 55 ? '对方会主动开启独立会话' : features.conversation.sessionCount ? '独立会话更多由你发起' : '时间戳不足，主动发起只能低置信度估计',
    continuity >= 65 ? '对话中存在追问和话题延续' : '话题延续证据偏少',
    timeInvestment >= 55 ? '对方投入了可观察的实时陪伴时间' : '暂未形成稳定的实时陪伴证据',
    knowledge.communicationCycle.value ?? '未识别到稳定的追问—撤退闭环',
  ];
  const evidence = messages.filter((message) => message.speaker === 'them' && (careWords.some((word) => message.text.includes(word)) || /[?？]|吗$|呢$|通话|语音|视频|电话/.test(message.text))).slice(-6).map((message) => message.text);
  return { score, initiation, reciprocity, continuity, responsiveness, patterns, evidence };
}

function riskSignal(input: Omit<RiskSignal, 'severity' | 'status' | 'evidenceLevel'> & { severityIfWarning: 'medium' | 'high' }): RiskSignal {
  const both = input.triggerStatus.quantitative === 'met' && input.triggerStatus.textual === 'met';
  const some = input.triggerStatus.quantitative === 'met' || input.triggerStatus.textual === 'met';
  return {
    ...input,
    severity: both ? input.severityIfWarning : 'low',
    status: both ? 'warning' : 'observation',
    evidenceLevel: both ? 'high' : some ? 'low' : 'insufficient',
  };
}

export function riskAgent(messages: ChatMessage[], metrics: BasicMetrics, features: FeatureSet, knowledge: KnowledgeResult): RiskResult {
  const signals: RiskSignal[] = [];
  const obsessive = messages.filter((message) => message.speaker === 'me' && /你不回我|难受一天|她回我.*在意|说明.*在意|离不开|一直在想/.test(message.text));
  const pursue = messages.filter((message) => message.speaker === 'me' && /你在吗|怎么不回|不想理我|是不是不喜欢|你怎么了/.test(message.text));
  const gaslight = messages.filter((message) => message.speaker === 'them' && /我从来没说过|你记错了|你太敏感了|你想太多了|无理取闹/.test(message.text));
  const coercive = messages.filter((message) => message.speaker === 'them' && /闭嘴|滚|威胁|不许你|必须听我的|没用|恶心|贱狗/.test(message.text));
  const future = features.linguistic.futureMentions.them;
  const concrete = features.linguistic.concretePlans.them;

  if (metrics.myShare > 68 || features.conversation.myStartRatio > 68 || pursue.length) {
    signals.push(riskSignal({
      type: '投入不对等', severityIfWarning: 'medium',
      triggerStatus: {
        quantitative: metrics.myShare > 75 && features.conversation.myStartRatio > 70 ? 'met' : 'not_met',
        textual: pursue.length >= 2 || features.conversation.myMultiSendEvents >= 3 ? 'met' : 'not_met',
        detail: `消息占比 ${metrics.myShare}:${100 - metrics.myShare}；会话发起占比 ${features.conversation.myStartRatio}%；连续追发事件 ${features.conversation.myMultiSendEvents} 次。`,
      },
      evidence: pursue[0]?.text ?? knowledge.symmetry.derivation,
      advice: '先观察一段时间内对方是否会主动发起、修复和落实计划，不要只用消息总量证明关系。',
    }));
  }

  if (gaslight.length || features.linguistic.dismissivePhrases.them >= 2) {
    signals.push(riskSignal({
      type: '否定感受 / 现实扭曲候选', severityIfWarning: 'high',
      triggerStatus: {
        quantitative: features.linguistic.dismissivePhrases.them >= 2 ? 'met' : 'not_met',
        textual: gaslight.length >= 2 ? 'met' : 'not_met',
        detail: `对方否定感受类短语 ${features.linguistic.dismissivePhrases.them} 次，明确候选原话 ${gaslight.length} 条。`,
      },
      evidence: gaslight[0]?.text ?? '检测到否定感受类用语，但尚不足以形成高亮预警。',
      advice: '记录具体事实和自己的感受；若这种否认反复出现并让你持续怀疑自己，可向可信任的人或专业支持求证。',
    }));
  }

  if (features.recent.theirMessageDensityCv != null && features.recent.theirMessageDensityCv > 0.6) {
    signals.push(riskSignal({
      type: '间歇性回应候选', severityIfWarning: 'medium',
      triggerStatus: {
        quantitative: features.recent.theirMessageDensityCv > 0.6 && features.recent.theirStarts <= 3 ? 'met' : 'not_met',
        textual: obsessive.length >= 2 ? 'met' : 'not_met',
        detail: `近 30 天对方消息密度变异系数 ${features.recent.theirMessageDensityCv}，主动会话 ${features.recent.theirStarts} 次；强迫性解读候选 ${obsessive.length} 条。`,
      },
      evidence: obsessive[0]?.text ?? '互动密度波动较大，但未发现足够的情绪依赖原话。',
      advice: '把偶尔的热情放回更长时间线中观察，优先看稳定性和行动兑现。',
    }));
  }

  if (future >= 5 && concrete <= 1) {
    signals.push(riskSignal({
      type: '未来承诺未落地候选', severityIfWarning: 'medium',
      triggerStatus: {
        quantitative: 'met', textual: 'insufficient',
        detail: `对方未来导向表达 ${future} 次，含具体时间/行动的计划 ${concrete} 次；当前样本无法可靠验证后续兑现。`,
      },
      evidence: '未来表达较多，但具体计划证据较少。',
      advice: '不要仅依据“以后”，关注是否出现具体时间、地点和后续行动。',
    }));
  }

  const limerenceQuant = features.recent.available && features.recent.myShare > 75 && features.recent.theirStarts <= 3 && features.conversation.theirRepairStarts === 0 && features.conversation.myMultiSendEvents >= 5;
  if (limerenceQuant || obsessive.length) {
    signals.push(riskSignal({
      type: '过度聚焦 / 情绪依赖候选', severityIfWarning: 'high',
      triggerStatus: {
        quantitative: limerenceQuant ? 'met' : 'not_met',
        textual: obsessive.length >= 2 ? 'met' : 'not_met',
        detail: `近 30 天我方占比 ${features.recent.myShare}%，对方主动会话 ${features.recent.theirStarts} 次，连续追发 ${features.conversation.myMultiSendEvents} 次，依赖性表达 ${obsessive.length} 条。`,
      },
      evidence: obsessive[0]?.text ?? '统计出现高度单向投入，但文本证据不足。',
      advice: '暂时把注意力放回睡眠、工作和现实支持系统；若情绪长期被回复牵动，考虑寻求专业支持。',
    }));
  }

  if (coercive.length) {
    signals.push(riskSignal({
      type: '控制 / 贬低表达', severityIfWarning: 'high',
      triggerStatus: {
        quantitative: coercive.length >= 2 ? 'met' : 'not_met', textual: coercive.length >= 1 ? 'met' : 'not_met',
        detail: `识别到 ${coercive.length} 条明确的控制、威胁或贬低候选表达。`,
      },
      evidence: coercive[0].text,
      advice: '优先考虑自己的安全与边界；出现威胁或控制升级时，及时联系可信任的人和当地支持资源。',
    }));
  }

  const warnings = signals.filter((signal) => signal.status === 'warning');
  const score = clamp(warnings.reduce((sum, signal) => sum + (signal.severity === 'high' ? 35 : 22), 0) + signals.filter((signal) => signal.status === 'observation').length * 5);
  return { level: warnings.some((signal) => signal.severity === 'high') ? 'high' : warnings.length ? 'medium' : 'low', score, signals };
}

export function relationshipAgent(metrics: BasicMetrics, features: FeatureSet, knowledge: KnowledgeResult, emotion: EmotionResult, interaction: InteractionResult, risk: RiskResult, messages: ChatMessage[] = []): RelationshipResult {
  const signals = features.relationshipSignals;
  const initiative = clamp(Math.max(interaction.initiation, signals.initiative));
  const responsiveness = clamp(Math.max(interaction.responsiveness, signals.supportiveResponse * 0.85));
  const behaviorIntimacy = clamp(Math.max(signals.behaviorIntimacy, signals.supportiveResponse * 0.72, signals.timeInvestment));
  const score = clamp(Math.round(
    behaviorIntimacy * 0.28
    + signals.languageIntimacy * 0.18
    + initiative * 0.18
    + signals.relationshipProgress * 0.15
    + responsiveness * 0.1
    + emotion.score * 0.05
    + (100 - risk.score) * 0.06
  ));
  const label = score >= 75 ? '互动信号积极' : score >= 58 ? '存在好感与投入信号' : score >= 42 ? '信号混合，仍需观察' : '当前投入与安全感偏弱';
  const confidence = clamp(Math.round(features.quality.score * 0.75 + Math.min(25, metrics.messageCount / 4)), 25, 92);
  const advanced = features.relationshipSignals.signalDimensions;
  const confirmedRelationship = messages.some((message) => /(?:情侣|在一起了|男朋友|女朋友|恋爱关系|对象|老公|老婆)/.test(message.text));
  const recentNegative = messages.length > 0 && features.relationshipSignals.negativeSignals.some((signal) => {
    const index = messages.findIndex((message) => message.text === signal.quote);
    return index >= Math.max(0, messages.length - Math.max(3, Math.ceil(messages.length * 0.5)));
  });
  const relationshipStage = risk.level === 'high'
    ? 'cooling_or_unsafe'
    : recentNegative
      ? 'cooling_or_unsafe'
      : confirmedRelationship
        ? 'relationship'
        : signals.relationshipProgress >= 78 && signals.languageIntimacy >= 72
          ? 'romantic_interest'
          : signals.relationshipProgress >= 65 && signals.timeInvestment >= 70 && signals.languageIntimacy >= 70
            ? 'romantic_interest'
            : signals.languageIntimacy >= 62 && interaction.score >= 58
              ? 'flirtation'
              : behaviorIntimacy >= 58 && interaction.score >= 52
                ? 'close_friendship'
                : features.quality.score < 38
                  ? 'uncertain'
                  : 'ordinary_friendship';
  return {
    score, confidence, label,
    summary: `${knowledge.relationshipStage.value ?? '关系阶段证据不足'}；${knowledge.sternberg.pattern}。该结论描述聊天行为，不等同于对方真实想法。`,
    dimensions: [
      { key: 'initiative', label: '主动性', score: initiative, description: '对方主动发起、主动询问与话题延续' },
      { key: 'care', label: '情绪关心', score: clamp(Math.round(Math.max(knowledge.emotionalAvailability.score ?? 0, behaviorIntimacy, signals.languageIntimacy * 0.8))), description: '语言亲密、支持、追问与情绪承接' },
      { key: 'response', label: '回复 / 回应', score: responsiveness, description: '有效回复样本与情绪回应投入' },
      { key: 'stability', label: '稳定性', score: clamp(Math.round(100 - risk.score - (features.recent.theirMessageDensityCv ?? 0) * 15)), description: '互动波动、风险预警与修复表现' },
    ],
    signalScores: {
      languageIntimacy: signals.languageIntimacy,
      behaviorIntimacy,
      initiative,
      topicContinuity: signals.topicContinuity,
      relationshipProgress: signals.relationshipProgress,
      supportiveResponse: signals.supportiveResponse,
      recent7: signals.recent7,
      recent30: signals.recent30,
      allHistory: signals.allHistory,
    },
    liking: signals.liking,
    relationshipStage,
    advancedDimensions: [
      { key: 'initiative', label: 'initiative', score: advanced.initiative, description: 'session starts, questions, and interaction pushes' },
      { key: 'emotionalExpression', label: 'emotional expression', score: advanced.emotionalExpression, description: 'direct affection and emotional response' },
      { key: 'timeInvestment', label: 'time investment', score: advanced.timeInvestment, description: 'calls, companionship, and measurable time cost' },
      { key: 'careSupport', label: 'care and support', score: advanced.careSupport, description: 'life reminders, comfort, and help' },
      { key: 'flirtation', label: 'flirtation', score: advanced.flirtation, description: 'intimate names, tests, and playful closeness' },
      { key: 'relationshipProgress', label: 'relationship progress', score: advanced.relationshipProgress, description: 'meetings, future plans, and confirmation' },
      { key: 'dependencySpecialness', label: 'specialness', score: advanced.dependencySpecialness, description: 'priority sharing and special treatment' },
      { key: 'stability', label: 'stability', score: advanced.stability, description: 'persistence and reciprocity across time windows' },
    ],
  };
}

export function reportAgent(messages: ChatMessage[], features: FeatureSet, knowledge: KnowledgeResult, relationship: RelationshipResult, emotion: EmotionResult, interaction: InteractionResult, risk: RiskResult, source: AnalysisSource = 'text'): ReportResult {
  const frameworkEvidence = [
    ...knowledge.relationshipStage.evidence,
    ...knowledge.sternberg.passion.evidence,
    ...knowledge.sternberg.intimacy.evidence,
    ...knowledge.sternberg.commitment.evidence,
    ...knowledge.emotionalAvailability.evidence,
    ...knowledge.communicationCycle.evidence,
  ];
  const fallbackQuotes = [...interaction.evidence, ...emotion.evidence].map((quote) => quoteAnchor(messages, quote, careWords.some((word) => quote.includes(word)) ? '这句话包含具体关心或生活参与。' : '这句话体现情绪或话题投入。'));
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
  const keyEvidence = sanitizeEvidenceAnchors([...new Map([...frameworkEvidence, ...timeInvestmentEvidence, ...fallbackQuotes].map((item) => [`${item.timestamp}-${item.quote}`, item])).values()].slice(0, 6), source);
  const counterEvidence = sanitizeEvidenceAnchors(features.relationshipSignals.negativeSignals.slice(0, 4), source);
  const warningCount = risk.signals.filter((signal) => signal.status === 'warning').length;
  const headline = relationship.score >= 70 ? '聊天中出现了持续靠近的行为信号' : relationship.score >= 52 ? '有投入信号，但答案仍需要现实验证' : '先观察长期行动，再决定如何投入';
  const limitations = [...features.quality.notes, features.quality.level !== 'high' ? `本次证据质量为 ${features.quality.level}，心理框架只作假设。` : '', '聊天记录无法覆盖线下相处、关系约定和双方完整处境。'].filter(Boolean);
  const advice = [
    warningCount ? '先处理已高亮的边界或安全问题，再讨论如何推进关系。' : '继续观察主动发起、情绪承接和计划兑现是否能稳定出现。',
    interaction.initiation < 45 ? '减少连续试探，给对方一个自然发起会话的观察窗口。' : '把一次轻松邀约落到具体时间，观察对方是否共同安排。',
    knowledge.communicationCycle.value ? '用“我感到…我需要…”表达，避免在对方撤退时连续升级追问。' : '谈感受时描述具体事件，不给对方贴人格或依恋标签。',
  ];
  const strategistAdvice = selectStrategistAdvice({ messages, relationship, interaction, risk, features });
  const ancestorMessage = selectAncestorMessage({ messages, relationship, risk });
  return {
    headline,
    summary: relationship.summary,
    keyEvidence,
    counterEvidence,
    advice,
    nextStep: warningCount ? '先设定一条具体边界，并观察对方是否尊重。' : '用一次低压力、可落地的互动验证双方是否愿意共同投入。',
    limitations,
    disclaimer: 'AI 分析仅基于你提供的聊天行为与语言信号，不构成心理诊断，也无法确定他人的真实想法。',
    strategistAdvice,
    ancestorMessage,
  };
}
