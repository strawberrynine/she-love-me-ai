import { ChatMessage, EvidenceAnchor, EvidenceLevel, FeatureSet, FrameworkAssessment, KnowledgeResult } from '../shared/types.js';
import { detectAffectionRules } from './affection-rules.js';

const dictionaries = {
  passion: ['想你', '想见你', '喜欢你', '爱你', '抱抱', '亲亲', '宝宝', '宝贝', '亲爱的', 'honey', '小朋友', '小孩', '老婆', '老公'],
  vulnerability: ['害怕', '难过', '压力', '焦虑', '委屈', '秘密', '从来没说过', '其实我', '家里', '过去'],
  support: ['我陪你', '别担心', '听你说', '辛苦了', '还好吗', '加油', '慢慢来', '需要我'],
  commitment: ['我们以后', '我们将来', '一直陪', '不会离开', '一起生活', '见家长', '结婚'],
  affection: ['喜欢你', '爱你', '想你', '宝贝', '亲爱的', '老婆', '老公'],
  criticism: ['你总是', '你从来', '你就是', '你怎么这么', '都是你的错'],
  contempt: ['可笑', '真蠢', '没用', '恶心', '跟你说不清楚', '懒得理你', '呵呵'],
  defensiveness: ['还不是因为你', '是你先', '凭什么怪我', '我有什么错', '你不也'],
  stonewalling: ['随便你', '不想说了', '别烦我', '别找我', '无所谓', '就这样吧'],
};

const hits = (messages: ChatMessage[], terms: string[]) => messages.filter((message) => terms.some((term) => message.text.includes(term)));
const clamp = (value: number, min = 0, max = 100) => Math.max(min, Math.min(max, value));

function anchor(message: ChatMessage, interpretation: string, evidenceLevel: EvidenceLevel = 'medium'): EvidenceAnchor {
  return { quote: message.text, speaker: message.name, timestamp: message.timestamp, interpretation, evidenceLevel };
}

function assessment(value: string | null, score: number | undefined, reason: string, evidence: EvidenceAnchor[], alternativeExplanation?: string): FrameworkAssessment {
  const evidenceLevel: EvidenceLevel = value == null ? 'insufficient' : evidence.length >= 3 ? 'high' : evidence.length >= 1 ? 'medium' : 'low';
  return { value, score, evidenceLevel, reason, evidence: evidence.slice(0, 4), alternativeExplanation };
}

function computeSymmetry(features: FeatureSet, messageShare: number) {
  const messageBalance = 1 - Math.abs(messageShare / 100 - 0.5) * 2;
  const initiationBalance = features.conversation.sessionCount > 0 ? 1 - Math.abs(features.conversation.myStartRatio / 100 - 0.5) * 2 : 0.5;
  const { myAvgReplyMinutes, theirAvgReplyMinutes } = features.conversation;
  const replyBalance = myAvgReplyMinutes != null && theirAvgReplyMinutes != null
    ? Math.max(0, 1 - Math.abs(myAvgReplyMinutes - theirAvgReplyMinutes) / 1440)
    : 0.5;
  const repairs = features.conversation.myRepairStarts + features.conversation.theirRepairStarts;
  const repairBalance = repairs ? 1 - Math.abs(features.conversation.myRepairStarts - features.conversation.theirRepairStarts) / repairs : 0.5;
  const score = Math.round((messageBalance * 0.25 + initiationBalance * 0.3 + replyBalance * 0.2 + repairBalance * 0.25) * 100) / 10;
  const replyText = myAvgReplyMinutes == null || theirAvgReplyMinutes == null ? '回复时间样本不足' : `双方平均回复约 ${myAvgReplyMinutes}/${theirAvgReplyMinutes} 分钟`;
  return {
    score: clamp(score, 0, 10),
    derivation: `消息量 ${messageShare}:${100 - messageShare}；会话发起 ${features.conversation.myStarts}:${features.conversation.theirStarts}；${replyText}；沉默后重启 ${features.conversation.myRepairStarts}:${features.conversation.theirRepairStarts}。`,
    evidenceLevel: features.quality.level,
  };
}

function sternberg(messages: ChatMessage[], features: FeatureSet) {
  const theirMessages = messages.filter((message) => message.speaker === 'them');
  const affectionRules = detectAffectionRules(messages);
  const warmFlirtation = theirMessages.filter((message) => /晚安|想见|想你|抱抱|亲亲|好想|可爱|开心|下次还|明天见|😊|🥰|😘|❤️|❤/.test(message.text));
  const contextualJokes = (text: string) => /妈妈爱你|爸爸爱你|爱你个头|谢谢(?:你)?爱你|(?:哈哈哈?|呵呵|笑死).{0,5}爱你/.test(text);
  const directPassionHits = hits(theirMessages, dictionaries.passion).filter((message) => !contextualJokes(message.text));
  const passionMessages = [...new Map([...directPassionHits, ...affectionRules.ambiguousMatches, ...warmFlirtation].map((message) => [message.id, message])).values()];
  const passionScore = affectionRules.strongMatches.length
    ? clamp(88 + Math.min(10, (affectionRules.strongMatches.length - 1) * 4))
    : affectionRules.ambiguousMatches.length
      ? clamp(68 + Math.min(18, warmFlirtation.length * 6))
      : passionMessages.length
        ? clamp(42 + passionMessages.length * 12)
        : undefined;
  const passion = assessment(passionMessages.length ? '激情 / 吸引信号' : null, passionScore, passionMessages.length ? `识别到对方发出的 ${passionMessages.length} 条亲昵称呼、暧昧表达或主动靠近信号；强称呼按高权重计算。` : '暂未找到对方发出的直接吸引或暧昧表达。', passionMessages.map((message) => anchor(message, '这句话由对方发出，包含亲密称呼、暧昧表达或主动靠近。')), '称呼也可能受个人表达习惯影响，仍结合后续行动判断。');
  const careOrDisclosure = theirMessages.filter((message) => /吃饭|休息|到家|注意|记得|辛苦|还好吗|别担心|我陪你|听你说|其实我|告诉你|想和你说|开心|难过|压力|秘密/.test(message.text));
  const signalMessages = features.relationshipSignals.positiveSignals
    .filter((signal) => signal.direction === 'them_to_me')
    .map((signal) => theirMessages.find((message) => message.text === signal.quote))
    .filter((message): message is ChatMessage => Boolean(message));
  const timeInvestmentMessages = features.timeInvestment.evidence.filter((message) => message.speaker === 'them');
  const intimacyMessages = [...new Map([...hits(theirMessages, dictionaries.vulnerability), ...hits(theirMessages, dictionaries.support), ...careOrDisclosure, ...signalMessages, ...timeInvestmentMessages].map((message) => [message.id, message])).values()];
  const intimacyScore = intimacyMessages.length
    ? clamp(Math.max(45 + intimacyMessages.length * 10 + Math.min(12, features.linguistic.careSignals.them * 4), features.relationshipSignals.languageIntimacy * 0.82, features.relationshipSignals.behaviorIntimacy, features.relationshipSignals.timeInvestment))
    : undefined;
  const intimacy = assessment(intimacyMessages.length ? '亲密 / 情感开放信号' : null, intimacyScore, intimacyMessages.length ? `识别到对方发出的 ${intimacyMessages.length} 条语言亲密、关心、主动分享、支持、情绪承接或实时陪伴信号。` : '暂未找到对方发出的关心、主动分享或情绪承接证据。', intimacyMessages.map((message) => anchor(message, /通话|语音|视频|电话/.test(message.text) ? '这条实时陪伴记录体现了对方投入真实时间，但仍需结合长期稳定性判断。' : '这句话体现了对方的语言亲密、关心、主动分享、支持或情绪承接。')), '提供建议或投入时间不一定等于情绪共情，需要结合上下文判断。');
  const concretePlans = theirMessages.filter((message) => /(?:明天|后天|周[一二三四五六日天]|下次|今晚|晚上|\d{1,2}[点时]|一起)[^。！？]{0,28}(?:见|吃|去|来|玩|约|等你|订|安排)/.test(message.text));
  const commitmentMessages = [...new Map([...hits(theirMessages, dictionaries.commitment), ...concretePlans].map((message) => [message.id, message])).values()];
  const commitmentScore = commitmentMessages.length ? clamp(Math.max(50 + commitmentMessages.length * 15 + Math.min(10, features.linguistic.concretePlans.them * 5), features.relationshipSignals.relationshipProgress)) : undefined;
  const commitment = assessment(commitmentMessages.length ? '承诺 / 具体投入信号' : null, commitmentScore, commitmentMessages.length ? `识别到对方发出的 ${commitmentMessages.length} 条未来投入、见面意愿或可验证安排；具体时间和行动按高权重计算。` : '暂未找到对方发出的具体未来计划或见面投入。', commitmentMessages.map((message) => anchor(message, '这句话由对方发出，包含见面意愿、未来投入或可验证安排。')), '未来表达只有在后续行动中得到落实，才构成更强的承诺证据。');
  const p = passion.score ?? 0; const i = intimacy.score ?? 0; const c = commitment.score ?? 0;
  const availableScores = [passion.score, intimacy.score, commitment.score].filter((value): value is number => value != null);
  const triangleScore = availableScores.length ? Math.round(availableScores.reduce((sum, value) => sum + value, 0) / availableScores.length) : 0;
  const triangleConfidence = Math.round((availableScores.length / 3) * 100);
  const high = (value: number) => value >= 55;
  const pattern = high(p) && high(i) && high(c) ? '三维相对均衡' : high(p) && high(i) ? '浪漫吸引信号较突出，承诺证据较少' : high(i) && !high(p) ? '亲密支持较突出，激情证据较少' : high(c) && !high(p) && !high(i) ? '承诺/事务投入较突出' : '三维证据仍不充分';
  return { passion, intimacy, commitment, pattern, triangleScore, triangleConfidence };
}

function gottman(messages: ChatMessage[], features: FeatureSet) {
  const types = [
    ['批评候选', dictionaries.criticism],
    ['蔑视候选', dictionaries.contempt],
    ['防御候选', dictionaries.defensiveness],
    ['筑墙候选', dictionaries.stonewalling],
  ] as const;
  const horsemen = types.map(([type, terms]) => {
    const matched = hits(messages, terms);
    return { type, count: matched.length, evidence: matched.slice(0, 3).map((message) => anchor(message, `这是“${type}”语言模式的候选证据，仍需结合前后文。`)) };
  }).filter((item) => item.count > 0);
  const positive = features.linguistic.positiveEmotion.me + features.linguistic.positiveEmotion.them;
  const negative = features.linguistic.negativeEmotion.me + features.linguistic.negativeEmotion.them + horsemen.reduce((sum, item) => sum + item.count, 0);
  const ratio = positive || negative ? Math.round((positive / Math.max(negative, 1)) * 10) / 10 : null;
  const repairs = features.conversation.myRepairStarts + features.conversation.theirRepairStarts;
  const repairBalance = repairs ? `沉默后重启：我方 ${features.conversation.myRepairStarts} 次，对方 ${features.conversation.theirRepairStarts} 次` : '未识别到可计算的长间隔重启事件';
  const evidenceLevel: EvidenceLevel = features.quality.level === 'high' && (positive + negative >= 5) ? 'high' : positive + negative >= 2 ? 'medium' : 'insufficient';
  return { positiveNegativeRatio: ratio, horsemen, repairBalance, evidenceLevel };
}

function stageAssessment(messages: ChatMessage[], features: FeatureSet): FrameworkAssessment {
  const affection = hits(messages, dictionaries.affection);
  const plans = features.linguistic.concretePlans.me + features.linguistic.concretePlans.them;
  const explicit = messages.filter((message) => /(?:我们是|做我|当我|男朋友|女朋友|对象|在一起吧)/.test(message.text));
  let value: string | null = null;
  let reason = '样本中缺少足够的关系定义、共同计划与长期互动证据。';
  if (explicit.length) { value = '关系确认信号'; reason = '聊天中出现了明确的关系定义语言。'; }
  else if (affection.length >= 2 && plans >= 1) { value = '暧昧升温 / 确认前观察'; reason = '同时出现亲密表达和可验证的共同计划，但没有明确关系定义证据。'; }
  else if (features.conversation.sessionCount >= 2 && (features.conversation.theirStarts > 0 || features.conversation.myStarts > 0)) { value = '持续互动观察期'; reason = '存在多个独立会话，但亲密或承诺证据仍有限。'; }
  const evidence = [...explicit, ...affection, ...messages.filter((message) => /(?:明天|周末|下次)[^。！？]{0,20}(?:见|吃|去|约)/.test(message.text))].slice(0, 4).map((message) => anchor(message, '这句话用于定位关系阶段。'));
  return assessment(value, undefined, reason, evidence, '关系阶段是当前样本的截面，不等同于双方对关系的共同定义。');
}

function cycleAssessment(messages: ChatMessage[], features: FeatureSet): FrameworkAssessment {
  const pursuit = messages.filter((message) => message.speaker === 'me' && /你在吗|怎么不回|不想理我|是不是不喜欢|你怎么了/.test(message.text));
  const withdrawal = messages.filter((message) => message.speaker === 'them' && /不想说|随便|很忙|别烦|算了|晚点说/.test(message.text));
  if (features.conversation.myMultiSendEvents < 1 || !pursuit.length || !withdrawal.length) return assessment(null, undefined, '未同时识别到追问升级、连续追发和对方撤退三类信号，不能归类为追逃循环。', [...pursuit, ...withdrawal].slice(0, 3).map((message) => anchor(message, '这是沟通循环的局部候选信号。', 'low')), '单次忙碌、短回复或追问并不能说明依恋类型。');
  return assessment('可能存在追问—撤退循环', undefined, `我方连续追发事件 ${features.conversation.myMultiSendEvents} 次，并同时发现追问与撤退候选语言。`, [...pursuit.slice(0, 2), ...withdrawal.slice(0, 2)].map((message) => anchor(message, '这句话构成追问或撤退环节的候选证据。')), '也可能由工作节奏、沟通习惯或短期压力造成；这不是依恋类型诊断。');
}

function availabilityAssessment(messages: ChatMessage[], features: FeatureSet): FrameworkAssessment {
  const support = hits(messages.filter((message) => message.speaker === 'them'), dictionaries.support);
  const theirQuestions = messages.filter((message) => message.speaker === 'them' && /[?？]|吗$|呢$|怎么|为什么|还好吗/.test(message.text));
  const dismissive = hits(messages.filter((message) => message.speaker === 'them'), [...dictionaries.stonewalling, ...dictionaries.contempt]);
  const score = clamp(48 + support.length * 10 + Math.min(theirQuestions.length, 4) * 5 - dismissive.length * 12);
  const evidence = [...support.map((message) => anchor(message, '这句话体现了支持或情绪承接。')), ...dismissive.map((message) => anchor(message, '这句话可能关闭了情绪沟通。'))].slice(0, 4);
  if (!evidence.length || features.quality.level === 'insufficient') return assessment(null, undefined, '缺少足够的情绪分享—回应配对，无法可靠评估情感可得性。', evidence, '事务型沟通不必然代表情感不可得。');
  return assessment(score >= 68 ? '较高' : score >= 45 ? '中等' : '较低', score, '根据对方的支持、追问和关闭沟通候选信号综合估计。', evidence, '结果反映样本中的聊天行为，不代表对方稳定的人格属性。');
}

export function buildKnowledge(messages: ChatMessage[], features: FeatureSet, myShare: number): KnowledgeResult {
  return {
    methodology: {
      version: 'relationship-evidence-framework/1.1',
      principles: ['全量统计与证据窗口分离', '无证据不推断', '量化指标先于语义校正', '高风险采用双阈值', '证据不足时明确留白', '信号束优先：表达、时间投入、生活关心与情绪回应放回同一互动链判断', '行动成本高于单次甜话，但必须用持续性与对等程度复核'],
      sourceAcknowledgement: '方法论参考 863401402/she-love-me（MIT），已按本项目的隐私、证据等级和多 Agent 契约重新实现。',
    },
    symmetry: computeSymmetry(features, myShare),
    sternberg: sternberg(messages, features),
    gottman: gottman(messages, features),
    relationshipStage: stageAssessment(messages, features),
    communicationCycle: cycleAssessment(messages, features),
    emotionalAvailability: availabilityAssessment(messages, features),
    relationshipSignals: features.relationshipSignals,
  };
}
