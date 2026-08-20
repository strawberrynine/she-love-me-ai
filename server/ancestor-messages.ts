import type { ChatMessage, RelationshipResult, RiskResult } from '../shared/types.js';
import { detectAffectionRules } from './affection-rules.js';

type MessageContext = { messages: ChatMessage[]; relationship: RelationshipResult; risk: RiskResult };

const messageLibrary = {
  boundaries: [
    '祖师爷寄语：心动可以慢一点，底线不能退半步；让你反复委屈的人，不值得你反复证明。',
    '祖师爷寄语：真正的喜欢会靠近你，也会尊重你；失去边界的爱，只会先失去自己。',
    '祖师爷寄语：甜言蜜语可以听，红线一步也别让；爱你的人，不会拿你的不安当筹码。',
  ],
  strongAffection: [
    '祖师爷寄语：称呼已经先动了心，下一步就看行动肯不肯跟上；嘴上的偏爱，要落在日常里才算数。',
    '祖师爷寄语：她把亲昵写进称呼，你把从容留在心里；不必猛冲，让这份喜欢自己长出答案。',
    '祖师爷寄语：一句亲昵是心动露了角，持续靠近才是答案有了形；甜可以收下，真心继续看行动。',
  ],
  flirtation: [
    '祖师爷寄语：暧昧不是没有答案，是答案正在路上；她给了台阶，你就大方走近一步。',
    '祖师爷寄语：关系升温时，最迷人的不是反复试探，而是接住暗示后给出一次坦荡的靠近。',
    '祖师爷寄语：她的话里已经有了弯弯绕绕的偏爱，你不必装作看不见，也别急着一次说尽。',
  ],
  mutual: [
    '祖师爷寄语：喜欢从来不只藏在情话里，也藏在有来有往、件件回应；双向奔赴，才最值得期待。',
    '祖师爷寄语：最好的关系不是一个人用力猜，而是两个人自然靠近；你来我往，就是答案的雏形。',
    '祖师爷寄语：能接住情绪，也愿意落实见面，这份心意已经不轻；慢慢走近，比急着定义更动人。',
  ],
  warming: [
    '祖师爷寄语：有些喜欢不说破，却会在每一次主动和回应里发光；别催答案，先让好感继续发生。',
    '祖师爷寄语：心动最好的证据，是今天比昨天多一点靠近；保持真诚，时间会替你筛出答案。',
    '祖师爷寄语：关系正在升温，就别用焦虑抢跑；给她一点余地，也给自己一点笃定。',
  ],
  uncertain: [
    '祖师爷寄语：一两句热情不必封神，一两次冷淡也别判死刑；看长期，看行动，看她是否一次次走向你。',
    '祖师爷寄语：真正适合你的答案，不会只让你猜；再看一程，让主动、回应和兑现替她说话。',
    '祖师爷寄语：别拿一个瞬间定义整段关系；喜欢若是真的，会在时间里留下重复出现的证据。',
  ],
  lowInvestment: [
    '祖师爷寄语：你可以主动一次，但不要独自撑起整段关系；把脚步放慢，看看她会不会向你走来。',
    '祖师爷寄语：爱不是做满一百分等对方批改；留一点力气爱自己，也留一个位置看她的行动。',
    '祖师爷寄语：没有回应的热情要及时收一收；真正想靠近你的人，不舍得让你一直唱独角戏。',
  ],
} as const;

function stablePick<T>(items: readonly T[], messages: ChatMessage[]): T {
  const seed = messages.reduce((sum, message) => sum + [...message.text].reduce((line, character) => line + character.codePointAt(0)!, 0), 0);
  return items[seed % items.length];
}

export function selectAncestorMessage({ messages, relationship, risk }: MessageContext): string {
  const affection = detectAffectionRules(messages);
  const pool = risk.level === 'high'
    ? messageLibrary.boundaries
    : affection.strongMatches.length
      ? messageLibrary.strongAffection
      : affection.ambiguousMatches.length
        ? messageLibrary.flirtation
        : relationship.score >= 78
          ? messageLibrary.mutual
          : relationship.score >= 62
            ? messageLibrary.warming
            : relationship.score < 45
              ? messageLibrary.lowInvestment
              : messageLibrary.uncertain;
  return stablePick(pool, messages);
}

