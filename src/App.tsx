import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, BarChart3, BrainCircuit, Check, CircleAlert, FileText, Image, LoaderCircle, MessageCircle, PawPrint, Play, RotateCcw, Scale, ShieldCheck, Sparkles, Upload } from 'lucide-react';
import { AnalysisReport, WORKFLOW_STEPS } from '../shared/types';
import ScreenshotInput from './ScreenshotInput';

const DEMO_CHAT = `2026-07-08 09:12 我：早呀，今天要开会吗？
2026-07-08 09:18 她：早！十点有一个，可能会有点忙。你呢？
2026-07-08 09:23 我：我下午才开，晚上一起吃饭？
2026-07-08 09:25 她：好呀，我想吃上次那家面，六点半可以吗？
2026-07-08 12:10 她：午饭吃了吗？别又忙到忘记吃饭。
2026-07-08 12:32 我：刚准备去，谢谢你提醒。下午加油！
2026-07-08 18:02 她：我到啦，在门口等你 😊
2026-07-08 18:07 我：收到，马上来。
2026-07-08 21:45 她：今天很开心，晚安，明天见。`;

type StepState = 'idle' | 'running' | 'complete';

function ScoreRing({ score }: { score: number }) {
  return <div className="score-ring" style={{ '--progress': `${score}%` } as React.CSSProperties}><div className="score-ring__inner"><strong>{score}</strong><span>/ 100</span></div></div>;
}

function App() {
  const [text, setText] = useState('');
  const [screenshotText, setScreenshotText] = useState('');
  const [report, setReport] = useState<AnalysisReport | null>(null);
  const [stepStates, setStepStates] = useState<Record<string, StepState>>({});
  const [activeView, setActiveView] = useState<'home' | 'analysis' | 'result'>('home');
  const [error, setError] = useState('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [inputFormat, setInputFormat] = useState<string>();
  const [inputMode, setInputMode] = useState<'text' | 'screenshots'>('text');

  const analysisText = inputMode === 'screenshots' ? screenshotText : text;
  const hasInput = analysisText.trim().length > 0;
  const progress = useMemo(() => WORKFLOW_STEPS.filter((step) => stepStates[step.id] === 'complete').length, [stepStates]);

  useEffect(() => {
    window.history.scrollRestoration = 'manual';
    const scrollToTop = () => window.scrollTo({ top: 0, behavior: 'auto' });
    scrollToTop();
    const frameId = window.requestAnimationFrame(scrollToTop);
    const timeoutId = window.setTimeout(scrollToTop, 80);
    return () => {
      window.cancelAnimationFrame(frameId);
      window.clearTimeout(timeoutId);
    };
  }, [activeView]);

  const startDemo = () => { setInputFormat(undefined); setInputMode('text'); setText(DEMO_CHAT); setActiveView('analysis'); setError(''); };
  const reset = () => { setInputFormat(undefined); setInputMode('text'); setText(''); setScreenshotText(''); setReport(null); setStepStates({}); setActiveView('home'); setError(''); };

  const analyze = async (textOverride?: string) => {
    const requestedText = textOverride?.trim() || analysisText;
    if (!requestedText.trim() || isAnalyzing) return;
    setIsAnalyzing(true); setError(''); setReport(null); setActiveView('analysis'); setStepStates({});
    try {
      const response = await fetch('/api/analyze', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: requestedText, format: inputMode === 'text' && !textOverride ? inputFormat : undefined, source: inputMode === 'screenshots' ? 'screenshot' : inputFormat ? 'file' : 'text' }) });
      if (!response.ok || !response.body) throw new Error((await response.json()).error ?? '分析请求失败，请稍后重试。');
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { value, done } = await reader.read();
        buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
        const lines = buffer.split('\n'); buffer = lines.pop() ?? '';
        lines.filter(Boolean).forEach((line) => {
          const event = JSON.parse(line) as { type: string; step?: string; report?: AnalysisReport };
          if (event.type === 'step' && event.step) setStepStates((current) => ({ ...current, [event.step!]: 'complete' }));
          if (event.type === 'result' && event.report) { setReport(event.report); setActiveView('result'); }
          if (event.type === 'error') throw new Error('分析过程中出现错误，请稍后重试。');
        });
        if (done) break;
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : '分析失败，请检查后端服务。'); }
    finally { setIsAnalyzing(false); }
  };

  const upload = async (file: File) => {
    const fileText = await file.text();
    const extension = file.name.split('.').pop()?.toLowerCase();
    setInputFormat(extension); setText(fileText); setActiveView('analysis'); setError('');
  };

  return <div className="app-shell">
    <header className="topbar">
      <button className="brand" onClick={reset} aria-label="返回首页"><span className="brand-mark"><PawPrint size={17} fill="currentColor" /></span><span>她爱你吗？</span><small>三猫关系研究所</small></button>
      <div className="topbar__right"><span className="status-dot" /> <span>Sol 深度分析 · 本地降级</span><a href="https://github.com" target="_blank" rel="noreferrer">GitHub <ArrowRight size={14} /></a></div>
    </header>

    {activeView === 'home' && <main className="home-view">
      <section className="hero">
        <div className="hero__visual">
          <img src="/three-cat-team.png" alt="卧龙、太白与凤雏组成的三猫专业团队" />
          <div className="hero__team-badge"><PawPrint size={15} fill="currentColor" /><span>三猫专业团队</span><small>关系分析值守中</small></div>
        </div>
        <div className="hero__copy"><p className="eyebrow"><Sparkles size={14} /> AI RELATIONSHIP AGENT</p><h1>她爱你吗？</h1><p className="hero__subtitle">AI 帮你从聊天记录里找到答案</p><p className="hero__body">把模糊的心动，拆成可以观察的行为信号。客观特征、专业知识层与 GPT-5.6 Sol 协作分析完整上下文、关系信号和反向证据。</p><div className="hero__actions"><button className="button button--primary" onClick={() => setActiveView('analysis')}>开始分析 <ArrowRight size={17} /></button><button className="button button--ghost" onClick={startDemo}><Play size={15} fill="currentColor" /> 体验 Demo</button></div><p className="privacy-note"><ShieldCheck size={15} /> 不持久化聊天 · API Key 仅在服务端</p></div>
      </section>
      <section className="workflow-strip"><span className="cat-avatar cat-avatar--fengchu" aria-hidden="true" /><div className="workflow-strip__intro"><b>凤雏值守</b><small>陪你看完整段关系</small></div><div><span className="strip-number">01</span><b>解析</b><small>清洗聊天记录</small></div><ArrowRight size={16} /><div><span className="strip-number">02</span><b>理解</b><small>多 Agent 协作</small></div><ArrowRight size={16} /><div><span className="strip-number">03</span><b>洞察</b><small>结构化报告</small></div></section>
      <section className="home-section"><div><p className="eyebrow">WHY THIS PROJECT</p><h2>把“她爱不爱我”变成一个可解释的 AI Workflow</h2></div><div className="feature-grid"><article><span className="feature-icon"><BarChart3 size={18} /></span><h3>程序算事实</h3><p>会话发起、回复时间、修复重启和近期趋势由工具层计算。</p></article><article><span className="feature-icon"><BrainCircuit size={18} /></span><h3>知识层约束推理</h3><p>对称性、Sternberg、Gottman 和风险双阈值先形成专业分析底座。</p></article><article><span className="feature-icon"><FileText size={18} /></span><h3>证据可追溯</h3><p>每个结论绑定原话、时间戳和证据等级，证据不足时明确留白。</p></article></div></section>
    </main>}

    {activeView === 'analysis' && <main className="analysis-view"><div className="page-heading"><div className="page-heading__identity"><span className="cat-avatar cat-avatar--fengchu" aria-hidden="true" /><div><p className="eyebrow">ANALYSIS WORKSPACE</p><h2>把聊天记录交给 Agent</h2><p>直接粘贴文字、上传文件，或添加聊天截图后一键分析。建议至少提供 10 条消息。</p></div></div><button className="icon-button" onClick={reset} title="重新开始"><RotateCcw size={18} /></button></div><div className="analysis-layout"><section className="input-panel"><div className="panel-title"><span>聊天记录</span><button className="text-button" onClick={startDemo}>使用 Demo 数据</button></div><div className="input-mode-tabs" role="tablist" aria-label="输入方式"><button type="button" role="tab" aria-selected={inputMode === 'text'} className={inputMode === 'text' ? 'is-active' : ''} onClick={() => { setInputMode('text'); setError(''); }}><FileText size={15} /> 文本 / 文件</button><button type="button" role="tab" aria-selected={inputMode === 'screenshots'} className={inputMode === 'screenshots' ? 'is-active' : ''} onClick={() => { setInputMode('screenshots'); setError(''); }}><Image size={15} /> 聊天截图 <small>一键分析</small></button></div><div hidden={inputMode !== 'text'}><textarea value={text} onChange={(event) => { setInputFormat(undefined); setText(event.target.value); }} placeholder={'她：今天还好吗？\n我：有点忙，但看到你的消息就好多了。'} /><div className="text-upload-row"><label className="upload-button"><Upload size={16} /> 上传 TXT / CSV / JSON<input type="file" accept=".txt,.csv,.json" onChange={(event) => event.target.files?.[0] && upload(event.target.files[0])} /></label></div></div><div hidden={inputMode !== 'screenshots'}><ScreenshotInput text={screenshotText} onTextChange={setScreenshotText} onAnalyze={analyze} onError={setError} disabled={isAnalyzing} /></div>{inputMode === 'text' && <div className="input-footer"><span>{analysisText.length.toLocaleString()} 字符</span><button className="button button--primary button--small" disabled={!hasInput || isAnalyzing} onClick={() => void analyze()}>{isAnalyzing ? <><LoaderCircle className="spin" size={15} /> 分析中</> : <>开始分析 <ArrowRight size={15} /></>}</button></div>}{error && <p className="error-message"><CircleAlert size={15} /> {error}</p>}<p className="panel-hint"><ShieldCheck size={14} /> {inputMode === 'screenshots' ? '截图在浏览器内读取；启用 Sol 时仅整理后的文字与指标由后端发送给 OpenAI，图片不会上传。' : '启用 Sol 时文字由后端发送给 OpenAI；API Key 不会暴露给浏览器。请勿提交无关敏感信息。'}</p></section><Workflow states={stepStates} progress={progress} isAnalyzing={isAnalyzing} /></div></main>}

    {activeView === 'result' && report && <ResultView report={report} onReset={reset} />}
    <footer><span>她爱你吗？ · AI Relationship Agent</span><span>行为信号，不是确定答案</span></footer>
  </div>;
}

function Workflow({ states, progress, isAnalyzing }: { states: Record<string, StepState>; progress: number; isAnalyzing: boolean }) {
  return <aside className="workflow-panel"><div className="workflow-panel__head"><div className="workflow-panel__guide"><span className="cat-avatar cat-avatar--fengchu" aria-hidden="true" /><div><p className="eyebrow">AGENT WORKFLOW</p><h3>凤雏为你盯进度</h3></div></div><span className="progress-count">{progress}/{WORKFLOW_STEPS.length}</span></div><div className="workflow-list">{WORKFLOW_STEPS.map((step, index) => { const state = states[step.id] ?? (isAnalyzing && index === progress ? 'running' : 'idle'); return <div className={`workflow-step workflow-step--${state}`} key={step.id}><span className="workflow-step__icon">{state === 'complete' ? <Check size={14} /> : state === 'running' ? <LoaderCircle className="spin" size={14} /> : <span>{String(index + 1).padStart(2, '0')}</span>}</span><div><b>{step.label}</b><small>{step.detail}</small></div></div>; })}</div><div className="workflow-note"><span className="status-dot" /> 每一步都会产生可验证的中间结果</div></aside>;
}

function ResultView({ report, onReset }: { report: AnalysisReport; onReset: () => void }) {
  const { relationship, interaction, risk, metrics, features, knowledge, report: detail } = report;
  const visibleEvidence = detail.keyEvidence.filter((item) => item.quote.trim().length >= 2 && !item.quote.includes('�') && !item.quote.includes('【请校对】'));
  const levelLabel = { high: '高', medium: '中', low: '低', insufficient: '不足' } as const;
  return <main className="result-view">
    <div className="page-heading"><div><p className="eyebrow">ANALYSIS REPORT · {new Date(report.createdAt).toLocaleDateString('zh-CN')}</p><h2>{detail.headline}</h2><p>{detail.summary}</p>{report.engine && <p className="engine-note"><BrainCircuit size={13} /> {report.engine.provider === 'openai' ? `${report.engine.model} · reasoning ${report.engine.reasoningEffort} · ${report.engine.contextMode === 'full' ? '完整上下文' : '平衡时间线'} ${report.engine.includedMessageCount}/${report.engine.sourceMessageCount}` : report.engine.provider === 'ollama' ? `本地 Ollama · ${report.engine.model}` : `本地规则引擎 · ${report.engine.model}`}</p>}</div><button className="button button--ghost" onClick={onReset}><RotateCcw size={15} /> 新分析</button></div>
    <section className="result-hero"><div className="result-hero__score"><ScoreRing score={relationship.score} /><div><p className="eyebrow">RELATIONSHIP SIGNAL SCORE</p><h3>{relationship.label}</h3><p>结论置信度 {relationship.confidence}% · 证据质量 {levelLabel[features.quality.level]} · {metrics.messageCount} 条消息</p></div></div><div className="result-hero__metrics"><Metric label="主动性" value={relationship.signalScores?.initiative ?? dimensionScore(relationship, 'initiative', interaction.initiation)} /><Metric label="情绪关心" value={relationship.signalScores?.behaviorIntimacy ?? dimensionScore(relationship, 'care', 0)} /><Metric label="回应质量" value={interaction.responsiveness} /><Metric label="稳定性" value={dimensionScore(relationship, 'stability', 0)} /></div></section>
    <div className="result-grid">
      <section className="result-card result-card--wide chemistry-card"><div className="card-heading"><div><p className="eyebrow">CHEMISTRY TRIANGLE</p><h3>心动三维</h3></div><span className={`evidence-level evidence-level--${features.quality.level}`}>基于对方信号</span></div><SternbergTriangle knowledge={knowledge} levelLabel={levelLabel} /></section>
      <section className="result-card"><div className="card-heading"><div><p className="eyebrow">INTERACTION AGENT</p><h3>沟通模式</h3></div></div><ul className="pattern-list">{interaction.patterns.map((pattern) => <li key={pattern}><Check size={15} />{pattern}</li>)}</ul><div className="mini-stats"><span>会话发起 <b>{features.conversation.myStarts}:{features.conversation.theirStarts}</b></span><span>有效回复 <b>{features.conversation.replySampleCount}</b></span><span>修复重启 <b>{features.conversation.myRepairStarts}:{features.conversation.theirRepairStarts}</b></span></div><div className="signal-score-grid"><span>语言亲密 <b>{features.relationshipSignals.languageIntimacy}</b></span><span>行为亲密 <b>{features.relationshipSignals.behaviorIntimacy}</b></span><span>话题延续 <b>{features.relationshipSignals.topicContinuity}</b></span><span>关系推进 <b>{features.relationshipSignals.relationshipProgress}</b></span><span>近 7 天 <b>{features.relationshipSignals.recent7}</b></span><span>近 30 天 <b>{features.relationshipSignals.recent30}</b></span></div></section>
      <section className="result-card"><div className="card-heading"><div><p className="eyebrow">RISK AGENT</p><h3>风险信号</h3></div><span className={`risk-badge risk-badge--${risk.level}`}>{risk.level === 'low' ? '低风险' : risk.level === 'medium' ? '需留意' : '高风险'}</span></div>{risk.signals.length ? <ul className="risk-list">{risk.signals.map((signal) => <li className={`risk-item risk-item--${signal.status}`} key={signal.type}><CircleAlert size={15} /><div><div className="risk-title"><b>{signal.type}</b><small>{signal.status === 'warning' ? '双阈值预警' : '观察提示'}</small></div><span>{signal.evidence}</span><em>{signal.triggerStatus.detail}</em></div></li>)}</ul> : <div className="empty-state"><ShieldCheck size={20} /><span>暂未检测到明显风险信号</span></div>}</section>
      <section className="result-card result-card--wide evidence-card"><div className="card-heading"><div><p className="eyebrow">TRACEABLE EVIDENCE</p><h3>关键聊天证据</h3></div><span className="evidence-count">{visibleEvidence.length} 条</span></div>{visibleEvidence.length ? <div className="evidence-list">{visibleEvidence.map((item) => <blockquote key={`${item.timestamp}-${item.quote}`}><MessageCircle size={16} /><div><p>“{item.quote}”</p><footer>{item.speaker}{item.timestamp ? ` · ${item.timestamp}` : ''}<span className={`evidence-level evidence-level--${item.evidenceLevel}`}>证据 {levelLabel[item.evidenceLevel]}</span>{item.signalGrade && <span className="evidence-level evidence-level--high">信号 {item.signalGrade}级</span>}{item.signalType && <span className="evidence-type">{item.signalType}</span>}<br />{item.interpretation}</footer></div></blockquote>)}</div> : <div className="empty-state"><ShieldCheck size={20} /><span>本次没有足够可靠的聊天原话可作为关键证据。</span></div>}</section>
      {detail.counterEvidence.length > 0 && <section className="result-card result-card--wide counter-evidence-card"><div className="card-heading"><div><p className="eyebrow">COUNTER EVIDENCE</p><h3>反向证据</h3></div><span className="evidence-count">{detail.counterEvidence.length} 条</span></div><div className="evidence-list">{detail.counterEvidence.map((item) => <blockquote key={`counter-${item.timestamp}-${item.quote}`}><Scale size={16} /><div><p>“{item.quote}”</p><footer>{item.speaker}{item.timestamp ? ` · ${item.timestamp}` : ''}<br />{item.interpretation}</footer></div></blockquote>)}</div></section>}
      <FengchuView analysis={report.fengchu} />
      <section className="advice-panel advice-panel--focused"><div className="advice-columns"><div className="advice-column"><div className="advice-column__title"><span className="cat-avatar cat-avatar--wolong" aria-hidden="true" /><div><span>卧龙</span><b>军师建议</b></div><small>按本次关系情境匹配</small></div><ul>{detail.strategistAdvice.map((advice) => <li key={advice}><ArrowRight size={15} />{advice}</li>)}</ul></div><div className="advice-column advice-column--ancestor"><div className="advice-column__title"><span className="cat-avatar cat-avatar--taibai" aria-hidden="true" /><div><span>太白</span><b>祖师爷寄语</b></div><small>反思性提示，不是命定结论</small></div><p className="ancestor-message">{detail.ancestorMessage}</p></div></div></section>
    </div>
  </main>;
}

function FengchuView({ analysis }: { analysis: AnalysisReport['fengchu'] }) {
  return <section className="result-card result-card--wide fengchu-card">
    <div className="fengchu-card__heading"><div className="fengchu-card__identity"><span className="cat-avatar cat-avatar--fengchu" aria-hidden="true" /><div><p className="eyebrow">ADVANCED RELATIONSHIP REASONING</p><h3>凤雏分析</h3><small>从真实证据推到潜台词，再落到可验证的下一步</small></div></div><span className="fengchu-card__badge">证据加权 · 500 字内</span></div>
    <div className="fengchu-overview"><section><h4>一、关系核心判断</h4><p>{analysis.coreJudgment}</p></section><section><h4>二、深层解读</h4><p>{analysis.deepInterpretation}</p></section></div>
    <section className="fengchu-section"><h4>三、关键证据</h4><div className="fengchu-evidence-list">{analysis.keyEvidence.map((item) => <article className="fengchu-evidence" key={`${item.messageId}-${item.quote}`}><div className="fengchu-evidence__meta"><span>{item.speaker === 'me' ? '我' : item.speaker === 'them' ? '对方' : '未知'}</span>{item.timestamp && <time>{item.timestamp}</time>}</div><p className="fengchu-evidence__quote">“{item.quote}”</p><div className="fengchu-evidence__trail"><span><b>表层行为</b>{item.surfaceBehavior}</span><ArrowRight size={14} /><span><b>隐藏信号</b>{item.hiddenSignal}</span><ArrowRight size={14} /><span><b>为什么重要</b>{item.whyItMatters}</span></div></article>)}</div></section>
    <div className="fengchu-actions"><section><h4>四、凤雏洞察</h4><ul>{analysis.insights.map((insight) => <li key={insight}><Sparkles size={14} />{insight}</li>)}</ul></section><section><h4>五、非凡建议</h4><ul>{analysis.extraordinaryAdvice.map((advice) => <li key={advice}><ArrowRight size={14} />{advice}</li>)}</ul></section></div>
    <section className="fengchu-highlight"><span>六、Highlight</span><strong>{analysis.highlight}</strong></section>
  </section>;
}

function SternbergTriangle({ knowledge, levelLabel }: { knowledge: AnalysisReport['knowledge']; levelLabel: Record<string, string> }) {
  const points = [
    { key: 'passion', label: '激情', value: knowledge.sternberg.passion.score ?? 0, assessment: knowledge.sternberg.passion, className: 'sternberg-point--top' },
    { key: 'intimacy', label: '亲密', value: knowledge.sternberg.intimacy.score ?? 0, assessment: knowledge.sternberg.intimacy, className: 'sternberg-point--left' },
    { key: 'commitment', label: '承诺', value: knowledge.sternberg.commitment.score ?? 0, assessment: knowledge.sternberg.commitment, className: 'sternberg-point--right' },
  ];
  const [passion, intimacy, commitment] = points.map((point) => point.value / 100);
  const dataPolygon = `${50}% ${62 - 54 * passion}%, ${50 - 40 * intimacy}% ${62 + 28 * intimacy}%, ${50 + 40 * commitment}% ${62 + 28 * commitment}%`;
  return <div className="sternberg-visual"><div className="sternberg-visual__heading"><div><span>亲密 · 心动 · 未来投入</span><b>{knowledge.sternberg.pattern}</b></div><strong>{knowledge.sternberg.triangleScore}<em>/100</em></strong><small>信号覆盖 {knowledge.sternberg.triangleConfidence}%</small></div><div className="sternberg-triangle"><div className="sternberg-triangle__shape" /><div className="sternberg-triangle__data" style={{ clipPath: `polygon(${dataPolygon})` }} /><div className="sternberg-triangle__core"><strong>{knowledge.sternberg.triangleScore}</strong><span>心动指数</span></div>{points.map((point) => <div className={`sternberg-point ${point.className}`} key={point.key}><b>{point.label}</b><strong>{point.value}</strong><small>{point.assessment.score == null ? '等待更多信号' : `信号${levelLabel[point.assessment.evidenceLevel]}`}</small></div>)}</div></div>;
}

function dimensionScore(relationship: AnalysisReport['relationship'], key: string, fallback: number) { return relationship.dimensions.find((dimension) => dimension.key === key)?.score ?? fallback; }

function Metric({ label, value }: { label: string; value: number }) { return <div className="metric"><div className="metric__label"><span>{label}</span><b>{value}</b></div><div className="metric__bar"><i style={{ width: `${value}%` }} /></div></div>; }

export default App;
