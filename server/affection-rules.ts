import type { ChatMessage, RelationshipResult } from '../shared/types.js';

const strongTerms = ['宝宝', '宝贝', '亲爱的', 'honey', '小朋友', '小孩', '老婆', '老公'];
const flirtatiousRoleTerms = [
  '小妹妹', '妹妹', '小姐姐', '姐姐',
  '大哥哥', '小哥哥', '哥哥', '小弟弟', '弟弟',
  '爸爸', '爹地', 'daddy', '叔叔', '大叔',
  '主人', '小狗狗', '小狗', '狗狗', '修勾', '贱狗', '欧巴', 'oppa',
];
const addressLead = '(?:^|[，,。！？!?\\s~～])';
const addressTail = '(?:$|[，,。！？!?\\s~～]|呀|啊|呢|哦|啦|喔|嘛|么|早|晚安|在吗|干嘛|想你|抱抱|亲亲|睡了吗|吃了吗|陪我|听话)';
const flirtatiousAddress = new RegExp(`${addressLead}(${flirtatiousRoleTerms.join('|')})(?=${addressTail})`, 'i');

function isDirectAddress(text: string, term: string): boolean {
  if (term === 'honey') return /(?:^|[，,。！？!?\s~～])honey(?:$|[，,。！？!?\s~～]|[a-z])/i.test(text);
  return text.startsWith(term)
    || text.endsWith(term)
    || new RegExp(`[，,。！？!?~～]${term}|${term}[，,。！？!?~～]`).test(text);
}

export interface AffectionRuleResult {
  strongMatches: ChatMessage[];
  ambiguousMatches: ChatMessage[];
  scoreBonus: number;
  minimumScore?: number;
}

export function detectAffectionRules(messages: ChatMessage[]): AffectionRuleResult {
  const theirMessages = messages.filter((message) => message.speaker === 'them');
  const strongMatches = theirMessages.filter((message) => strongTerms.some((term) => isDirectAddress(message.text, term)));
  const ambiguousMatches = theirMessages.filter((message) => flirtatiousAddress.test(message.text));
  return {
    strongMatches,
    ambiguousMatches,
    scoreBonus: ambiguousMatches.length ? 30 : 0,
    minimumScore: strongMatches.length ? 85 : undefined,
  };
}

export function applyAffectionRules(relationship: RelationshipResult, messages: ChatMessage[]): RelationshipResult {
  const rules = detectAffectionRules(messages);
  const withBonus = Math.min(100, relationship.score + rules.scoreBonus);
  const score = Math.max(withBonus, rules.minimumScore ?? 0);
  if (score === relationship.score && !rules.strongMatches.length) return relationship;

  const ruleSummary = rules.strongMatches.length
    ? `对方使用了“${strongTerms.find((term) => rules.strongMatches.some((message) => isDirectAddress(message.text, term))) ?? '亲密称呼'}”，按产品规则判定为明确喜欢信号。`
    : '对方使用了直接暧昧或角色称呼，关系信号分按产品规则增加 30 分。';
  return {
    ...relationship,
    score,
    label: rules.strongMatches.length ? '亲密称呼释放了明确喜欢信号' : score >= 75 ? '存在明显暧昧信号' : relationship.label,
    summary: `${ruleSummary}${relationship.summary}`,
    dimensions: relationship.dimensions.map((dimension) => (
      dimension.key === 'care'
        ? { ...dimension, score: Math.max(dimension.score, rules.strongMatches.length ? 88 : Math.min(100, dimension.score + rules.scoreBonus)) }
        : dimension
    )),
  };
}
