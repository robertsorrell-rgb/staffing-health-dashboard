'use strict';

const { ok, handleOptions } = require('./_sheets.js');

const MAX_CONTEXT_CHARS = 62000;
const MAX_MESSAGES = 22;
const MAX_MESSAGE_CHARS = 3500;

const JSON_HEADERS_ERR = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

function chatError(status, message, code) {
  const body = code ? { error: message, code } : { error: message };
  return { statusCode: status, headers: JSON_HEADERS_ERR, body: JSON.stringify(body) };
}

function buildSystemPrompt(ctxStr) {
  return `You are a staffing health copilot for Consumer Sales workforce leaders. You answer questions about the current dashboard snapshot only.

Rules:
- Treat CONTEXT_JSON as the only source of truth for facts and numbers. Do not invent metrics, people, schedules, or events that are not supported by CONTEXT_JSON.
- If CONTEXT_JSON is missing data for a question, say so plainly and suggest what panel or metric would normally hold it.
- Be concise: short paragraphs or a few bullets. Plain text (no markdown tables).
- Tone: professional and supportive. Avoid blaming individuals; frame adherence issues as opportunities when discussing named reps from CONTEXT_JSON.
- When citing numbers, use the exact values from CONTEXT_JSON when possible.
- meta.historical means the user is viewing a stored snapshot (not live today); acknowledge that if relevant.

CONTEXT_JSON:
${ctxStr}`;
}

/**
 * OpenAI platform or **Azure OpenAI** (corporate GPT often uses Azure — set endpoint + deployment).
 * @param {{ role: string, content: string }[]} clean
 */
async function completeWithOpenAI(systemPrompt, clean, apiKey, model) {
  const openaiMessages = [{ role: 'system', content: systemPrompt }, ...clean];

  const azureEndpoint = String(process.env.AZURE_OPENAI_ENDPOINT || '').trim().replace(/\/$/, '');
  const azureDeployment = String(process.env.AZURE_OPENAI_DEPLOYMENT || '').trim();
  const azureVersion = String(process.env.AZURE_OPENAI_API_VERSION || '2024-08-01-preview').trim();

  let url = 'https://api.openai.com/v1/chat/completions';
  /** @type {Record<string, string>} */
  let headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
  };

  /** @type {Record<string, unknown>} */
  let payload = {
    model,
    messages: openaiMessages,
    temperature: 0.25,
    max_tokens: 900,
  };

  if (azureEndpoint && azureDeployment) {
    url = `${azureEndpoint}/openai/deployments/${encodeURIComponent(azureDeployment)}/chat/completions?api-version=${encodeURIComponent(azureVersion)}`;
    headers = {
      'Content-Type': 'application/json',
      'api-key': apiKey,
    };
    const { model: _drop, ...rest } = payload;
    payload = rest;
  }

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });

  const raw = await res.text();
  if (!res.ok) {
    let detail = raw.slice(0, 400);
    try {
      const ej = JSON.parse(raw);
      detail = ej.error?.message || ej.message || detail;
    } catch (_) {}
    const err = new Error(detail);
    err.statusCode = res.status >= 400 && res.status < 600 ? res.status : 502;
    err.code = 'openai_error';
    throw err;
  }

  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    const err = new Error('Invalid response from OpenAI');
    err.code = 'openai_parse';
    throw err;
  }

  const reply = String(data.choices?.[0]?.message?.content ?? '').trim();
  if (!reply) {
    const err = new Error('Empty completion from OpenAI');
    err.code = 'openai_empty';
    throw err;
  }

  return { reply, model, provider: 'openai' };
}

/**
 * Gemini roles: user | model (assistant maps to model).
 * @param {{ role: string, content: string }[]} clean
 */
async function completeWithGemini(systemPrompt, clean, apiKey, model) {
  const contents = clean.map((m) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }));

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents,
      generationConfig: {
        temperature: 0.25,
        maxOutputTokens: 900,
      },
    }),
  });

  const raw = await res.text();
  if (!res.ok) {
    let detail = raw.slice(0, 500);
    try {
      const ej = JSON.parse(raw);
      detail = ej.error?.message || ej.message || detail;
    } catch (_) {}
    const err = new Error(detail);
    err.statusCode = res.status >= 400 && res.status < 600 ? res.status : 502;
    err.code = 'gemini_error';
    throw err;
  }

  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    const err = new Error('Invalid response from Gemini');
    err.code = 'gemini_parse';
    throw err;
  }

  const parts = data.candidates?.[0]?.content?.parts;
  const reply = Array.isArray(parts)
    ? parts.map((p) => String(p.text || '')).join('').trim()
    : '';

  if (!reply) {
    const reason = data.candidates?.[0]?.finishReason || data.promptFeedback?.blockReason || '';
    const err = new Error(
      reason
        ? `Gemini returned no text (finish: ${reason}). Try rephrasing or a different STAFFING_CHAT_GEMINI_MODEL.`
        : 'Empty completion from Gemini'
    );
    err.code = 'gemini_empty';
    throw err;
  }

  return { reply, model, provider: 'gemini' };
}

/**
 * Anthropic Messages API — corporate Claude is almost always this key + approved model name from IT.
 * @param {{ role: string, content: string }[]} clean
 */
async function completeWithAnthropic(systemPrompt, clean, apiKey, model) {
  const messages = clean.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 1024,
      system: systemPrompt,
      messages,
      temperature: 0.25,
    }),
  });

  const raw = await res.text();
  if (!res.ok) {
    let detail = raw.slice(0, 500);
    try {
      const ej = JSON.parse(raw);
      detail = ej.error?.message || ej.message || detail;
    } catch (_) {}
    const err = new Error(detail);
    err.statusCode = res.status >= 400 && res.status < 600 ? res.status : 502;
    err.code = 'anthropic_error';
    throw err;
  }

  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    const err = new Error('Invalid response from Anthropic');
    err.code = 'anthropic_parse';
    throw err;
  }

  const blocks = data.content;
  const reply = Array.isArray(blocks)
    ? blocks
        .filter((b) => b && b.type === 'text' && b.text)
        .map((b) => b.text)
        .join('')
        .trim()
    : '';

  if (!reply) {
    const err = new Error('Empty completion from Anthropic');
    err.code = 'anthropic_empty';
    throw err;
  }

  return { reply, model, provider: 'anthropic' };
}

function openAiCompatibleKey() {
  const azureEndpoint = String(process.env.AZURE_OPENAI_ENDPOINT || '').trim();
  const azureDeployment = String(process.env.AZURE_OPENAI_DEPLOYMENT || '').trim();
  if (azureEndpoint && azureDeployment) {
    const k = String(process.env.AZURE_OPENAI_API_KEY || process.env.OPENAI_API_KEY || '').trim();
    return k || null;
  }
  const k = String(process.env.OPENAI_API_KEY || '').trim();
  return k || null;
}

function resolveProvider() {
  const explicit = String(process.env.STAFFING_CHAT_PROVIDER || '')
    .trim()
    .toLowerCase();
  const openaiKey = openAiCompatibleKey();
  const anthropicKey = String(process.env.ANTHROPIC_API_KEY || '').trim();
  const geminiKey = String(
    process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY || ''
  ).trim();

  if (explicit === 'openai') {
    return openaiKey ? { name: 'openai', openaiKey } : null;
  }
  if (explicit === 'anthropic') {
    return anthropicKey ? { name: 'anthropic', anthropicKey } : null;
  }
  if (explicit === 'gemini') {
    return geminiKey ? { name: 'gemini', geminiKey } : null;
  }

  /**
   * auto: OpenAI/Azure first (existing deployments), then Anthropic, then Gemini.
   */
  if (openaiKey) return { name: 'openai', openaiKey };
  if (anthropicKey) return { name: 'anthropic', anthropicKey };
  if (geminiKey) return { name: 'gemini', geminiKey };
  return null;
}

exports.handler = async (event) => {
  const opt = handleOptions(event);
  if (opt) return opt;

  if (event.httpMethod !== 'POST') {
    return chatError(405, 'Use POST', 'method_not_allowed');
  }

  const provider = resolveProvider();
  if (!provider) {
    return chatError(
      503,
      'No AI API key configured. Use corporate keys: OPENAI_API_KEY (or Azure vars), ANTHROPIC_API_KEY (Claude API), or free GEMINI_API_KEY — see README.',
      'missing_ai_key'
    );
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return chatError(400, 'Invalid JSON body', 'invalid_json');
  }

  const messages = body.messages;
  const context = body.context;
  if (!Array.isArray(messages) || messages.length === 0) {
    return chatError(400, 'messages must be a non-empty array', 'bad_messages');
  }
  if (!context || typeof context !== 'object') {
    return chatError(400, 'context must be an object (dashboard snapshot)', 'bad_context');
  }

  let ctxStr = JSON.stringify(context);
  if (ctxStr.length > MAX_CONTEXT_CHARS) {
    ctxStr = `${ctxStr.slice(0, MAX_CONTEXT_CHARS)}\n…[context truncated]`;
  }

  const clean = messages
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant'))
    .slice(-MAX_MESSAGES)
    .map((m) => ({
      role: m.role,
      content: String(m.content ?? '').slice(0, MAX_MESSAGE_CHARS),
    }));

  if (!clean.some((m) => m.role === 'user')) {
    return chatError(400, 'Include at least one user message', 'no_user_turn');
  }

  const systemPrompt = buildSystemPrompt(ctxStr);

  try {
    let out;
    if (provider.name === 'gemini') {
      const model =
        String(process.env.STAFFING_CHAT_GEMINI_MODEL || 'gemini-2.0-flash').trim() ||
        'gemini-2.0-flash';
      out = await completeWithGemini(systemPrompt, clean, provider.geminiKey, model);
    } else if (provider.name === 'anthropic') {
      const model =
        String(process.env.STAFFING_CHAT_ANTHROPIC_MODEL || 'claude-3-5-sonnet-20241022').trim() ||
        'claude-3-5-sonnet-20241022';
      out = await completeWithAnthropic(systemPrompt, clean, provider.anthropicKey, model);
    } else {
      const model =
        String(process.env.STAFFING_CHAT_MODEL || 'gpt-4o-mini').trim() || 'gpt-4o-mini';
      out = await completeWithOpenAI(systemPrompt, clean, provider.openaiKey, model);
    }
    return ok(out, 0);
  } catch (err) {
    const msg = err.message || String(err);
    const code = err.code || 'ai_error';
    const status = err.statusCode >= 400 && err.statusCode < 600 ? err.statusCode : 502;
    return chatError(status, msg, code);
  }
};
