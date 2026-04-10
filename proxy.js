// Mistral Conductor v3.3 Proxy
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));
const PORT = process.env.PORT || 3000;

// ---------- Key loaders ----------
const loadKeys = (envVar) =>
  (process.env[envVar] || '').split(',').map(k => k.trim()).filter(Boolean);

const geminiKeys  = loadKeys('GEMINI_API_KEYS');
const groqKeys    = loadKeys('GROQ_API_KEYS');
const mistralKeys = loadKeys('MISTRAL_API_KEYS');
const openaiKeys  = loadKeys('OPENAI_API_KEYS');
const anthropicKeys = loadKeys('ANTHROPIC_API_KEYS');
const kimiKeys    = loadKeys('KIMI_API_KEYS');
const manusKeys   = loadKeys('MANUS_API_KEYS');

console.log(`Loaded keys — Gemini:${geminiKeys.length} Groq:${groqKeys.length} Mistral:${mistralKeys.length} OpenAI:${openaiKeys.length} Anthropic:${anthropicKeys.length} Kimi:${kimiKeys.length} Manus:${manusKeys.length}`);

// Round-robin index per provider
const idx = { gemini: 0, groq: 0, mistral: 0, openai: 0, anthropic: 0, kimi: 0, manus: 0 };

function nextKey(provider, keys) {
  if (!keys.length) throw new Error(`No ${provider} keys configured`);
  const key = keys[idx[provider] % keys.length];
  idx[provider]++;
  return key;
}

// ---------- Helpers ----------
const json = (res, data, status = 200) => res.status(status).json(data);
const err  = (res, msg, status = 500) => json(res, { error: msg }, status);

async function safeJson(r) {
  const text = await r.text();
  try { return JSON.parse(text); } catch { return { _raw: text }; }
}

// ---------- Routes ----------

// Gemini — multi-key round-robin
app.post('/route/gemini', async (req, res) => {
  try {
    const key = nextKey('gemini', geminiKeys);
    const model = req.body.model || 'gemini-2.0-flash';
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: req.body.prompt }] }],
          generationConfig: { temperature: 0.7, maxOutputTokens: req.body.max_tokens || 900 }
        })
      }
    );
    const data = await safeJson(r);
    if (!r.ok) return err(res, data.error?.message || `Gemini ${r.status}`, r.status);
    res.json({ choices: [{ message: { content: data.candidates?.[0]?.content?.parts?.[0]?.text || '' } }] });
  } catch (e) {
    err(res, e.message);
  }
});

// Groq — multi-key round-robin
app.post('/route/groq', async (req, res) => {
  try {
    const key = nextKey('groq', groqKeys);
    const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: req.body.model || 'llama-3.3-70b-versatile',
        messages: [{ role: 'user', content: req.body.prompt }],
        temperature: 0.7,
        max_tokens: req.body.max_tokens || 900
      })
    });
    const data = await safeJson(r);
    if (!r.ok) return err(res, data.error?.message || `Groq ${r.status}`, r.status);
    res.json(data);
  } catch (e) {
    err(res, e.message);
  }
});

// Mistral
app.post('/route/mistral', async (req, res) => {
  try {
    const key = nextKey('mistral', mistralKeys);
    const r = await fetch('https://api.mistral.ai/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: req.body.model || 'mistral-small-latest',
        messages: [{ role: 'user', content: req.body.prompt }],
        temperature: 0.7,
        max_tokens: req.body.max_tokens || 900
      })
    });
    const data = await safeJson(r);
    if (!r.ok) return err(res, data.error?.message || `Mistral ${r.status}`, r.status);
    res.json(data);
  } catch (e) {
    err(res, e.message);
  }
});

// OpenAI
app.post('/route/openai', async (req, res) => {
  try {
    const key = nextKey('openai', openaiKeys);
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: req.body.model || 'gpt-4o-mini',
        messages: [{ role: 'user', content: req.body.prompt }],
        temperature: 0.7,
        max_tokens: req.body.max_tokens || 900
      })
    });
    const data = await safeJson(r);
    if (!r.ok) return err(res, data.error?.message || `OpenAI ${r.status}`, r.status);
    res.json(data);
  } catch (e) {
    err(res, e.message);
  }
});

// Anthropic
app.post('/route/anthropic', async (req, res) => {
  try {
    const key = nextKey('anthropic', anthropicKeys);
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: req.body.model || 'claude-haiku-4-5-20251001',
        max_tokens: req.body.max_tokens || 900,
        messages: [{ role: 'user', content: req.body.prompt }]
      })
    });
    const data = await safeJson(r);
    if (!r.ok) return err(res, data.error?.message || `Anthropic ${r.status}`, r.status);
    // Normalise to OpenAI-style shape for the frontend
    res.json({ choices: [{ message: { content: data.content?.[0]?.text || '' } }] });
  } catch (e) {
    err(res, e.message);
  }
});

// Kimi (Moonshot) — OpenAI-compatible
app.post('/route/kimi', async (req, res) => {
  try {
    const key = nextKey('kimi', kimiKeys);
    const r = await fetch('https://api.moonshot.ai/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: req.body.model || 'kimi-k2.5',
        messages: [{ role: 'user', content: req.body.prompt }],
        temperature: 0.6,  // Moonshot recommends 0.6
        max_tokens: req.body.max_tokens || 900
      })
    });
    const data = await safeJson(r);
    if (!r.ok) return err(res, data.error?.message || `Kimi ${r.status}`, r.status);
    res.json(data);
  } catch (e) {
    err(res, e.message);
  }
});

// Manus — async task API (create → poll until done → return result)
// Manus is NOT a chat completions API. It runs long-lived agent tasks.
// We poll with a reasonable timeout (60s) before giving up.
app.post('/route/manus', async (req, res) => {
  try {
    const key = nextKey('manus', manusKeys);
    const MANUS_BASE = 'https://api.manus.ai/v1';
    const POLL_INTERVAL_MS = 3000;
    const POLL_TIMEOUT_MS = 60000;

    // 1. Create task
    const createRes = await fetch(`${MANUS_BASE}/tasks`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: req.body.prompt,
        taskMode: 'chat',        // 'chat' | 'adaptive' | 'agent'
        agentProfile: 'speed'   // 'speed' | 'quality'
      })
    });
    const task = await safeJson(createRes);
    if (!createRes.ok) return err(res, task.error?.message || `Manus create ${createRes.status}`, createRes.status);

    const taskId = task.id || task.task_id;
    if (!taskId) return err(res, 'Manus did not return a task ID');

    // 2. Poll for completion
    const deadline = Date.now() + POLL_TIMEOUT_MS;
    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
      const pollRes = await fetch(`${MANUS_BASE}/tasks/${taskId}`, {
        headers: { Authorization: `Bearer ${key}` }
      });
      const pollData = await safeJson(pollRes);
      if (!pollRes.ok) return err(res, pollData.error?.message || `Manus poll ${pollRes.status}`, pollRes.status);

      const status = pollData.status;
      if (status === 'completed' || status === 'done') {
        const content = pollData.result?.text
          || pollData.result?.message
          || pollData.message
          || JSON.stringify(pollData.result || pollData);
        return res.json({ choices: [{ message: { content } }] });
      }
      if (status === 'failed' || status === 'error') {
        return err(res, pollData.error?.message || 'Manus task failed');
      }
      // status: 'pending' | 'running' → keep polling
    }

    err(res, `Manus task ${taskId} did not complete within ${POLL_TIMEOUT_MS / 1000}s`);
  } catch (e) {
    err(res, e.message);
  }
});

// ---------- Health check ----------
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    providers: {
      gemini:    geminiKeys.length,
      groq:      groqKeys.length,
      mistral:   mistralKeys.length,
      openai:    openaiKeys.length,
      anthropic: anthropicKeys.length,
      kimi:      kimiKeys.length,
      manus:     manusKeys.length
    }
  });
});

app.listen(PORT, () => console.log(`Mistral Conductor proxy v3.3 running on http://localhost:${PORT}`));
