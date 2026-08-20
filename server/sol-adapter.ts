import type { ChatMessage, EmotionResult, EvidenceAnchor, FengchuAnalysis, InteractionResult, RelationshipResult, ReportResult, RiskResult, SolEvidenceReference, SolRelationshipAnalysis } from '../shared/types.js';

const conclusionLabels = {
  ordinary_friendship: '普通朋友信号为主', close_friendship: '更接近亲密朋友', clear_flirtation: '存在明显暧昧信号',
  high_probability_romantic_interest: '高概率存在情感兴趣', explicit_romantic_intent: '出现明确恋爱倾向', uncertain_mixed: '信号矛盾，仍需观察',
} as const;

function anchor(item: SolEvidenceReference, evidenceLevel: EvidenceAnchor['evidenceLevel']): EvidenceAnchor {
  return { quote: item.quote, speaker: item.speaker === 'me' ? '我' : item.speaker === 'them' ? '她' : '对方', timestamp: item.timestamp || undefined, interpretation: item.interpretation, evidenceLevel };
}

export function adaptSolAnalysis(analysis: SolRelationshipAnalysis, messages: ChatMessage[], fallbacks: { emotion: EmotionResult; interaction: InteractionResult; risk: RiskResult; relationship: RelationshipResult; report: ReportResult; fengchu: FengchuAnalysis }) {
  const ids = new Map(messages.map((message) => [message.id, message]));
  const evidenceText = (messageIds: string[]) => messageIds.map((id) => ids.get(id)?.text).filter((text): text is string => Boolean(text));
  const signal = analysis.relationshipSignals;
  const interaction: InteractionResult = {
    score: Math.round((signal.initiative.score + signal.emotionalResponse.score + signal.topicContinuity.score + signal.investment.score) / 4),
    initiation: signal.initiative.score,
    reciprocity: signal.emotionalResponse.score,
    continuity: signal.topicContinuity.score,
    responsiveness: Math.round((signal.emotionalResponse.score + signal.topicContinuity.score) / 2),
    patterns: analysis.communicationPatterns.length ? analysis.communicationPatterns.slice(0, 5) : fallbacks.interaction.patterns,
    evidence: evidenceText([...signal.initiative.evidenceMessageIds, ...signal.topicContinuity.evidenceMessageIds, ...signal.emotionalResponse.evidenceMessageIds]).slice(0, 6),
  };
  const emotion: EmotionResult = {
    overall: analysis.emotionalTrajectory.score >= 67 ? 'positive' : analysis.emotionalTrajectory.score <= 38 ? 'negative' : 'mixed',
    score: analysis.emotionalTrajectory.score,
    trend: analysis.emotionalTrajectory.trend,
    moments: analysis.emotionalTrajectory.phases.map((phase) => ({ label: phase.label, value: phase.score, note: phase.finding })),
    evidence: analysis.supportingEvidence.filter((item) => signal.emotionalResponse.evidenceMessageIds.includes(item.messageId)).map((item) => item.quote),
  };
  const risk: RiskResult = {
    level: analysis.risks.some((item) => item.severity === 'high') ? 'high' : analysis.risks.some((item) => item.severity === 'medium') ? 'medium' : 'low',
    score: Math.min(100, analysis.risks.reduce((sum, item) => sum + (item.severity === 'high' ? 35 : item.severity === 'medium' ? 20 : 6), 0)),
    signals: analysis.risks.map((item) => ({ type: item.type, severity: item.severity, status: item.severity === 'low' ? 'observation' : 'warning', evidence: evidenceText(item.evidenceMessageIds)[0] ?? item.finding, advice: analysis.recommendations[0] ?? fallbacks.report.nextStep, evidenceLevel: item.evidenceMessageIds.length ? 'high' : 'low', triggerStatus: { quantitative: 'insufficient', textual: item.evidenceMessageIds.length ? 'met' : 'insufficient', detail: item.finding } })),
  };
  const relationship: RelationshipResult = {
    score: analysis.conclusion.probability,
    confidence: analysis.confidence,
    label: conclusionLabels[analysis.conclusion.category],
    summary: `${analysis.conclusion.summary} ${analysis.conclusion.rationale}`.trim(),
    dimensions: [
      { key: 'initiative', label: '主动性', score: signal.initiative.score, description: signal.initiative.finding },
      { key: 'care', label: '情绪关心', score: signal.emotionalResponse.score, description: signal.emotionalResponse.finding },
      { key: 'response', label: '回复 / 回应', score: Math.round((signal.topicContinuity.score + signal.selfDisclosure.score) / 2), description: signal.topicContinuity.finding },
      { key: 'stability', label: '稳定性', score: signal.timeTrend.score, description: signal.timeTrend.finding },
    ],
    signalScores: fallbacks.relationship.signalScores,
    liking: {
      ...(fallbacks.relationship.liking ?? { label: 'uncertain' as const, probability: 50, confidence: analysis.confidence, rationale: analysis.conclusion.rationale, evidence: [], counterEvidence: [] }),
      label: analysis.liking?.label === 'high' || analysis.conclusion.probability >= 78 ? 'high' : analysis.liking?.label === 'leaning' || analysis.conclusion.probability >= 62 ? 'leaning' : analysis.conclusion.probability >= 45 ? 'mixed' : analysis.confidence < 45 ? 'uncertain' : 'low',
      probability: analysis.liking?.probability ?? analysis.conclusion.probability,
      confidence: analysis.liking?.confidence ?? analysis.confidence,
      rationale: analysis.liking?.rationale ?? analysis.conclusion.rationale,
      evidence: analysis.liking ? analysis.liking.evidenceMessageIds.flatMap((id) => fallbacks.relationship.liking?.evidence.filter((entry) => entry.messageId === id) ?? []) : fallbacks.relationship.liking?.evidence ?? [],
      counterEvidence: analysis.liking ? analysis.liking.counterEvidenceMessageIds.flatMap((id) => fallbacks.relationship.liking?.counterEvidence.filter((entry) => entry.messageId === id) ?? []) : fallbacks.relationship.liking?.counterEvidence ?? [],
    },
    advancedDimensions: fallbacks.relationship.advancedDimensions,
    relationshipStage: fallbacks.relationship.relationshipStage,
  };
  const report: ReportResult = {
    ...fallbacks.report,
    headline: analysis.conclusion.summary,
    summary: analysis.conclusion.rationale,
    keyEvidence: analysis.supportingEvidence.slice(0, 6).map((item) => anchor(item, analysis.confidence >= 70 ? 'high' : 'medium')),
    counterEvidence: analysis.counterEvidence.slice(0, 4).map((item) => anchor(item, 'medium')),
    advice: analysis.recommendations.slice(0, 5),
    strategistAdvice: analysis.recommendations.slice(0, 2),
    nextStep: analysis.recommendations[0] ?? fallbacks.report.nextStep,
  };
  return { emotion, interaction, risk, relationship, report, fengchu: analysis.fengchu ?? fallbacks.fengchu };
}
