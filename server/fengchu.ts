import type {
  ChatMessage,
  EmotionResult,
  FengchuAnalysis,
  FengchuEvidence,
  FeatureSet,
  InteractionResult,
  KnowledgeResult,
  RelationshipResult,
  RiskResult,
  SignalGrade,
} from '../shared/types.js';

type FengchuInput = {
  messages: ChatMessage[];
  features: FeatureSet;
  knowledge: KnowledgeResult;
  emotion: EmotionResult;
  interaction: InteractionResult;
  risk: RiskResult;
  relationship: RelationshipResult;
};

type Candidate = FengchuEvidence & { grade?: SignalGrade; signalType: string; weight: number; index: number };

const gradeWeight: Record<SignalGrade, number> = { S: 100, A: 82, B: 58, C: 34, negative: 94 };
const emotionalWords = /累|难过|伤心|委屈|压力|焦虑|烦|失望|生气|不开心|崩溃|痛苦/;
const questionWords = /[?？]|吗[呀呢哦嘛]?$|呢[呀哦嘛]?$|你在|你今天|你吃|你睡|你怎么|为什么|怎么样|还好吗|到家了吗/;

function clip(value: string, max: number): string {
  const normalized = value.trim();
  return normalized.length <= max ? normalized : `${normalized.slice(0, Math.max(1, max - 1))}…`;
}

export function fengchuCharacterCount(analysis: FengchuAnalysis): number {
  return [
    analysis.coreJudgment,
    analysis.deepInterpretation,
    ...analysis.keyEvidence.flatMap((item) => [item.quote, item.surfaceBehavior, item.hiddenSignal, item.whyItMatters]),
    ...analysis.insights,
    ...analysis.extraordinaryAdvice,
    analysis.highlight,
  ].join('').replace(/\s/g, '').length;
}

export function groundFengchuAnalysis(analysis: FengchuAnalysis | undefined, messages: ChatMessage[]): FengchuAnalysis | null {
  if (!analysis) return null;
  const byId = new Map(messages.map((message) => [message.id, message]));
  const keyEvidence = analysis.keyEvidence.flatMap((item) => {
    const message = byId.get(item.messageId);
    if (!message || message.text !== item.quote) return [];
    return [{ ...item, speaker: message.speaker, timestamp: message.timestamp ?? '' }];
  });
  if (!keyEvidence.length) return null;
  const grounded = compactToLimit({
    ...analysis,
    keyEvidence,
    highlight: analysis.highlight.startsWith('凤雏Highlight：') ? analysis.highlight : `凤雏Highlight：${analysis.highlight}`,
  });
  return grounded.keyEvidence.length && fengchuCharacterCount(grounded) <= 500 ? grounded : null;
}

function compactToLimit(input: FengchuAnalysis, max = 500): FengchuAnalysis {
  const result: FengchuAnalysis = {
    coreJudgment: clip(input.coreJudgment, 58),
    deepInterpretation: clip(input.deepInterpretation, 82),
    keyEvidence: input.keyEvidence.slice(0, 5).map((item) => ({
      ...item,
      surfaceBehavior: clip(item.surfaceBehavior, 10),
      hiddenSignal: clip(item.hiddenSignal, 16),
      whyItMatters: clip(item.whyItMatters, 22),
    })),
    insights: input.insights.slice(0, 3).map((item) => clip(item, 38)),
    extraordinaryAdvice: input.extraordinaryAdvice.slice(0, 3).map((item) => clip(item, 64)),
    highlight: clip(input.highlight.startsWith('凤雏Highlight：') ? input.highlight : `凤雏Highlight：${input.highlight}`, 52),
  };

  while (fengchuCharacterCount(result) > max && result.insights.length > 1) result.insights.pop();
  while (fengchuCharacterCount(result) > max && result.extraordinaryAdvice.length > 1) result.extraordinaryAdvice.pop();
  while (fengchuCharacterCount(result) > max && result.keyEvidence.length > 3) result.keyEvidence.pop();
  if (fengchuCharacterCount(result) > max) result.deepInterpretation = clip(result.deepInterpretation, 54);
  result.keyEvidence = result.keyEvidence.map((item) => ({ ...item, whyItMatters: clip(item.whyItMatters, 15), hiddenSignal: clip(item.hiddenSignal, 12) }));
  while (fengchuCharacterCount(result) > max && result.keyEvidence.length > 1) result.keyEvidence.pop();
  if (fengchuCharacterCount(result) > max) {
    result.coreJudgment = clip(result.coreJudgment, 38);
    result.extraordinaryAdvice = [clip(result.extraordinaryAdvice[0] ?? '先观察对方是否会主动投入并兑现行动。', 42)];
    result.highlight = clip(result.highlight, 36);
  }
  while (fengchuCharacterCount(result) > max && result.keyEvidence.length) result.keyEvidence.pop();
  if (fengchuCharacterCount(result) > max) {
    result.deepInterpretation = clip(result.deepInterpretation, 34);
    result.insights = [clip(result.insights[0] ?? '当前证据不足。', 24)];
  }
  return result;
}

function signalLanguage(signalType: string, grade?: SignalGrade) {
  if (grade === 'negative') return { surface: '明确拒绝或降温', hidden: '关系边界正在收紧', why: '反向证据不能被甜蜜片段抵消' };
  if (/实时陪伴|时间投入/.test(signalType)) return { surface: '投入实时陪伴', hidden: '愿意付出时间靠近', why: '时间成本高于单句甜话，但仍需看持续性' };
  if (/互动后自然表达爱意/.test(signalType)) return { surface: '互动后自然表达爱意', hidden: '亲密感在相处中升起', why: '连续互动后的表达比孤立关键词更有信息量' };
  if (/情感表达|亲密称呼/.test(signalType)) return { surface: '直接亲密表达', hidden: '高强度关系靠近', why: '属于强信号，重复并兑现时更可靠' };
  if (/暧昧|想念/.test(signalType)) return { surface: '暧昧或想念表达', hidden: '在试探亲密距离', why: '强于普通礼貌，但仍要看是否持续' };
  if (/见面|未来|推进/.test(signalType)) return { surface: '推进共同安排', hidden: '愿意把关系带入现实', why: '行动成本比单次甜话更有分量' };
  if (/情绪|关心|支持/.test(signalType)) return { surface: '承接情绪与照顾', hidden: '关注你的内在状态', why: '回应情绪比只回事情更显投入' };
  if (/记忆/.test(signalType)) return { surface: '记住你的细节', hidden: '持续注意力较高', why: '细节记忆通常来自长期关注' };
  if (/分享/.test(signalType)) return { surface: '主动分享生活', hidden: '邀请你进入日常', why: '分享欲是关系靠近的中强信号' };
  if (/发起/.test(signalType)) return { surface: '主动开启会话', hidden: '愿意主动靠近', why: '主动性可检验投入是否对等' };
  return { surface: '延续对话', hidden: '愿意维持互动', why: '需结合频率和后续行动判断' };
}

function candidatesFromSignals(messages: ChatMessage[], features: FeatureSet): Candidate[] {
  const anchors = [...features.relationshipSignals.positiveSignals, ...features.relationshipSignals.negativeSignals];
  const byMessage = new Map<string, Candidate>();
  anchors.forEach((anchor) => {
    const index = messages.findIndex((message) => message.text === anchor.quote
      && (!anchor.timestamp || message.timestamp === anchor.timestamp)
      && (anchor.direction !== 'them_to_me' || message.speaker === 'them'));
    if (index < 0) return;
    const message = messages[index];
    const wording = signalLanguage(anchor.signalType ?? '互动信号', anchor.signalGrade);
    const candidate: Candidate = {
      messageId: message.id,
      quote: message.text,
      speaker: message.speaker,
      timestamp: message.timestamp ?? '',
      surfaceBehavior: wording.surface,
      hiddenSignal: wording.hidden,
      whyItMatters: wording.why,
      grade: anchor.signalGrade,
      signalType: anchor.signalType ?? '互动信号',
      weight: gradeWeight[anchor.signalGrade ?? 'C'] + (index / Math.max(1, messages.length)) * 8,
      index,
    };
    const existing = byMessage.get(message.id);
    if (!existing || candidate.weight > existing.weight) byMessage.set(message.id, candidate);
  });
  return [...byMessage.values()];
}

function genericCandidates(messages: ChatMessage[], existing: Set<string>): Candidate[] {
  return messages.map((message, index): Candidate | null => {
    if (existing.has(message.id) || !message.text.trim()) return null;
    const previous = messages[index - 1];
    if (/(?:通话|语音(?:通话)?|视频(?:通话)?|电话)[^\d]{0,12}\d{1,3}\s*[:：]\s*\d{2}/i.test(message.text)) {
      return { messageId: message.id, quote: message.text, speaker: message.speaker, timestamp: message.timestamp ?? '', surfaceBehavior: '投入实时陪伴', hiddenSignal: '愿意付出时间靠近', whyItMatters: '时间成本高于单句甜话', signalType: '实时陪伴 / 时间投入', grade: 'A', weight: 68, index };
    }
    if (message.speaker === 'them' && previous?.speaker === 'me' && emotionalWords.test(previous.text)) {
      return { messageId: message.id, quote: message.text, speaker: message.speaker, timestamp: message.timestamp ?? '', surfaceBehavior: '回应你的情绪', hiddenSignal: '是否承接仍看语义', whyItMatters: '这是检验情绪投入的重要窗口', signalType: '情绪回应窗口', weight: 46, index };
    }
    if (message.speaker === 'them' && questionWords.test(message.text)) {
      return { messageId: message.id, quote: message.text, speaker: message.speaker, timestamp: message.timestamp ?? '', surfaceBehavior: '主动追问', hiddenSignal: '愿意继续了解你', whyItMatters: '连续追问比礼貌回复更有信息量', signalType: '追问', weight: 42, index };
    }
    if (message.speaker === 'them') {
      return { messageId: message.id, quote: message.text, speaker: message.speaker, timestamp: message.timestamp ?? '', surfaceBehavior: '参与回应', hiddenSignal: '只能确认有互动', whyItMatters: '单句不能独立证明喜欢', signalType: '普通回应', weight: 20, index };
    }
    if (message.speaker === 'me') {
      return { messageId: message.id, quote: message.text, speaker: message.speaker, timestamp: message.timestamp ?? '', surfaceBehavior: '由你主动表达', hiddenSignal: '显示的是你的投入', whyItMatters: '不能代替对方的态度证据', signalType: '用户侧投入', weight: 8, index };
    }
    return null;
  }).filter((item): item is Candidate => item != null);
}

function chooseEvidence(messages: ChatMessage[], features: FeatureSet): Candidate[] {
  const signaled = candidatesFromSignals(messages, features);
  const negatives = signaled.filter((item) => item.grade === 'negative').sort((a, b) => b.weight - a.weight);
  const positives = signaled.filter((item) => item.grade !== 'negative').sort((a, b) => b.weight - a.weight || b.index - a.index);
  const selected = positives.slice(0, negatives.length ? 2 : 3);
  if (negatives.length) selected.push(negatives[0]);
  const existing = new Set(selected.map((item) => item.messageId));
  const generics = genericCandidates(messages, existing)
    .sort((a, b) => (b.quote.length <= 42 ? 8 : 0) - (a.quote.length <= 42 ? 8 : 0) || b.weight - a.weight || b.index - a.index);
  for (const candidate of generics) {
    if (selected.length >= Math.min(3, messages.length)) break;
    if (!existing.has(candidate.messageId)) { selected.push(candidate); existing.add(candidate.messageId); }
  }
  return selected.slice(0, 5);
}

function interpretationOptions(candidate: Candidate | undefined) {
  const type = candidate?.signalType ?? '';
  if (candidate?.grade === 'negative') return ['对方在认真设边界', '冲突时的防御', '一时气话'];
  if (/实时陪伴|时间投入/.test(type)) return ['愿意投入真实时间靠近', '亲密朋友式陪伴', '当下刚好有空'];
  if (/互动后自然表达爱意/.test(type)) return ['相处后的真实情绪流露', '双方惯用的亲密表达', '当下气氛升温'];
  if (/情感表达|亲密称呼/.test(type)) return ['真实地拉近关系', '双方惯用的亲密玩笑', '当下情绪升温'];
  if (/暧昧|想念/.test(type)) return ['有意试探亲密距离', '熟人间固定玩笑', '社交口头禅'];
  if (/见面|未来|推进/.test(type)) return ['想把关系带进现实', '普通朋友式安排', '礼貌性提议'];
  if (/情绪|关心|支持/.test(type)) return ['愿意承接你的情绪', '亲密友谊式关心', '习惯性礼貌'];
  return ['持续关注', '亲密友谊', '偶发礼貌'];
}

export function buildFengchuAnalysis(input: FengchuInput): FengchuAnalysis {
  const { messages, features, interaction, risk, relationship } = input;
  const signals = features.relationshipSignals;
  const strongCount = signals.counts.s + signals.counts.a;
  const negativeCount = signals.counts.negative;
  const evidence = chooseEvidence(messages, features);
  let coreJudgment: string;
  if (negativeCount && strongCount) coreJudgment = '这段关系有靠近，也有明确退缩；甜蜜信号不能越过边界证据，当前最重要的是看行动是否一致。';
  else if (negativeCount) coreJudgment = '对方已经给出拒绝或降温信号；现阶段应把边界当作核心事实，而不是用零散互动替它找反例。';
  else if (signals.counts.s) coreJudgment = '对方已给出高权重靠近信号，关系温度明显高于普通礼貌；是否稳定，仍取决于持续投入和行动兑现。';
  else if (strongCount >= 2) coreJudgment = '多个中强信号方向一致，关系更接近暧昧或情感兴趣，而非单纯客套；结论仍需现实行动验证。';
  else if (relationship.score >= 55) coreJudgment = '聊天里存在好感与投入线索，但强度还不足以替对方下结论；目前更像正在靠近、尚未定型。';
  else coreJudgment = '现有记录更能证明双方有互动，还不足以证明稳定的情感兴趣；先观察对方是否主动增加投入。';

  const top = evidence[0];
  const options = interpretationOptions(top);
  const firstIsMostLikely = top?.grade === 'S' || top?.grade === 'A' || top?.grade === 'negative';
  const deepInterpretation = `表层是“${top?.surfaceBehavior ?? '持续互动'}”；可能是${options[0]}、${options[1]}，也可能是${options[2]}。结合${strongCount ? '信号权重与频率' : '当前有限样本'}，${firstIsMostLikely ? '第一种解释更可能' : '第二种解释更稳妥'}，关键看后续是否主动且对等。`;

  const insights: string[] = [];
  if (signals.languageIntimacy >= signals.behaviorIntimacy + 20) insights.push(`语言亲密 ${signals.languageIntimacy} 分高于行为 ${signals.behaviorIntimacy} 分：甜话走在行动前面。`);
  if (signals.behaviorIntimacy >= signals.languageIntimacy + 20) insights.push(`行为亲密 ${signals.behaviorIntimacy} 分高于语言 ${signals.languageIntimacy} 分：靠近更多藏在行动里。`);
  if (signals.supportiveResponse >= 60) insights.push('对方不只回复事情，也会承接情绪，这是容易被忽略的投入。');
  if (signals.userInitiative >= signals.initiative + 18) insights.push('目前更多热度由你点燃；对方能否主动续上，才是下一步关键信号。');
  if (signals.recent30 >= signals.allHistory + 15) insights.push('近期信号强于长期均值，关系正在升温，但要防止把短期峰值当成稳定状态。');
  if (risk.signals.some((item) => item.status === 'warning')) insights.push('甜蜜之外已出现边界预警；喜欢与尊重必须同时成立。');
  if (!insights.length) insights.push(`互动对等度约 ${interaction.reciprocity} 分，真正的分水岭是对方会不会主动发起并落实。`);

  let advice: string;
  if (risk.signals.some((item) => item.status === 'warning')) advice = '先明确一条具体边界，观察对方是尊重并修复，还是辩解、施压；后者比任何甜话更值得警惕。';
  else if (signals.relationshipProgress < 55 && strongCount) advice = '给出一次低压力且具体的邀约，观察她是否主动补充时间地点；若总说“改天”却不落地，就下调判断。';
  else if (signals.userInitiative >= signals.initiative + 18) advice = '停止连续追问，保留自然联系；观察下一个会话窗口是否由她主动开启、延续或修复。';
  else advice = '用与当前温度相称的方式回应，再提出一个可落地的小计划；观察她是否主动确认、兑现并继续安排下一次。';

  const highlight = negativeCount
    ? '凤雏Highlight：真正的靠近，不会要求你忽略边界。'
    : signals.languageIntimacy >= signals.behaviorIntimacy + 20
      ? '凤雏Highlight：甜话是温度，兑现才是关系的重量。'
      : signals.behaviorIntimacy >= signals.languageIntimacy + 20
        ? '凤雏Highlight：没说出口的靠近，往往先藏在持续行动里。'
        : strongCount
          ? '凤雏Highlight：单句让人心动，重复而对等的行动才让结论站稳。'
          : '凤雏Highlight：看不清时，别猜内心，看对方会不会主动走下一步。';

  return compactToLimit({
    coreJudgment,
    deepInterpretation,
    keyEvidence: evidence.map((item) => ({ messageId: item.messageId, quote: item.quote, speaker: item.speaker, timestamp: item.timestamp, surfaceBehavior: item.surfaceBehavior, hiddenSignal: item.hiddenSignal, whyItMatters: item.whyItMatters })),
    insights,
    extraordinaryAdvice: [advice],
    highlight,
  });
}
