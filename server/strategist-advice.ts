import type { ChatMessage, FeatureSet, InteractionResult, RelationshipResult, RiskResult } from '../shared/types.js';
import { detectAffectionRules } from './affection-rules.js';

type AdviceContext = {
  messages: ChatMessage[];
  relationship: RelationshipResult;
  interaction: InteractionResult;
  risk: RiskResult;
  features: FeatureSet;
};

type AdvicePair = readonly [string, string];

const adviceLibrary: Record<string, readonly AdvicePair[]> = {
  boundaries: [
    ['先别研究怎么让她更喜欢你，先确认她是否尊重你。挑一个具体的不舒服点说清楚边界，看她是理解、调整，还是继续试探。', '甜的时候可以享受，冒犯的时候必须叫停。真正值得推进的关系，不会要求你拿委屈换亲密。'],
    ['暂停加码投入，把风险信号对应的原话和行为单独记下来。只看她下一次是否尊重你的明确请求，不用替她找理由。', '关系可以慢慢确认，安全感不能靠忍出来。若控制、威胁或贬低重复出现，优先拉开距离并联系可信任的人。'],
  ],
  strongAffection: [
    ['她已经用亲密称呼递出了明显信号，你可以顺着氛围给一次轻松而具体的邀约，例如“周六一起吃那家店？”让暧昧自然落地。', '别急着追问“你到底喜不喜欢我”。观察她是否主动确认时间、参与安排并在见面后继续联系，行动会替称呼盖章。'],
    ['接住她的亲昵，但不要突然把关系推到终局。用同等温度回应，再创造一次只有你们两个人的具体见面机会。', '甜称呼是开场，不是全部答案。接下来重点看三件事：主动找你、愿意见你、说好的事情会做到。'],
  ],
  flirtation: [
    ['她用角色称呼给了暧昧台阶，你可以回一个轻松的小梗，再顺势提出具体邀约；有来有往，比突然表白更容易让关系升温。', '把暧昧从屏幕带到现实：给出时间、地点和活动，让她有明确回应空间。愿意共同安排，就是比称呼更硬的加分项。'],
    ['不用装作没听懂，也别一次把话说满。轻轻接住称呼，增加一点专属感，然后观察她会不会继续主动制造你们之间的默契。', '下一步只推进半格：从聊天暧昧变成一次单独见面。她若积极确认细节，你再继续加温；她若回避，就保持从容。'],
  ],
  mutual: [
    ['你们已经有明显的双向投入，现在最有效的不是继续猜，而是增加高质量相处。约一次有明确时间的见面，让共同经历替聊天升温。', '保持现在的节奏：她主动时认真接住，你想她时坦荡表达。稳定的双向回应，比任何套路都更容易把好感变成关系。'],
    ['信号已经够积极，可以从“聊得很好”走向“相处得舒服”。选择一个你们都感兴趣的活动，给关系制造自然升级的场景。', '少做测试题，多给真实反馈。见面后直接说“今天和你在一起很开心”，既表达好感，也给她继续靠近的空间。'],
  ],
  warming: [
    ['目前有好感，但还没到需要摊牌的程度。继续创造轻松的小互动，同时看她会不会主动延长话题、分享日常和兑现计划。', '不要靠连续发消息维持热度。留出一点自然空白，看看她是否会回来找你；主动性比秒回更能说明投入。'],
    ['关系在升温期，最好的推进是“具体但不沉重”。提出一个容易答应的小邀约，观察她是否愿意共同选时间和地点。', '把注意力放在重复出现的行为上：主动、关心、见面、兑现。三项能稳定出现，再考虑更明确地表达喜欢。'],
  ],
  imbalanced: [
    ['先把主动频率降到和她差不多，不消失，也不追着证明。给关系一个真实的观察窗口，看她会不会主动把联系接回来。', '别用更多付出去换一个答案。下一周只看她有没有主动发起、认真回应和落实见面；没有行动，就把精力收回自己身上。'],
    ['你可以真诚，但不必包办整段关系。停止连续追问和补话，让对方也承担推进关系的那一半。', '把“她今天回得热不热”换成“她这一段时间有没有稳定靠近”。降低单句权重，才能看清真正的投入。'],
  ],
  uncertain: [
    ['现在最需要的不是猜结论，而是制造一个可验证的小机会。发出一次具体邀约，然后看她是否明确回应并参与安排。', '先观察一到两周的重复信号：谁主动、是否关心、愿不愿意见面、计划有没有兑现。稳定出现两三项，再升级投入。'],
    ['别拿一句热情当告白，也别拿一次冷淡当拒绝。把判断放回连续行为，让时间替你过滤偶然情绪。', '用低压力方式表达一点好感，例如“和你聊天挺开心的”。她若接住并继续靠近，再走下一步；若含糊回避，就保持边界。'],
  ],
};

function stablePick<T>(items: readonly T[], messages: ChatMessage[]): T {
  const seed = messages.reduce((sum, message) => sum + [...message.text].reduce((line, character) => line + character.codePointAt(0)!, 0), 0);
  return items[seed % items.length];
}

export function selectStrategistAdvice({ messages, relationship, interaction, risk, features }: AdviceContext): string[] {
  const affection = detectAffectionRules(messages);
  const imbalanced = interaction.initiation < 40 || features.conversation.myStartRatio > 70 || features.recent.myShare > 72;
  const pool = risk.level === 'high'
    ? adviceLibrary.boundaries
    : affection.strongMatches.length
      ? adviceLibrary.strongAffection
      : affection.ambiguousMatches.length
        ? adviceLibrary.flirtation
        : imbalanced
          ? adviceLibrary.imbalanced
          : relationship.score >= 78
            ? adviceLibrary.mutual
            : relationship.score >= 60
              ? adviceLibrary.warming
              : adviceLibrary.uncertain;
  return [...stablePick(pool, messages)];
}
