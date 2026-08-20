import 'dotenv/config';
import cors from 'cors';
import express from 'express';
import path from 'node:path';
import { z } from 'zod';
import { calculateMetrics, parseChat } from './parser.js';
import { runWorkflow } from './workflow.js';
import { sanitizeChatMessages, type AnalysisSource } from './evidence.js';

const app = express();
app.use(cors());
// 900k CJK characters can exceed 2 MB once UTF-8 encoded and wrapped in JSON.
app.use(express.json({ limit: '4mb' }));

const bodySchema = z.object({
  text: z.string().min(1).max(900_000),
  format: z.string().optional(),
  source: z.enum(['text', 'file', 'screenshot']).optional(),
});

app.get('/api/health', (_request, response) => {
  response.json({
    ok: true,
    mode: process.env.OPENAI_API_KEY && process.env.OPENAI_ENABLED !== 'false' ? 'openai-gpt-5.6-sol' : process.env.OLLAMA_ENABLED === 'true' ? 'local-llm' : 'deterministic-local',
  });
});

app.post('/api/analyze', async (request, response) => {
  const body = bodySchema.safeParse(request.body);
  if (!body.success) {
    return response.status(400).json({ error: '请输入聊天记录后再开始分析。' });
  }

  const source: AnalysisSource = body.data.source ?? (body.data.format ? 'file' : 'text');
  const messages = sanitizeChatMessages(parseChat(body.data.text, body.data.format), source);
  if (messages.length < 2) {
    return response.status(400).json({ error: '至少需要两条有效聊天消息。' });
  }

  response.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  response.setHeader('Cache-Control', 'no-cache');
  response.setHeader('Connection', 'keep-alive');

  try {
    const metrics = calculateMetrics(messages);
    const report = await runWorkflow(messages, metrics, (step) => {
      response.write(`${JSON.stringify({ type: 'step', step, status: 'complete' })}\n`);
    }, source);
    response.write(`${JSON.stringify({ type: 'result', report })}\n`);
  } catch (error) {
    console.error('Analysis workflow failed:', error);
    response.write(`${JSON.stringify({ type: 'error', error: '分析过程中出现错误，请稍后重试。' })}\n`);
  } finally {
    response.end();
  }
});

const clientPath = path.resolve(process.cwd(), 'dist/client');
app.use(express.static(clientPath));
app.get('*', (_request, response) => response.sendFile(path.join(clientPath, 'index.html')));

const port = Number(process.env.PORT ?? 8787);
app.listen(port, () => console.log(`AI Relationship Agent API listening on http://localhost:${port}`));
