import { ChatMessage, EvidenceLevel, FeatureSet, LinguisticFeatures, Speaker, TimeInvestmentFeatures } from '../shared/types.js';
import { extractRelationshipSignals } from './signals.js';

const SESSION_GAP_MS = 3 * 60 * 60 * 1000;
const REPAIR_GAP_MS = 24 * 60 * 60 * 1000;
const MIN_REPLY_MS = 10 * 1000;
const MAX_REPLY_MS = 24 * 60 * 60 * 1000;
const REAL_TIME_EVENT = /(?:通话|语音(?:通话)?|视频(?:通话)?|电话|打给你|给你打)/i;
const REAL_TIME_DURATION = /(?:通话|语音(?:通话)?|视频(?:通话)?|电话)[^\d]{0,12}(\d{1,3})\s*[:：]\s*(\d{2})/i;
const words = {
  hedging: ['也许', '可能', '感觉', '好像', '大概', '应该', '似乎', '不确定', '说不定'],
  conditional: ['如果', '要是', '假如', '万一', '等你', '若是'],
  positive: ['开心', '高兴', '快乐', '幸福', '喜欢', '想你', '哈哈', '可爱', '期待', '谢谢', '温柔', '加油'],
  negative: ['烦', '难过', '伤心', '痛苦', '委屈', '生气', '失望', '算了', '无所谓', '不想', '难受', '哭'],
  care: ['吃饭', '到家', '早点', '休息', '注意', '还好吗', '加油', '记得', '辛苦', '别担心'],
  future: ['以后', '将来', '下次', '明天', '周末', '有空', '一起去', '等以后'],
  dismissive: ['你太敏感', '你想太多', '你记错了', '我没说过', '无理取闹', '随便你', '不想说了'],
  conflict: ['滚', '闭嘴', '烦', '分手', '不合适', '算了', '无语', '讨厌', '别找我', '随便你'],
};

type TimedMessage = { message: ChatMessage; time: number };

export function timestampMs(value?: string): number | null {
  if (!value) return null;
  const numeric = Number(value);
  if (Number.isFinite(numeric)) {
    let normalized = numeric;
    while (normalized > 10_000_000_000_000) normalized /= 1000;
    if (normalized < 10_000_000_000) normalized *= 1000;
    return normalized >= Date.UTC(2000, 0, 1) && normalized <= Date.UTC(2100, 0, 1) ? normalized : null;
  }
  const parsed = Date.parse(value.replace(/\//g, '-'));
  return Number.isFinite(parsed) ? parsed : null;
}

const countWords = (text: string, dictionary: string[]) => dictionary.reduce((sum, word) => sum + (text.includes(word) ? 1 : 0), 0);

function speakerCounts(messages: ChatMessage[], dictionary: string[]): { me: number; them: number } {
  return messages.reduce((result, message) => {
    if (message.speaker === 'me' || message.speaker === 'them') result[message.speaker] += countWords(message.text, dictionary);
    return result;
  }, { me: 0, them: 0 });
}

function linguisticFeatures(messages: ChatMessage[]): LinguisticFeatures {
  const pronounWe = messages.reduce((result, message) => {
    if (message.speaker === 'me' || message.speaker === 'them') result[message.speaker] += (message.text.match(/我们|咱们|咱/g) ?? []).length;
    return result;
  }, { me: 0, them: 0 });
  const concretePlanPattern = /(?:今天|明天|后天|周[一二三四五六日天]|星期[一二三四五六日天]|\d{1,2}[点时]|\d{1,2}[月/-]\d{1,2})[^。！？]{0,24}(?:见|吃|去|来|一起|约)/;
  const concretePlans = messages.reduce((result, message) => {
    if ((message.speaker === 'me' || message.speaker === 'them') && concretePlanPattern.test(message.text)) result[message.speaker] += 1;
    return result;
  }, { me: 0, them: 0 });
  return {
    pronounWe,
    hedging: speakerCounts(messages, words.hedging),
    conditional: speakerCounts(messages, words.conditional),
    positiveEmotion: speakerCounts(messages, words.positive),
    negativeEmotion: speakerCounts(messages, words.negative),
    careSignals: speakerCounts(messages, words.care),
    futureMentions: speakerCounts(messages, words.future),
    concretePlans,
    dismissivePhrases: speakerCounts(messages, words.dismissive),
  };
}

function extractTimeInvestment(messages: ChatMessage[]): TimeInvestmentFeatures {
  const result: TimeInvestmentFeatures = {
    eventCount: 0,
    durationMinutes: 0,
    longEventCount: 0,
    speakerCounts: { me: 0, them: 0, unknown: 0 },
    speakerMinutes: { me: 0, them: 0, unknown: 0 },
    evidence: [],
  };

  for (const message of messages) {
    if (!REAL_TIME_EVENT.test(message.text)) continue;
    const duration = message.text.match(REAL_TIME_DURATION);
    const minutes = duration ? Number(duration[1]) + Number(duration[2]) / 60 : 0;
    const speaker = message.speaker === 'me' || message.speaker === 'them' ? message.speaker : 'unknown';
    result.eventCount += 1;
    result.speakerCounts[speaker] += 1;
    result.durationMinutes += minutes;
    result.speakerMinutes[speaker] += minutes;
    if (minutes >= 20) result.longEventCount += 1;
    result.evidence.push(message);
  }

  result.durationMinutes = Math.round(result.durationMinutes * 10) / 10;
  result.speakerMinutes.me = Math.round(result.speakerMinutes.me * 10) / 10;
  result.speakerMinutes.them = Math.round(result.speakerMinutes.them * 10) / 10;
  result.speakerMinutes.unknown = Math.round(result.speakerMinutes.unknown * 10) / 10;
  result.evidence = result.evidence.slice(0, 20);
  return result;
}

function runStats(messages: ChatMessage[]) {
  let myMultiSendEvents = 0;
  let theirMultiSendEvents = 0;
  let myMaxConsecutive = 0;
  let theirMaxConsecutive = 0;
  let sender: Speaker | null = null;
  let run = 0;
  const finishRun = () => {
    if (sender === 'me') { myMaxConsecutive = Math.max(myMaxConsecutive, run); if (run >= 3) myMultiSendEvents += 1; }
    if (sender === 'them') { theirMaxConsecutive = Math.max(theirMaxConsecutive, run); if (run >= 3) theirMultiSendEvents += 1; }
  };
  for (const message of messages) {
    if (message.speaker === sender) run += 1;
    else { finishRun(); sender = message.speaker; run = 1; }
  }
  finishRun();
  return { myMultiSendEvents, theirMultiSendEvents, myMaxConsecutive, theirMaxConsecutive };
}

function coefficientOfVariation(values: number[]): number | null {
  if (values.length < 7) return null;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  if (!mean) return null;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  return Math.round((Math.sqrt(variance) / mean) * 100) / 100;
}

function evidenceWindows(messages: ChatMessage[], timed: TimedMessage[]) {
  const origin = messages.slice(0, 20);
  const windowSize = Math.min(30, messages.length);
  let conflict = messages.slice(0, windowSize);
  let best = -1;
  for (let index = 0; index <= messages.length - windowSize; index += 1) {
    const candidate = messages.slice(index, index + windowSize);
    const score = candidate.reduce((sum, message) => sum + countWords(message.text, words.conflict) + countWords(message.text, words.dismissive), 0);
    if (score > best) { best = score; conflict = candidate; }
  }
  const maxTime = timed.at(-1)?.time;
  const recent = maxTime == null ? messages.slice(-40) : timed.filter((item) => item.time >= maxTime - 30 * 86400000).slice(-60).map((item) => item.message);
  const repair: ChatMessage[] = [];
  timed.slice(1).forEach((item, index) => {
    if (item.time - timed[index].time >= REPAIR_GAP_MS) repair.push(...timed.slice(Math.max(0, index - 1), index + 5).map((entry) => entry.message));
  });
  return { origin, conflict, recent, repair: [...new Map(repair.map((message) => [message.id, message])).values()].slice(0, 40) };
}

export function extractFeatures(messages: ChatMessage[]): FeatureSet {
  const timed = messages.map((message) => ({ message, time: timestampMs(message.timestamp) })).filter((item): item is TimedMessage => item.time != null).sort((a, b) => a.time - b.time);
  const coverage = messages.length ? timed.length / messages.length : 0;
  let sessionCount = 0;
  let myStarts = 0;
  let theirStarts = 0;
  let myRepairStarts = 0;
  let theirRepairStarts = 0;
  const myReplies: number[] = [];
  const theirReplies: number[] = [];
  timed.forEach((item, index) => {
    const previous = timed[index - 1];
    const isStart = !previous || item.time - previous.time > SESSION_GAP_MS;
    if (isStart) {
      sessionCount += 1;
      if (item.message.speaker === 'me') myStarts += 1;
      if (item.message.speaker === 'them') theirStarts += 1;
    }
    if (previous) {
      const gap = item.time - previous.time;
      if (gap >= REPAIR_GAP_MS) {
        if (item.message.speaker === 'me') myRepairStarts += 1;
        if (item.message.speaker === 'them') theirRepairStarts += 1;
      }
      if (item.message.speaker !== previous.message.speaker && gap >= MIN_REPLY_MS && gap <= MAX_REPLY_MS) {
        if (item.message.speaker === 'me') myReplies.push(gap);
        if (item.message.speaker === 'them') theirReplies.push(gap);
      }
    }
  });
  const averageMinutes = (values: number[]) => values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length / 6000) / 10 : null;
  const runs = runStats(messages);
  const maxTime = timed.at(-1)?.time;
  const recentTimed = maxTime == null ? [] : timed.filter((item) => item.time >= maxTime - 30 * 86400000);
  const recentSessions = recentTimed.filter((item, index) => !recentTimed[index - 1] || item.time - recentTimed[index - 1].time > SESSION_GAP_MS);
  const dailyValues: number[] = [];
  if (recentTimed.length >= 2) {
    const firstDay = Math.floor(recentTimed[0].time / 86400000);
    const lastDay = Math.floor(recentTimed.at(-1)!.time / 86400000);
    for (let day = firstDay; day <= lastDay; day += 1) dailyValues.push(recentTimed.filter((item) => item.message.speaker === 'them' && Math.floor(item.time / 86400000) === day).length);
  }
  let volumeChangePercent: number | null = null;
  if (timed.length >= 2 && timed.at(-1)!.time - timed[0].time >= 14 * 86400000) {
    const midpoint = timed[0].time + (timed.at(-1)!.time - timed[0].time) / 2;
    const before = timed.filter((item) => item.time < midpoint).length;
    const after = timed.length - before;
    volumeChangePercent = before ? Math.round(((after - before) / before) * 100) : null;
  }
  let qualityScore = Math.min(45, messages.length * 1.5) + Math.round(coverage * 35);
  if (messages.some((message) => message.speaker === 'me') && messages.some((message) => message.speaker === 'them')) qualityScore += 20;
  qualityScore = Math.min(100, qualityScore);
  const level: EvidenceLevel = qualityScore >= 80 ? 'high' : qualityScore >= 58 ? 'medium' : qualityScore >= 35 ? 'low' : 'insufficient';
  const notes = [messages.length < 20 ? '消息量较少，关系模式只作初步观察。' : '', coverage < 0.8 ? '部分消息缺少有效时间戳，回复速度和趋势置信度降低。' : '', timed.length && timed.at(-1)!.time - timed[0].time < 7 * 86400000 ? '时间跨度不足一周，长期稳定性无法判断。' : ''].filter(Boolean);
  const relationshipSignals = extractRelationshipSignals(messages, {
    timestampCoverage: Math.round(coverage * 100), sessionCount, myStarts, theirStarts,
    myStartRatio: sessionCount ? Math.round((myStarts / sessionCount) * 100) : 50,
    myAvgReplyMinutes: averageMinutes(myReplies), theirAvgReplyMinutes: averageMinutes(theirReplies),
    replySampleCount: myReplies.length + theirReplies.length, ...runs,
    myRepairStarts, theirRepairStarts, silenceEvents: myRepairStarts + theirRepairStarts,
  }, linguisticFeatures(messages), {
    available: recentTimed.length > 0, messageCount: recentTimed.length,
    myShare: recentTimed.length ? Math.round((recentTimed.filter((item) => item.message.speaker === 'me').length / recentTimed.length) * 100) : 0,
    theirStarts: recentSessions.filter((item) => item.message.speaker === 'them').length,
    theirMessageDensityCv: coefficientOfVariation(dailyValues), volumeChangePercent,
  }, qualityScore);
  const timeInvestment = extractTimeInvestment(messages);
  return {
    conversation: {
      timestampCoverage: Math.round(coverage * 100), sessionCount, myStarts, theirStarts,
      myStartRatio: sessionCount ? Math.round((myStarts / sessionCount) * 100) : 50,
      myAvgReplyMinutes: averageMinutes(myReplies), theirAvgReplyMinutes: averageMinutes(theirReplies),
      replySampleCount: myReplies.length + theirReplies.length, ...runs,
      myRepairStarts, theirRepairStarts, silenceEvents: myRepairStarts + theirRepairStarts,
    },
    linguistic: linguisticFeatures(messages),
    timeInvestment,
    recent: {
      available: recentTimed.length > 0, messageCount: recentTimed.length,
      myShare: recentTimed.length ? Math.round((recentTimed.filter((item) => item.message.speaker === 'me').length / recentTimed.length) * 100) : 0,
      theirStarts: recentSessions.filter((item) => item.message.speaker === 'them').length,
      theirMessageDensityCv: coefficientOfVariation(dailyValues), volumeChangePercent,
    },
    relationshipSignals,
    quality: { level, score: qualityScore, notes },
    evidenceWindows: evidenceWindows(messages, timed),
  };
}
