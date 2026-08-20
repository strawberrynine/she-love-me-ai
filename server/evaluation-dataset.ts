import type { ChatMessage } from '../shared/types.js';

export interface EvaluationCase {
  id: string;
  title: string;
  expectedStage: 'ordinary_friendship' | 'close_friendship' | 'flirtation' | 'romantic_interest' | 'relationship' | 'cooling_or_unsafe' | 'uncertain';
  expectedLiking: 'high' | 'leaning' | 'mixed' | 'low' | 'uncertain';
  messages: ChatMessage[];
}

const text = (id: string, speaker: 'me' | 'them', timestamp: string, value: string, name = speaker === 'me' ? '我' : '她'): ChatMessage => ({ id, speaker, name, timestamp, text: value });

export const evaluationDataset: EvaluationCase[] = [
  {
    id: 'A', title: '多信号明确喜欢', expectedStage: 'romantic_interest', expectedLiking: 'high',
    messages: [
      text('a-1', 'them', '2026-08-01 09:00', '早安，今天也想见你'),
      text('a-2', 'me', '2026-08-01 09:02', '晚上一起吃饭吗？'),
      text('a-3', 'them', '2026-08-01 09:04', '好呀，我来安排位置'),
      text('a-4', 'them', '2026-08-01 20:00', '通话 53:01'),
      text('a-5', 'them', '2026-08-01 21:00', '你也不要太晚，爱你❤️'),
      text('a-6', 'them', '2026-08-03 18:00', '周末一起去看电影吧'),
    ],
  },
  {
    id: 'B', title: '高频普通朋友', expectedStage: 'ordinary_friendship', expectedLiking: 'low',
    messages: [
      text('b-1', 'me', '2026-08-01 09:00', '早上好，项目怎么样？'), text('b-2', 'them', '2026-08-01 09:05', '还不错，哈哈'),
      text('b-3', 'me', '2026-08-02 12:00', '吃饭了吗？'), text('b-4', 'them', '2026-08-02 12:10', '吃过了，你也记得吃'),
      text('b-5', 'me', '2026-08-03 20:00', '周末有空吗？'), text('b-6', 'them', '2026-08-03 20:05', '有空再说，最近有点忙'),
    ],
  },
  {
    id: 'C', title: '暧昧试探期', expectedStage: 'flirtation', expectedLiking: 'leaning',
    messages: [
      text('c-1', 'them', '2026-08-01 10:00', '姐姐，今天想我了吗？'), text('c-2', 'me', '2026-08-01 10:05', '你猜'),
      text('c-3', 'them', '2026-08-02 19:00', '那下次见面告诉我，别躲'), text('c-4', 'me', '2026-08-02 19:05', '好呀'),
      text('c-5', 'them', '2026-08-05 22:00', '晚安，小朋友'),
    ],
  },
  {
    id: 'D', title: '单方面喜欢', expectedStage: 'uncertain', expectedLiking: 'low',
    messages: [
      text('d-1', 'me', '2026-08-01 09:00', '我想你，爱你'), text('d-2', 'them', '2026-08-01 09:02', '嗯嗯'),
      text('d-3', 'me', '2026-08-02 09:00', '晚上可以通话吗？'), text('d-4', 'them', '2026-08-02 09:01', '哈哈再看吧'),
      text('d-5', 'me', '2026-08-03 09:00', '你吃饭了吗？'), text('d-6', 'them', '2026-08-03 18:00', '刚忙完'),
    ],
  },
  {
    id: 'E', title: '已确认情侣', expectedStage: 'relationship', expectedLiking: 'high',
    messages: [
      text('e-1', 'them', '2026-08-01 08:00', '宝宝早安，晚上视频吗？'), text('e-2', 'me', '2026-08-01 08:02', '好，爱你'),
      text('e-3', 'them', '2026-08-01 20:00', '通话 42:00'), text('e-4', 'them', '2026-08-02 12:00', '记得吃饭，我给你点外卖'),
      text('e-5', 'them', '2026-08-03 18:00', '我们已经在一起了，下个月一起去旅行，票我来买'),
    ],
  },
  {
    id: 'F', title: '关系降温', expectedStage: 'cooling_or_unsafe', expectedLiking: 'low',
    messages: [
      text('f-1', 'them', '2026-07-01 10:00', '想你，周末见'), text('f-2', 'me', '2026-07-01 10:05', '好呀'),
      text('f-3', 'me', '2026-08-01 10:00', '最近见面吗？'), text('f-4', 'them', '2026-08-01 10:01', '最近很忙，不想见面'),
      text('f-5', 'me', '2026-08-03 10:00', '你还好吗？'), text('f-6', 'them', '2026-08-05 22:00', '嗯'),
    ],
  },
  {
    id: 'G', title: '玩梗型爱你', expectedStage: 'ordinary_friendship', expectedLiking: 'low',
    messages: [
      text('g-1', 'them', '2026-08-01 09:00', '哈哈爱你，感谢外卖'), text('g-2', 'me', '2026-08-01 09:02', '不客气'),
      text('g-3', 'them', '2026-08-02 09:00', '爱你个头，开玩笑的'), text('g-4', 'me', '2026-08-02 09:02', '哈哈'),
      text('g-5', 'them', '2026-08-03 09:00', '下次记得AA'),
    ],
  },
  {
    id: 'H', title: '明确拒绝', expectedStage: 'cooling_or_unsafe', expectedLiking: 'low',
    messages: [
      text('h-1', 'me', '2026-08-01 09:00', '我喜欢你'), text('h-2', 'them', '2026-08-01 09:02', '我只把你当朋友'),
      text('h-3', 'me', '2026-08-02 18:00', '那见面聊聊？'), text('h-4', 'them', '2026-08-02 18:02', '别再约我了'),
    ],
  },
];
