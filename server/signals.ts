import type {
  ChatMessage,
  ConversationFeatures,
  EvidenceAnchor,
  EvidenceLevel,
  LinguisticFeatures,
  RecentFeatures,
  RelationshipSignalSummary,
  RelationshipSignalCategory,
  RelationshipSignalDimensions,
  RelationshipSignalLedgerEntry,
  SignalGrade,
  SignalParticipant,
} from '../shared/types.js';
import { detectAffectionRules } from './affection-rules.js';

type Signal = EvidenceAnchor & {
  weight: number;
  bucket: 'language' | 'behavior' | 'initiative' | 'continuity' | 'progress' | 'support' | 'negative';
  messageId: string;
  category?: RelationshipSignalCategory;
};

const clamp = (value: number, min = 0, max = 100) => Math.max(min, Math.min(max, Math.round(value)));
const gradeWeight: Record<SignalGrade, number> = { S: 100, A: 82, B: 58, C: 34, negative: -92 };
const gradeLevel: Record<SignalGrade, EvidenceLevel> = { S: 'high', A: 'high', B: 'medium', C: 'low', negative: 'high' };

const directAffection = /(?:我)?(?:真的?|很|好)?(?:爱你|喜欢你)|想和你在一起|想跟你在一起|在一起吧|做我的(?:男朋友|女朋友)|非你不可|离不开你/i;
const longing = /(?:好想|很想|想死|想念|想你|想见你|见到你)|抱抱|舍不得/i;
const meeting = /(?:明天|后天|今晚|今天|周末|下周|下个周末|下次|有空)[^。！？!?\n]{0,36}(?:见|吃|去|来|玩|约|看电影|陪我)|(?:见面|约会|一起吃饭|一起去)/;
const futureCommitment = /(?:以后|将来|未来|一直|长期|陪你到|一起生活|见家长|结婚|我们的家|每年都)/;
const question = /[?？]|吗[呀呢哦嘛]?$|呢[呀哦嘛]?$|(?:你在|你今天|你吃|你睡|你怎么|为什么|怎么样|还好吗|到家了吗)/;
const sharing = /(?:我今天|我刚|我在|我去|我吃|我看到|我发现|我最近|今天我|刚刚|下班|到家了|给你看)/;
const care = /(?:吃饭|吃了吗|到家|早点睡|不要太晚|早点回|休息|注意|还好吗|加油|记得|辛苦|别担心|我陪你|听你说|需要我|慢慢来|抱抱)/;
const empathy = /(?:怎么了|发生什么|我懂|理解你|辛苦了|别难过|别害怕|我在|陪着你|会好的|没事的)/;
const memory = /(?:记得你|记得你说|你上次|你之前|我记得|你喜欢的|你不喜欢)/;
const rejection = /(?:只是朋友|只做朋友|不喜欢你|不想恋爱|不想发展|不可能在一起|别误会|没有感觉|拒绝你|不要喜欢我|不想见你|不想见面|别再约我|不想确认关系|回避关系)/;
const emotionalState = /(?:累|难过|伤心|委屈|压力|焦虑|烦|失望|生气|不开心|崩溃|痛苦)/;
const realTimeEvent = /(?:通话|语音(?:通话)?|视频(?:通话)?|电话|打给你|给你打)/i;
const realTimeDuration = /(?:通话|语音(?:通话)?|视频(?:通话)?|电话)[^\d]{0,12}\d{1,3}\s*[:：]\s*\d{2}/i;

function followsWarmInteraction(messages: ChatMessage[], index: number): boolean {
  return messages.slice(Math.max(0, index - 4), index).some((message) => (
    (message.speaker === 'them' && (realTimeDuration.test(message.text) || care.test(message.text) || empathy.test(message.text)))
    || (message.speaker === 'me' && (emotionalState.test(message.text) || /抱抱|想你|想见你/.test(message.text)))
  ));
}

function anchor(message: ChatMessage, signalType: string, signalGrade: SignalGrade, interpretation: string, direction: 'them_to_me' | 'me_to_them', category?: RelationshipSignalCategory): Signal {
  return {
    messageId: message.id,
    quote: message.text,
    speaker: message.name,
    timestamp: message.timestamp,
    interpretation,
    evidenceLevel: gradeLevel[signalGrade],
    signalType,
    signalGrade,
    direction,
    weight: gradeWeight[signalGrade],
    bucket: signalGrade === 'negative' ? 'negative' : 'language',
    category,
  };
}

function hasExcludedAffection(text: string): boolean {
  return /妈妈爱你|爸爸爱你|(?:哈哈哈?|呵呵|笑死).{0,5}爱你个?头|谢谢(?:你)?爱你|爱你个头|爱你哦个鬼|开玩笑|感谢.{0,12}爱你|爱你.{0,12}(?:感谢|谢谢|外卖)/.test(text);
}

function isDirectAffection(text: string): boolean {
  return directAffection.test(text) && !hasExcludedAffection(text) && !/(?:不爱你|不喜欢你|没爱你|没有喜欢你|不想和你在一起)/.test(text);
}

function isNegative(text: string): boolean {
  return rejection.test(text) || /(?:滚开|闭嘴|别烦我|不想说了|随便你|恶心|威胁|不许你)/.test(text);
}

function scoreSignals(signals: Signal[]): number {
  if (!signals.length) return 0;
  const sorted = [...signals].sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight));
  const positive = sorted.filter((signal) => signal.weight > 0).reduce((sum, signal) => sum + Math.abs(signal.weight), 0);
  const negative = sorted.filter((signal) => signal.weight < 0).reduce((sum, signal) => sum + Math.abs(signal.weight), 0);
  if (!positive) return clamp(negative ? negative * 0.65 : 0);
  const strongest = Math.max(...sorted.filter((signal) => signal.weight > 0).map((signal) => signal.weight));
  const base = strongest >= 100 ? 88 : strongest >= 82 ? 74 : strongest >= 58 ? 55 : 36;
  const repeatBonus = Math.min(18, Math.max(0, sorted.filter((signal) => signal.weight > 0).length - 1) * 6);
  return clamp(base + repeatBonus - negative * 0.18);
}

function windowMessages(messages: ChatMessage[], days: number, fallbackCount: number): ChatMessage[] {
  const withTime = messages.filter((message) => message.timestamp).map((message) => ({ message, time: Date.parse((message.timestamp ?? '').replace(/\//g, '-')) })).filter((item) => Number.isFinite(item.time));
  if (!withTime.length) return messages.slice(-fallbackCount);
  const latest = Math.max(...withTime.map((item) => item.time));
  return withTime.filter((item) => item.time >= latest - days * 86_400_000).map((item) => item.message);
}

function participant(message?: ChatMessage): SignalParticipant {
  return message?.speaker === 'me' || message?.speaker === 'them' ? message.speaker : 'unknown';
}

function isPromptingMessage(message?: ChatMessage): boolean {
  if (!message) return false;
  return question.test(message.text)
    || isDirectAffection(message.text)
    || longing.test(message.text)
    || emotionalState.test(message.text)
    || /(?:想你|抱抱|安慰|陪我|来电话|见面|吃饭|有空)/.test(message.text);
}

function contextFor(messages: ChatMessage[], messageId: string, radius: number): { ids: string[]; text: string } {
  const index = messages.findIndex((message) => message.id === messageId);
  if (index < 0) return { ids: [messageId], text: '' };
  const start = Math.max(0, index - radius);
  const end = Math.min(messages.length, index + radius + 1);
  const window = messages.slice(start, end);
  return {
    ids: window.map((message) => message.id),
    text: window.slice(0, 8).map((message) => `${message.name}: ${message.text}`).join(' | '),
  };
}

function inferCategory(signal: Signal): RelationshipSignalCategory {
  if (signal.category) return signal.category;
  if (signal.signalGrade === 'negative' || signal.bucket === 'negative') return 'negative';
  const type = signal.signalType ?? '';
  if (type.includes('\u65f6\u95f4') || type.includes('\u5b9e\u65f6')) return 'time_investment';
  if (type.includes('\u60c5\u611f') || type.includes('\u7231\u610f') || type.includes('\u4eb2\u5bc6')) return 'explicit_affection';
  if (type.includes('\u66a7\u6627')) return 'flirtation';
  if (type.includes('\u5173\u5fc3') || type.includes('\u652f\u6301') || type.includes('\u56de\u5e94')) return 'care';
  if (type.includes('\u89c1\u9762') || type.includes('\u672a\u6765') || type.includes('\u63a8\u8fdb')) return 'relationship_progress';
  if (type.includes('\u4e3b\u52a8')) return 'initiative';
  if (type.includes('\u5ef6\u7eed')) return 'continuity';
  if (type.includes('\u8bb0\u5fc6') || type.includes('\u5206\u4eab')) return 'dependency_specialness';
  return 'emotional_investment';
}

function isReactive(messages: ChatMessage[], index: number): boolean {
  const previous = messages[index - 1];
  if (!previous || previous.speaker === messages[index].speaker) return false;
  return isPromptingMessage(previous);
}

function ledgerEntry(signal: Signal, messages: ChatMessage[]): RelationshipSignalLedgerEntry {
  const index = messages.findIndex((message) => message.id === signal.messageId);
  const previous = index > 0 ? messages[index - 1] : undefined;
  const reactive = isReactive(messages, index);
  const context = contextFor(messages, signal.messageId, signal.signalGrade === 'S' || signal.bucket === 'progress' ? 15 : 10);
  const initiator = participant(messages[index]);
  const responder = previous && previous.speaker !== messages[index]?.speaker ? participant(previous) : null;
  return {
    signal: signal.signalType ?? 'relationship_signal',
    category: inferCategory(signal),
    strength: clamp(Math.abs(signal.weight)),
    confidence: signal.evidenceLevel === 'high' ? 0.9 : signal.evidenceLevel === 'medium' ? 0.72 : 0.48,
    direction: signal.direction ?? 'unknown',
    speaker: participant(messages[index]),
    initiator,
    responder,
    spontaneous: !reactive,
    reactive,
    messageId: signal.messageId,
    quote: signal.quote,
    timestamp: signal.timestamp,
    contextMessageIds: context.ids,
    context: context.text,
    reason: signal.interpretation,
    evidenceLevel: signal.evidenceLevel,
    signalGrade: signal.signalGrade ?? 'C',
  };
}

function userInvestmentLedger(messages: ChatMessage[]): RelationshipSignalLedgerEntry[] {
  return messages.flatMap((message, index) => {
    if (message.speaker !== 'me' || !(isDirectAffection(message.text) || longing.test(message.text) || care.test(message.text))) return [];
    const previous = messages[index - 1];
    const reactive = Boolean(previous && previous.speaker === 'them' && isPromptingMessage(previous));
    const context = contextFor(messages, message.id, 10);
    return [{
      signal: 'user_investment', category: isDirectAffection(message.text) ? 'explicit_affection' : 'emotional_investment', strength: 0,
      confidence: 0.95, direction: 'me_to_them' as const, speaker: 'me' as const, initiator: 'me' as const,
      responder: previous && previous.speaker === 'them' ? 'them' as const : null, spontaneous: !reactive, reactive,
      messageId: message.id, quote: message.text, timestamp: message.timestamp, contextMessageIds: context.ids,
      context: context.text, reason: '记录用户自己的投入，避免将用户表达误算为对方喜欢信号。', evidenceLevel: 'high' as const, signalGrade: 'C' as const,
    }];
  });
}

function buildSignalDimensions(summary: Omit<RelationshipSignalSummary, 'signalLedger' | 'signalDimensions' | 'liking'>, ledger: RelationshipSignalLedgerEntry[], messages: ChatMessage[]): RelationshipSignalDimensions {
  const them = ledger.filter((entry) => entry.speaker === 'them' && entry.direction === 'them_to_me');
  const categoryScore = (category: RelationshipSignalCategory) => {
    const entries = them.filter((entry) => entry.category === category);
    if (!entries.length) return 0;
    const weighted = entries.reduce((total, entry) => total + entry.strength * entry.confidence * (entry.spontaneous ? 1 : 0.78), 0);
    return clamp(weighted / Math.max(1, Math.sqrt(entries.length)));
  };
  const dateBuckets = new Set(them.map((entry) => (entry.timestamp ?? '').slice(0, 10)).filter(Boolean));
  const stability = clamp(summary.allHistory * 0.52 + summary.recent30 * 0.28 + Math.min(20, dateBuckets.size * 3) - summary.negativeSignals.length * 4);
  return {
    initiative: clamp(Math.max(summary.initiative, categoryScore('initiative'))),
    emotionalExpression: clamp(Math.max(summary.languageIntimacy, categoryScore('explicit_affection') * 0.9 + categoryScore('emotional_investment') * 0.25)),
    timeInvestment: clamp(Math.max(summary.timeInvestment, categoryScore('time_investment'))),
    careSupport: clamp(Math.max(summary.supportiveResponse, categoryScore('care'))),
    flirtation: clamp(Math.max(categoryScore('flirtation'), summary.languageIntimacy * 0.62)),
    relationshipProgress: clamp(Math.max(summary.relationshipProgress, categoryScore('relationship_progress'))),
    dependencySpecialness: clamp(categoryScore('dependency_specialness') + (messages.filter((message) => message.speaker === 'them' && /(?:只跟你|第一时间|只告诉你|特别)/.test(message.text)).length * 14)),
    stability,
  };
}

function buildLiking(summary: Omit<RelationshipSignalSummary, 'signalLedger' | 'signalDimensions' | 'liking'>, dimensions: RelationshipSignalDimensions, ledger: RelationshipSignalLedgerEntry[], qualityScore: number): RelationshipSignalSummary['liking'] {
  const positive = ledger.filter((entry) => entry.speaker === 'them' && entry.direction === 'them_to_me' && entry.strength > 0);
  const negative = ledger.filter((entry) => entry.category === 'negative' || entry.signalGrade === 'negative');
  const categories = new Set(positive.map((entry) => entry.category));
  const dates = new Set(positive.map((entry) => (entry.timestamp ?? '').slice(0, 10)).filter(Boolean));
  const bundleBonus = categories.size >= 3 ? 10 : categories.size >= 2 ? 5 : 0;
  const temporalBonus = dates.size >= 2 ? 6 : 0;
  const spontaneousCount = positive.filter((entry) => entry.spontaneous).length;
  const reactivePenalty = positive.length && spontaneousCount / positive.length < 0.35 ? 6 : 0;
  const negativePenalty = Math.min(46, negative.length * 24);
  const raw = dimensions.initiative * 0.16
    + dimensions.emotionalExpression * 0.18
    + dimensions.timeInvestment * 0.13
    + dimensions.careSupport * 0.13
    + dimensions.flirtation * 0.1
    + dimensions.relationshipProgress * 0.11
    + dimensions.dependencySpecialness * 0.06
    + dimensions.stability * 0.13
    + bundleBonus + temporalBonus - reactivePenalty - negativePenalty;
  const probability = clamp(raw, 4, 97);
  const confidence = clamp(qualityScore * 0.62 + Math.min(22, categories.size * 5) + Math.min(12, dates.size * 3) - (negative.length ? 8 : 0), 18, 94);
  const label = probability >= 78 ? 'high' : probability >= 62 ? 'leaning' : probability >= 45 ? 'mixed' : confidence < 45 ? 'uncertain' : 'low';
  const rationale = categories.size >= 3
    ? '喜欢倾向来自多个独立信号束，而不是单个关键词；同时保留了主动性、持续性和反向证据的校正。'
    : positive.length
      ? '目前有可观察的靠近或关心信号，但独立维度覆盖有限，仍需观察对方是否持续主动并兑现安排。'
      : '当前没有足够的对方主动信号，不能仅凭礼貌回复推断喜欢。';
  return { label, probability, confidence, rationale, evidence: positive.slice(0, 8), counterEvidence: negative.slice(0, 8) };
}

function buildSummary(signals: Signal[], negativeSignals: Signal[], messages: ChatMessage[], conversation: ConversationFeatures, recent: RecentFeatures, qualityScore = 62): RelationshipSignalSummary {
  const language = signals.filter((signal) => signal.bucket === 'language');
  const behavior = signals.filter((signal) => signal.bucket === 'behavior' || signal.bucket === 'support' || signal.bucket === 'continuity' || signal.bucket === 'progress');
  const initiativeSignals = signals.filter((signal) => signal.bucket === 'initiative');
  const continuitySignals = signals.filter((signal) => signal.bucket === 'continuity');
  const progressSignals = signals.filter((signal) => signal.bucket === 'progress');
  const supportSignals = signals.filter((signal) => signal.bucket === 'support');
  const timeSignals = signals.filter((signal) => signal.signalType === '实时陪伴 / 时间投入');
  const userInitiative = messages.filter((message) => message.speaker === 'me' && (isDirectAffection(message.text) || longing.test(message.text) || question.test(message.text))).length;
  const recent7Signals = signals.filter((signal) => windowMessages(messages, 7, 18).some((message) => message.text === signal.quote));
  const recent30Signals = signals.filter((signal) => windowMessages(messages, 30, 60).some((message) => message.text === signal.quote));
  const counts = signals.reduce((result, signal) => {
    const key = signal.signalGrade === 'S' ? 's' : signal.signalGrade === 'A' ? 'a' : signal.signalGrade === 'B' ? 'b' : signal.signalGrade === 'C' ? 'c' : 'negative';
    result[key] += 1;
    return result;
  }, { s: 0, a: 0, b: 0, c: 0, negative: negativeSignals.length });
  const allHistory = clamp((scoreSignals(language) * 0.28 + scoreSignals(behavior) * 0.3 + scoreSignals(initiativeSignals) * 0.18 + scoreSignals(progressSignals) * 0.14 + scoreSignals(supportSignals) * 0.1) - scoreSignals(negativeSignals) * 0.18);
  const recent30Score = clamp(scoreSignals(recent30Signals) * 0.46 + (recent.theirStarts ? clamp(recent.theirStarts * 18) : 0) * 0.2 + scoreSignals(recent30Signals.filter((signal) => signal.bucket !== 'language')) * 0.34 - scoreSignals(negativeSignals.filter((signal) => recent30Signals.some((positive) => positive.quote === signal.quote))) * 0.12);
  const base = {
    languageIntimacy: scoreSignals(language),
    behaviorIntimacy: scoreSignals(behavior),
    initiative: clamp(scoreSignals(initiativeSignals) || (conversation.sessionCount ? conversation.theirStarts / conversation.sessionCount * 100 : 0)),
    topicContinuity: scoreSignals(continuitySignals),
    relationshipProgress: scoreSignals(progressSignals),
    supportiveResponse: scoreSignals(supportSignals),
    timeInvestment: scoreSignals(timeSignals),
    userInitiative: clamp(userInitiative * 18),
    recent7: clamp(recent7Signals.length ? scoreSignals(recent7Signals) : 0),
    recent30: recent30Score,
    allHistory,
    positiveSignals: signals.filter((signal) => signal.weight > 0).slice(0, 30),
    negativeSignals: negativeSignals.slice(0, 12),
    counts,
  };
  const signalLedger = [...signals.map((signal) => ledgerEntry(signal, messages)), ...negativeSignals.map((signal) => ledgerEntry(signal, messages)), ...userInvestmentLedger(messages)]
    .sort((a, b) => b.strength - a.strength || a.messageId.localeCompare(b.messageId))
    .slice(0, 160);
  const signalDimensions = buildSignalDimensions(base, signalLedger, messages);
  const liking = buildLiking(base, signalDimensions, signalLedger, qualityScore);
  return { ...base, signalLedger, signalDimensions, liking };
}

export function extractRelationshipSignals(messages: ChatMessage[], conversation: ConversationFeatures, _linguistic: LinguisticFeatures, recent: RecentFeatures, qualityScore = 62): RelationshipSignalSummary {
  const affectionRules = detectAffectionRules(messages);
  const strongIds = new Set(affectionRules.strongMatches.map((message) => message.id));
  const ambiguousIds = new Set(affectionRules.ambiguousMatches.map((message) => message.id));
  const signals: Signal[] = [];
  const negativeSignals: Signal[] = [];
  const push = (signal: Signal) => signals.push(signal);

  messages.forEach((message, index) => {
    const previous = messages[index - 1];
    if (message.speaker === 'them') {
      if (isNegative(message.text)) negativeSignals.push({ ...anchor(message, '明确拒绝 / 关系降温', 'negative', '这句话是对方明确拒绝、撤退或不希望发展关系的反向证据。', 'them_to_me'), bucket: 'negative' });
      if (realTimeEvent.test(message.text) && (realTimeDuration.test(message.text) || /打给你|给你打|跟你聊/.test(message.text))) push({ ...anchor(message, '实时陪伴 / 时间投入', 'A', '对方投入了可观察的实时陪伴时间；行动成本高于单次甜话，但不单独等于恋爱承诺。', 'them_to_me'), bucket: 'behavior' });
      if (isDirectAffection(message.text)) {
        const signalType = followsWarmInteraction(messages, index) ? '互动后自然表达爱意' : '主动情感表达';
        const interpretation = signalType === '互动后自然表达爱意'
          ? '爱意出现在连续互动、关心或实时陪伴之后，比脱离上下文的单句更有信息量。'
          : '对方直接向你表达爱意、喜欢或明确的关系靠近。';
        push({ ...anchor(message, signalType, 'S', interpretation, 'them_to_me'), bucket: 'language' });
      }
      else if (strongIds.has(message.id)) push({ ...anchor(message, '亲密称呼', 'S', '对方把亲密称呼直接用于你；这是高权重语言信号，但仍需结合持续行动。', 'them_to_me'), bucket: 'language' });
      else if (ambiguousIds.has(message.id)) push({ ...anchor(message, '暧昧角色称呼', 'A', '对方使用带暧昧或角色意味的直接称呼，说明互动温度较高。', 'them_to_me'), bucket: 'language' });
      else if (longing.test(message.text)) push({ ...anchor(message, '主动想念 / 见面愿望', 'A', '对方主动表达想念、拥抱或见面愿望。', 'them_to_me'), bucket: 'language' });
      else if ((care.test(message.text) || empathy.test(message.text)) && previous?.speaker === 'me' && emotionalState.test(previous.text)) push({ ...anchor(message, '情绪回应', 'A', '对方承接了你的情绪，而不是只做事务性回复。', 'them_to_me'), bucket: 'support' });
      else if (care.test(message.text)) push({ ...anchor(message, '关心与支持', 'B', '对方主动询问或照顾你的日常状态。', 'them_to_me'), bucket: 'support' });
      if (meeting.test(message.text)) push({ ...anchor(message, '主动推进见面', 'A', '对方提出了可落地的见面或共同活动。', 'them_to_me'), bucket: 'progress' });
      if (futureCommitment.test(message.text)) push({ ...anchor(message, '未来关系投入', 'S', '对方把你放进未来或长期安排中；仍需观察是否落实。', 'them_to_me'), bucket: 'progress' });
      if (memory.test(message.text)) push({ ...anchor(message, '记忆细节', 'A', '对方记得你此前分享的细节，体现持续注意力。', 'them_to_me'), bucket: 'behavior' });
      if (sharing.test(message.text)) push({ ...anchor(message, '主动分享生活', 'B', '对方主动把自己的生活信息带进对话。', 'them_to_me'), bucket: 'behavior' });
      if (question.test(message.text) && previous?.speaker === 'me') push({ ...anchor(message, '主动询问与话题延续', 'A', '对方没有停在礼貌回复，而是继续询问并推动话题。', 'them_to_me'), bucket: 'continuity' });
      else if (previous?.speaker === 'me' && message.text.length >= 10) push({ ...anchor(message, '话题延续', 'B', '对方给出了有内容的回应，保留了继续互动的空间。', 'them_to_me'), bucket: 'continuity' });
    }
  });

  // Session starts are objective behavioral evidence and are kept separate from language signals.
  let lastTime: number | null = null;
  messages.forEach((message, index) => {
    const parsed = message.timestamp ? Date.parse(message.timestamp.replace(/\//g, '-')) : NaN;
    const startsSession = index === 0 || (Number.isFinite(parsed) && lastTime != null && parsed - lastTime > 3 * 60 * 60 * 1000);
    if (Number.isFinite(parsed)) lastTime = parsed;
    const lowInformationStatus = /^(?:刚忙完|忙完了|嗯嗯?|好的呀?|哈哈哈?|在忙|刚到家|晚安)$/i.test(message.text.trim());
    if (startsSession && message.speaker === 'them' && !lowInformationStatus) push({ ...anchor(message, '主动开启会话', 'A', '对方在新的会话窗口主动发起联系，属于行为层靠近信号。', 'them_to_me'), bucket: 'initiative' });
  });

  return buildSummary(signals, negativeSignals, messages, conversation, recent, qualityScore);
}
