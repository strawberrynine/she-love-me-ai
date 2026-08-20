import assert from 'node:assert/strict';
import test from 'node:test';
import { applyAffectionRules, detectAffectionRules } from './affection-rules.js';
import { parseChat } from './parser.js';

const baseRelationship = {
  score: 52,
  confidence: 60,
  label: '信号混合，仍需观察',
  summary: '基础分析。',
  dimensions: [
    { key: 'initiative', label: '主动性', score: 50, description: '' },
    { key: 'care', label: '情绪关心', score: 55, description: '' },
    { key: 'response', label: '回复 / 回应', score: 60, description: '' },
    { key: 'stability', label: '稳定性', score: 65, description: '' },
  ],
};

test('intimate address from them produces an explicit high-weight liking signal', () => {
  const messages = parseChat('我：宝宝你在干嘛\n她：亲爱的，我刚到家');
  const rules = detectAffectionRules(messages);
  const result = applyAffectionRules(baseRelationship, messages);
  assert.equal(rules.strongMatches.length, 1);
  assert.equal(result.score, 85);
  assert.match(result.label, /明确喜欢信号/);
});

test('sister-style ambiguous address adds exactly 30 points and caps at 100', () => {
  const messages = parseChat('我：晚上吃什么\n她：姐姐，听你的呀');
  const result = applyAffectionRules(baseRelationship, messages);
  assert.equal(result.score, 82);
  assert.match(result.label, /明显暧昧/);
  assert.equal(applyAffectionRules({ ...baseRelationship, score: 88 }, messages).score, 100);
});

test('male role-style addresses add 30 points only when used as direct address', () => {
  for (const address of ['哥哥，在干嘛', '爸爸抱抱', '大哥哥晚安', '叔叔，想你啦', '弟弟呀', '主人，听你的', '小狗晚安', '贱狗，过来', 'daddy, miss you', '欧巴晚安']) {
    const messages = parseChat(`我：早\n她：${address}`);
    assert.equal(detectAffectionRules(messages).ambiguousMatches.length, 1, address);
    assert.equal(applyAffectionRules(baseRelationship, messages).score, 82, address);
  }
});

test('ordinary family and pet descriptions do not trigger role-address bonus', () => {
  for (const sentence of ['我爸爸今天出差了', '看见一只小狗在楼下', '我哥哥明天回来', '叔叔家的弟弟很可爱']) {
    const messages = parseChat(`我：怎么了\n她：${sentence}`);
    assert.equal(detectAffectionRules(messages).ambiguousMatches.length, 0, sentence);
    assert.equal(applyAffectionRules(baseRelationship, messages).score, 52, sentence);
  }
});
