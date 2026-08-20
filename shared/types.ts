export type Speaker = 'me' | 'them' | 'unknown';
export type EvidenceLevel = 'high' | 'medium' | 'low' | 'insufficient';
export type SignalGrade = 'S' | 'A' | 'B' | 'C' | 'negative';
export type SignalDirection = 'them_to_me' | 'me_to_them' | 'unknown';
export type RelationshipSignalCategory =
  | 'explicit_affection'
  | 'initiative'
  | 'time_investment'
  | 'care'
  | 'emotional_investment'
  | 'relationship_progress'
  | 'dependency_specialness'
  | 'flirtation'
  | 'continuity'
  | 'negative';
export type SignalParticipant = 'me' | 'them' | 'unknown';

export interface ChatMessage {
  id: string;
  speaker: Speaker;
  name: string;
  text: string;
  timestamp?: string;
}

export interface EvidenceAnchor {
  quote: string;
  speaker: string;
  timestamp?: string;
  interpretation: string;
  evidenceLevel: EvidenceLevel;
  signalType?: string;
  signalGrade?: SignalGrade;
  direction?: SignalDirection;
}

export interface BasicMetrics {
  messageCount: number;
  myMessages: number;
  theirMessages: number;
  myShare: number;
  avgMyLength: number;
  avgTheirLength: number;
  questionRate: number;
  responsePairs: number;
  responseRate: number;
  emojiRate: number;
}

export interface ConversationFeatures {
  timestampCoverage: number;
  sessionCount: number;
  myStarts: number;
  theirStarts: number;
  myStartRatio: number;
  myAvgReplyMinutes: number | null;
  theirAvgReplyMinutes: number | null;
  replySampleCount: number;
  myMultiSendEvents: number;
  theirMultiSendEvents: number;
  myMaxConsecutive: number;
  theirMaxConsecutive: number;
  myRepairStarts: number;
  theirRepairStarts: number;
  silenceEvents: number;
}

export interface LinguisticFeatures {
  pronounWe: { me: number; them: number };
  hedging: { me: number; them: number };
  conditional: { me: number; them: number };
  positiveEmotion: { me: number; them: number };
  negativeEmotion: { me: number; them: number };
  careSignals: { me: number; them: number };
  futureMentions: { me: number; them: number };
  concretePlans: { me: number; them: number };
  dismissivePhrases: { me: number; them: number };
}

export interface RecentFeatures {
  available: boolean;
  messageCount: number;
  myShare: number;
  theirStarts: number;
  theirMessageDensityCv: number | null;
  volumeChangePercent: number | null;
}

export interface RelationshipSignalSummary {
  languageIntimacy: number;
  behaviorIntimacy: number;
  initiative: number;
  topicContinuity: number;
  relationshipProgress: number;
  supportiveResponse: number;
  timeInvestment: number;
  userInitiative: number;
  recent7: number;
  recent30: number;
  allHistory: number;
  /** Unified evidence ledger used by deterministic agents and the LLM. */
  signalLedger: RelationshipSignalLedgerEntry[];
  signalDimensions: RelationshipSignalDimensions;
  liking: LikingAssessment;
  positiveSignals: EvidenceAnchor[];
  negativeSignals: EvidenceAnchor[];
  counts: {
    s: number;
    a: number;
    b: number;
    c: number;
    negative: number;
  };
}

export interface RelationshipSignalLedgerEntry {
  signal: string;
  category: RelationshipSignalCategory;
  strength: number;
  confidence: number;
  direction: SignalDirection;
  speaker: SignalParticipant;
  initiator: SignalParticipant;
  responder: SignalParticipant | null;
  spontaneous: boolean;
  reactive: boolean;
  messageId: string;
  quote: string;
  timestamp?: string;
  contextMessageIds: string[];
  context: string;
  reason: string;
  evidenceLevel: EvidenceLevel;
  signalGrade: SignalGrade;
}

export interface RelationshipSignalDimensions {
  initiative: number;
  emotionalExpression: number;
  timeInvestment: number;
  careSupport: number;
  flirtation: number;
  relationshipProgress: number;
  dependencySpecialness: number;
  stability: number;
}

export interface LikingAssessment {
  label: 'high' | 'leaning' | 'mixed' | 'uncertain' | 'low';
  probability: number;
  confidence: number;
  rationale: string;
  evidence: RelationshipSignalLedgerEntry[];
  counterEvidence: RelationshipSignalLedgerEntry[];
}

export interface FeatureSet {
  conversation: ConversationFeatures;
  linguistic: LinguisticFeatures;
  timeInvestment: TimeInvestmentFeatures;
  recent: RecentFeatures;
  relationshipSignals: RelationshipSignalSummary;
  quality: {
    level: EvidenceLevel;
    score: number;
    notes: string[];
  };
  evidenceWindows: {
    origin: ChatMessage[];
    conflict: ChatMessage[];
    recent: ChatMessage[];
    repair: ChatMessage[];
  };
}

/**
 * Real-time contact is a higher-cost behavior than a single sweet message.
 * It is kept separate so the model can weigh calls without treating them as
 * automatic proof of romantic intent.
 */
export interface TimeInvestmentFeatures {
  eventCount: number;
  durationMinutes: number;
  longEventCount: number;
  speakerCounts: { me: number; them: number; unknown: number };
  speakerMinutes: { me: number; them: number; unknown: number };
  evidence: ChatMessage[];
}

export interface FrameworkAssessment {
  value: string | null;
  score?: number;
  evidenceLevel: EvidenceLevel;
  reason: string;
  evidence: EvidenceAnchor[];
  alternativeExplanation?: string;
}

export interface KnowledgeResult {
  methodology: {
    version: string;
    principles: string[];
    sourceAcknowledgement: string;
  };
  symmetry: {
    score: number;
    derivation: string;
    evidenceLevel: EvidenceLevel;
  };
  sternberg: {
    passion: FrameworkAssessment;
    intimacy: FrameworkAssessment;
    commitment: FrameworkAssessment;
    pattern: string;
    triangleScore: number;
    triangleConfidence: number;
  };
  gottman: {
    positiveNegativeRatio: number | null;
    horsemen: Array<{ type: string; count: number; evidence: EvidenceAnchor[] }>;
    repairBalance: string;
    evidenceLevel: EvidenceLevel;
  };
  relationshipStage: FrameworkAssessment;
  communicationCycle: FrameworkAssessment;
  emotionalAvailability: FrameworkAssessment;
  relationshipSignals: RelationshipSignalSummary;
}

export interface EmotionResult {
  overall: 'positive' | 'mixed' | 'neutral' | 'negative';
  score: number;
  trend: 'rising' | 'stable' | 'falling' | 'volatile';
  moments: Array<{ label: string; value: number; note: string }>;
  evidence: string[];
}

export interface InteractionResult {
  score: number;
  initiation: number;
  reciprocity: number;
  continuity: number;
  responsiveness: number;
  patterns: string[];
  evidence: string[];
}

export interface RiskSignal {
  type: string;
  severity: 'low' | 'medium' | 'high';
  status: 'warning' | 'observation';
  evidence: string;
  advice: string;
  evidenceLevel: EvidenceLevel;
  triggerStatus: {
    quantitative: 'met' | 'not_met' | 'insufficient';
    textual: 'met' | 'not_met' | 'insufficient';
    detail: string;
  };
}

export interface RiskResult {
  level: 'low' | 'medium' | 'high';
  score: number;
  signals: RiskSignal[];
}

export interface RelationshipResult {
  score: number;
  confidence: number;
  label: string;
  summary: string;
  dimensions: Array<{ key: string; label: string; score: number; description: string }>;
  signalScores?: Pick<RelationshipSignalSummary, 'languageIntimacy' | 'behaviorIntimacy' | 'initiative' | 'topicContinuity' | 'relationshipProgress' | 'supportiveResponse' | 'recent7' | 'recent30' | 'allHistory'>;
  liking?: LikingAssessment;
  advancedDimensions?: Array<{ key: keyof RelationshipSignalDimensions; label: string; score: number; description: string }>;
  relationshipStage?: string;
}

export interface ReportResult {
  headline: string;
  summary: string;
  keyEvidence: EvidenceAnchor[];
  counterEvidence: EvidenceAnchor[];
  advice: string[];
  nextStep: string;
  limitations: string[];
  disclaimer: string;
  strategistAdvice: string[];
  ancestorMessage: string;
}

export type RelationshipConclusionCategory = 'ordinary_friendship' | 'close_friendship' | 'clear_flirtation' | 'high_probability_romantic_interest' | 'explicit_romantic_intent' | 'uncertain_mixed';

export interface SolEvidenceReference {
  messageId: string;
  quote: string;
  speaker: Speaker;
  timestamp: string;
  interpretation: string;
}

export interface SolRelationshipSignal {
  score: number;
  finding: string;
  evidenceMessageIds: string[];
}

export interface FengchuEvidence {
  messageId: string;
  quote: string;
  speaker: Speaker;
  timestamp: string;
  surfaceBehavior: string;
  hiddenSignal: string;
  whyItMatters: string;
}

export interface FengchuAnalysis {
  coreJudgment: string;
  deepInterpretation: string;
  keyEvidence: FengchuEvidence[];
  insights: string[];
  extraordinaryAdvice: string[];
  highlight: string;
}

export interface SolRelationshipAnalysis {
  conclusion: { category: RelationshipConclusionCategory; probability: number; summary: string; rationale: string };
  liking?: { label: string; probability: number; confidence: number; rationale: string; evidenceMessageIds: string[]; counterEvidenceMessageIds: string[] } | null;
  confidence: number;
  supportingEvidence: SolEvidenceReference[];
  counterEvidence: SolEvidenceReference[];
  relationshipSignals: Record<'initiative' | 'emotionalResponse' | 'flirtation' | 'topicContinuity' | 'selfDisclosure' | 'meetingIntent' | 'investment' | 'timeTrend', SolRelationshipSignal>;
  emotionalTrajectory: { score: number; trend: 'rising' | 'stable' | 'falling' | 'volatile'; phases: Array<{ label: string; score: number; finding: string }> };
  communicationPatterns: string[];
  risks: Array<{ type: string; severity: 'low' | 'medium' | 'high'; finding: string; evidenceMessageIds: string[] }>;
  recommendations: string[];
  fengchu?: FengchuAnalysis;
}

export interface AnalysisEngine {
  provider: 'openai' | 'ollama' | 'deterministic';
  model: string;
  reasoningEffort: string;
  usedFallback: boolean;
  contextMode: 'full' | 'balanced';
  sourceMessageCount: number;
  includedMessageCount: number;
}

export interface AnalysisReport {
  id: string;
  createdAt: string;
  metrics: BasicMetrics;
  features: FeatureSet;
  knowledge: KnowledgeResult;
  emotion: EmotionResult;
  interaction: InteractionResult;
  risk: RiskResult;
  relationship: RelationshipResult;
  report: ReportResult;
  fengchu: FengchuAnalysis;
  deepAnalysis?: SolRelationshipAnalysis;
  engine?: AnalysisEngine;
}

export type WorkflowStep = { id: string; label: string; detail: string };

export const WORKFLOW_STEPS: WorkflowStep[] = [
  { id: 'parser', label: '解析聊天记录', detail: '清洗格式、识别说话人和时间线' },
  { id: 'metrics', label: 'Feature Extraction', detail: '计算全量统计并抽取关键证据窗口' },
  { id: 'knowledge', label: 'Knowledge Layer', detail: '应用关系框架、证据等级与判断规则' },
  { id: 'emotion', label: 'Emotion Agent', detail: '识别情绪、转折点与情绪趋势' },
  { id: 'interaction', label: 'Interaction Agent', detail: '评估双向互动与沟通循环' },
  { id: 'risk', label: 'Risk Agent', detail: '以双阈值检测风险与观察信号' },
  { id: 'relationship', label: 'Relationship Agent', detail: '综合信号并校准结论置信度' },
  { id: 'report', label: 'Report Agent', detail: '生成可追溯的结构化建议' },
];
