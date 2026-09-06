const express = require('express');
const cors = require('cors');
const { google } = require('googleapis');
const { GoogleGenAI } = require('@google/genai');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, 'api.env') });
require('dotenv').config();

const oauth2Client = require('./config/google');
const { fetchUserEmails } = require('./services/gmailService');
const { analyzeEmailsWithAI } = require('./services/aiService');
const {
  findOrCreateUser,
  getUserById,
  saveOAuthTokens,
  getOAuthTokens,
  saveEmails,
  saveUserInsight,
  saveAttentionItems,
  getTasksByUser,
  saveTasks,
  updateTaskStatus,
  saveAgentAction,
  getAgentActions,
  updateAgentAction,
  getDashboardData,
  getEmailsByUser,
} = require('./services/supabaseService');

const app = express();
const PORT = Number(process.env.PORT || 8000);
const FRONTEND_URL = process.env.FRONTEND_URL || `http://localhost:${PORT}`;
const SUPABASE_ENABLED = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SECRET_KEY);

let localTokens = null;
let localProfile = null;

app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '25mb' }));
app.get(['/api.env', '/.env'], (_req, res) => {
  res.status(404).send('Not found');
});

// Serve static frontend files from the project root
app.use(express.static(__dirname));

function hasElevenLabsApiKey() {
  return Boolean(process.env.ELEVENLABS_API_KEY && process.env.ELEVENLABS_API_KEY.startsWith('sk_'));
}

function compactKyleContext(context) {
  const emails = (context?.emails || []).slice(0, 8).map(email => ({
    sender: email.sender,
    subject: email.subject,
    snippet: email.snippet,
    date: email.date
  }));

  return {
    metrics: context?.metrics || {},
    ai_insight: context?.ai_insight || '',
    needs_attention: (context?.needs_attention || []).slice(0, 8),
    emails
  };
}

function normalizeCachedDashboard(cached, emails = []) {
  const insight = cached?.insight || {};
  const attentionItems = insight.attention_items || [];
  const normalizedEmails = emails.map(email => ({
    id: email.id || email.gmail_id,
    threadId: email.threadId || email.thread_id,
    sender: email.sender,
    receiver: email.receiver,
    subject: email.subject,
    body: email.body,
    snippet: email.snippet,
    date: email.date || email.timestamp,
    labels: email.labels || [],
    is_read: email.is_read,
    is_starred: email.is_starred
  }));
  return {
    metrics: {
      emails: insight.total_emails || normalizedEmails.length,
      important: insight.important_count || attentionItems.length || 0,
      actions: insight.action_count || (cached?.tasks || []).length || 0
    },
    needs_attention: attentionItems.map(item => ({
      sender: item.sender,
      reason: item.reason
    })),
    ai_insight: insight.ai_insight || 'Cached Gmail context is ready.',
    emails: normalizedEmails,
    tasks: cached?.tasks || [],
    actions: cached?.actions || [],
    cached: true
  };
}

function fallbackAnalysis(emails) {
  const attentionWords = /(urgent|asap|blocked|blocker|approval|approve|deadline|due|waiting|risk|deploy|demo|review|action|required)/i;
  const needsAttention = (emails || [])
    .filter(email => attentionWords.test(`${email.subject || ''} ${email.snippet || ''}`))
    .slice(0, 8)
    .map(email => ({
      sender: email.sender || 'Unknown sender',
      reason: email.snippet || email.subject || 'Likely action item detected from recent Gmail context.'
    }));

  return {
    total_emails: emails.length,
    important_count: needsAttention.length,
    action_items_count: needsAttention.length,
    needs_attention: needsAttention,
    ai_insight: needsAttention.length
      ? `${needsAttention.length} recent Gmail messages look action-oriented. Review approvals, blockers, deadlines, and waiting dependencies first.`
      : 'No urgent blockers detected in recent Gmail messages.'
  };
}

async function safeAnalyzeEmails(emails) {
  try {
    return (await analyzeEmailsWithAI(emails)) || fallbackAnalysis(emails);
  } catch (error) {
    console.warn('AI analysis unavailable, using local heuristic:', error.message || error);
    return fallbackAnalysis(emails);
  }
}

async function fetchGoogleProfile(tokens) {
  oauth2Client.setCredentials(tokens);
  const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
  const { data } = await oauth2.userinfo.get();
  return data;
}

function getLocalUserId() {
  return localProfile?.id || localProfile?.email || 'local-gmail-user';
}

app.get('/api/config', (_req, res) => {
  res.json({
    googleClientId: process.env.GOOGLE_CLIENT_ID || '',
    hasGoogleClientSecret: Boolean(process.env.GOOGLE_CLIENT_SECRET),
    supabaseConfigured: SUPABASE_ENABLED,
    elevenLabsConfigured: hasElevenLabsApiKey(),
    backendAuthUrl: '/auth/google',
    dashboardOverviewUrl: '/api/dashboard/overview',
    voiceBriefingUrl: '/api/voice/briefing',
    transcriptionUrl: '/api/transcribe'
  });
});

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    googleClientConfigured: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
    geminiConfigured: Boolean(process.env.GEMINI_API_KEY),
    supabaseConfigured: SUPABASE_ENABLED,
    elevenLabsConfigured: hasElevenLabsApiKey(),
    whisperConfigured: Boolean(process.env.OPENAI_API_KEY || process.env.WHISPER_API_KEY),
    gmailAuthenticated: Boolean(localTokens)
  });
});

app.get('/api/me', (_req, res) => {
  if (!localProfile) {
    res.status(401).json({ error: 'User profile unavailable until Google auth completes.' });
    return;
  }
  res.json(localProfile);
});

app.post('/api/voice/briefing', async (req, res) => {
  if (!hasElevenLabsApiKey()) {
    res.status(503).json({ error: 'ElevenLabs API key is missing or invalid. API keys start with sk_.' });
    return;
  }

  const rawText = String(req.body?.text || '').trim();
  const fallbackText = 'Agent briefing. Recent Gmail messages have been scanned for blockers, approvals, deadlines, and action items. Review the highest priority items and keep every execution step visible in the audit trail.';
  const text = (rawText || fallbackText).slice(0, 1200);
  const voiceId = process.env.ELEVENLABS_VOICE_ID || 'JBFqnCBsd6RMkjVDRZzb';
  const modelId = process.env.ELEVENLABS_MODEL_ID || 'eleven_multilingual_v2';

  try {
    const voiceResponse = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`,
      {
        method: 'POST',
        headers: {
          'xi-api-key': process.env.ELEVENLABS_API_KEY,
          'Content-Type': 'application/json',
          'Accept': 'audio/mpeg'
        },
        body: JSON.stringify({
          text,
          model_id: modelId,
          voice_settings: {
            stability: 0.48,
            similarity_boost: 0.78,
            style: 0.18,
            use_speaker_boost: true
          }
        })
      }
    );

    if (!voiceResponse.ok) {
      const detail = await voiceResponse.text();
      throw new Error(detail || `ElevenLabs returned ${voiceResponse.status}`);
    }

    const audioBuffer = Buffer.from(await voiceResponse.arrayBuffer());
    res.writeHead(200, {
      'Content-Type': 'audio/mpeg',
      'Content-Length': audioBuffer.length,
      'Cache-Control': 'no-store'
    });
    res.end(audioBuffer);
  } catch (error) {
    console.error('ElevenLabs briefing failed:', error.message || error);
    res.status(502).json({ error: 'Failed to generate ElevenLabs voice briefing.' });
  }
});

app.post('/api/transcribe', async (req, res) => {
  const audioBase64 = String(req.body?.audio || '');
  const mimeType = String(req.body?.mimeType || 'audio/webm');
  const apiKey = process.env.OPENAI_API_KEY || process.env.WHISPER_API_KEY;

  if (!apiKey) {
    res.status(503).json({ error: 'Whisper transcription is not configured. Set OPENAI_API_KEY or WHISPER_API_KEY.' });
    return;
  }

  if (!audioBase64) {
    res.status(400).json({ error: 'audio is required' });
    return;
  }

  try {
    const audioBuffer = Buffer.from(audioBase64, 'base64');
    const extension = mimeType.includes('mp4') ? 'm4a' : 'webm';
    const form = new FormData();
    form.append('file', new Blob([audioBuffer], { type: mimeType }), `speech.${extension}`);
    form.append('model', process.env.WHISPER_MODEL || 'whisper-1');
    form.append('response_format', 'json');

    console.log('[Kyle Voice] whisper started');
    const response = await fetch(process.env.WHISPER_TRANSCRIBE_URL || 'https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form
    });

    if (!response.ok) {
      const detail = await response.text();
      throw new Error(detail || `Whisper returned ${response.status}`);
    }

    const data = await response.json();
    console.log('[Kyle Voice] final transcript');
    res.json({ text: data.text || '' });
  } catch (error) {
    console.error('[Kyle Voice] whisper failed:', error.message || error);
    res.status(502).json({ error: 'Failed to transcribe audio.' });
  }
});

app.post('/api/kyle/chat', async (req, res) => {
  const message = String(req.body?.message || '').trim();
  if (!message) {
    res.status(400).json({ error: 'message is required' });
    return;
  }

  const context = compactKyleContext(req.body?.context || {});
  const fallbackReply = `I am with you. I can see ${context.metrics.emails || 0} scanned emails and ${context.metrics.actions || 0} possible actions. I would start with the most urgent dependency, then draft the shortest useful reply.`;

  if (!process.env.GEMINI_API_KEY) {
    res.json({ reply: fallbackReply, mode: 'fallback' });
    return;
  }

  try {
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    const prompt = `
You are Kyle, a calm voice assistant inside CipherSquad Agent Harness.
You are speaking out loud, not writing a report.
Answer like a person in 1 to 3 short spoken sentences.
Use contractions naturally. Avoid bullets, markdown, headings, tables, and long lists.
Use the Gmail/workflow context when available.
Never claim you sent an email or completed an irreversible action. Offer the next step or a draft instead.

User request:
${message}

Current Gmail/workflow context:
${JSON.stringify(context)}
`;

    const response = await ai.models.generateContent({
      model: process.env.GEMINI_MODEL || 'gemini-3.6-flash',
      contents: prompt
    });

    res.json({ reply: (response.text || fallbackReply).trim(), mode: 'gemini' });
  } catch (error) {
    console.error('Kyle Gemini chat failed:', error.message || error);
    res.json({ reply: fallbackReply, mode: 'fallback' });
  }
});

// ─────────────────────────────────────────────
// AUTH ROUTES
// ─────────────────────────────────────────────

// Route 1: Redirect user to Google OAuth page
app.get('/auth/google', (req, res) => {
  const scopes = [
    'https://www.googleapis.com/auth/gmail.readonly',
    'https://www.googleapis.com/auth/userinfo.email',
    'https://www.googleapis.com/auth/userinfo.profile',
  ];
  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: scopes,
    prompt: 'consent',
  });
  res.redirect(url);
});

// Route 2: OAuth Callback — persist user & tokens to Supabase
app.get('/auth/google/callback', async (req, res) => {
  const { code, error } = req.query;
  if (error) {
    res.redirect(`${FRONTEND_URL}/index.html?auth_error=${encodeURIComponent(error)}`);
    return;
  }
  if (!code) {
    res.status(400).send('Missing Google OAuth code.');
    return;
  }

  try {
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    // Get user profile from Google
    const profile = await fetchGoogleProfile(tokens);

    if (!SUPABASE_ENABLED) {
      localTokens = tokens;
      localProfile = profile;
      res.redirect(`${FRONTEND_URL}/dashboard.html?connected=true&userId=${encodeURIComponent(getLocalUserId())}&name=${encodeURIComponent(profile.name || profile.email || '')}&picture=${encodeURIComponent(profile.picture || '')}`);
      return;
    }

    // Upsert user in Supabase
    const user = await findOrCreateUser(profile.email, profile.name, profile.id);

    // Save OAuth tokens in Supabase
    await saveOAuthTokens(user.id, {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expiry_date: tokens.expiry_date,
    });

    // Redirect to frontend with userId
    res.redirect(`${FRONTEND_URL}/dashboard.html?connected=true&userId=${user.id}&name=${encodeURIComponent(user.name || '')}&picture=${encodeURIComponent(profile.picture || '')}`);
  } catch (error) {
    console.error('Error during OAuth callback:', error.message || error);
    res.status(500).send('Authentication failed');
  }
});

// Route 3: Check auth status
app.get('/api/auth/status', async (req, res) => {
  const { userId } = req.query;
  if (!userId && !localTokens) return res.status(400).json({ error: 'userId is required' });

  if (!SUPABASE_ENABLED) {
    res.json({
      authenticated: Boolean(localTokens),
      user: localProfile ? {
        id: getLocalUserId(),
        name: localProfile.name,
        email: localProfile.email,
        picture: localProfile.picture
      } : null
    });
    return;
  }

  try {
    const user = await getUserById(userId);
    const tokens = await getOAuthTokens(userId);
    res.json({
      authenticated: !!tokens,
      user: { id: user.id, name: user.name, email: user.email },
    });
  } catch (error) {
    res.status(401).json({ authenticated: false });
  }
});

// ─────────────────────────────────────────────
// DASHBOARD API
// ─────────────────────────────────────────────

// Route 4: Dashboard Overview — fetches emails, runs AI, persists everything
app.get('/api/dashboard/overview', async (req, res) => {
  const { userId, refresh } = req.query;
  if (!userId && !localTokens) return res.status(400).json({ error: 'userId query param is required' });

  if (!SUPABASE_ENABLED) {
    if (!localTokens) {
      return res.status(401).json({ error: 'User not authenticated with Gmail', authUrl: '/auth/google' });
    }

    try {
      const rawEmails = await fetchUserEmails(localTokens);
      const aiAnalysis = await safeAnalyzeEmails(rawEmails);
      return res.json({
        metrics: {
          emails: aiAnalysis?.total_emails || rawEmails.length,
          important: aiAnalysis?.important_count || 0,
          actions: aiAnalysis?.action_items_count || 0,
        },
        needs_attention: aiAnalysis?.needs_attention || [],
        ai_insight: aiAnalysis?.ai_insight || 'No urgent emails found.',
        emails: rawEmails,
        user: localProfile,
        user_id: getLocalUserId(),
      });
    } catch (error) {
      console.error('Local dashboard endpoint error:', error.message || error);
      return res.status(500).json({ error: 'Failed to process email insights.' });
    }
  }

  try {
    if (refresh !== 'true') {
      const [cached, cachedEmails] = await Promise.all([
        getDashboardData(userId),
        getEmailsByUser(userId, Number(process.env.GMAIL_FETCH_LIMIT || 20))
      ]);

      if (cached?.insight || cachedEmails.length) {
        return res.json(normalizeCachedDashboard(cached, cachedEmails));
      }
    }

    // 1. Load tokens from Supabase
    const tokenRow = await getOAuthTokens(userId);
    if (!tokenRow) {
      return res.status(401).json({ error: 'User not authenticated with Gmail' });
    }

    const tokens = {
      access_token: tokenRow.access_token,
      refresh_token: tokenRow.refresh_token,
      expiry_date: tokenRow.expiry_date,
    };

    // 2. Fetch emails from Gmail
    const rawEmails = await fetchUserEmails(tokens);

    // 3. Persist emails to Supabase
    await saveEmails(userId, rawEmails);

    // 4. Run AI analysis
    const aiAnalysis = await safeAnalyzeEmails(rawEmails);

    // 5. Persist insight snapshot
    const insight = await saveUserInsight(userId, {
      total_emails: aiAnalysis?.total_emails || rawEmails.length,
      important_count: aiAnalysis?.important_count || 0,
      action_items_count: aiAnalysis?.action_items_count || 0,
      ai_insight: aiAnalysis?.ai_insight || 'No urgent emails found.',
    });

    // 6. Persist attention items
    if (aiAnalysis?.needs_attention && aiAnalysis.needs_attention.length > 0) {
      await saveAttentionItems(insight.id, aiAnalysis.needs_attention);
    }

    // 7. Return response
    res.json({
      metrics: {
        emails: aiAnalysis?.total_emails || rawEmails.length,
        important: aiAnalysis?.important_count || 0,
        actions: aiAnalysis?.action_items_count || 0,
      },
      needs_attention: aiAnalysis?.needs_attention || [],
      ai_insight: aiAnalysis?.ai_insight || 'No urgent emails found.',
      emails: rawEmails,
      user_id: userId,
    });
  } catch (error) {
    console.error('Dashboard Endpoint Error:', error.message || error);
    res.status(500).json({ error: 'Failed to process email insights.' });
  }
});

// Route 5: Get cached dashboard data (without re-fetching Gmail)
app.get('/api/dashboard/cached', async (req, res) => {
  const { userId } = req.query;
  if (!userId) return res.status(400).json({ error: 'userId is required' });

  try {
    const data = await getDashboardData(userId);
    res.json(data);
  } catch (error) {
    console.error('Cached dashboard error:', error.message || error);
    res.status(500).json({ error: 'Failed to load dashboard data.' });
  }
});

// ─────────────────────────────────────────────
// EMAILS API
// ─────────────────────────────────────────────

app.get('/api/emails/:userId', async (req, res) => {
  try {
    const emails = await getEmailsByUser(req.params.userId);
    res.json(emails);
  } catch (error) {
    console.error('Emails fetch error:', error.message || error);
    res.status(500).json({ error: 'Failed to fetch emails.' });
  }
});

// ─────────────────────────────────────────────
// TASKS API
// ─────────────────────────────────────────────

app.get('/api/tasks/:userId', async (req, res) => {
  try {
    const tasks = await getTasksByUser(req.params.userId);
    res.json(tasks);
  } catch (error) {
    console.error('Tasks fetch error:', error.message || error);
    res.status(500).json({ error: 'Failed to fetch tasks.' });
  }
});

app.post('/api/tasks', async (req, res) => {
  const { userId, tasks } = req.body;
  if (!userId || !tasks) return res.status(400).json({ error: 'userId and tasks are required' });

  try {
    const saved = await saveTasks(userId, tasks);
    res.json(saved);
  } catch (error) {
    console.error('Tasks save error:', error.message || error);
    res.status(500).json({ error: 'Failed to save tasks.' });
  }
});

app.patch('/api/tasks/:taskId', async (req, res) => {
  const { status } = req.body;
  try {
    const updated = await updateTaskStatus(req.params.taskId, status);
    res.json(updated);
  } catch (error) {
    console.error('Task update error:', error.message || error);
    res.status(500).json({ error: 'Failed to update task.' });
  }
});

// ─────────────────────────────────────────────
// AGENT ACTIONS API
// ─────────────────────────────────────────────

app.post('/api/agent/action', async (req, res) => {
  const { userId, action } = req.body;
  if (!userId || !action) return res.status(400).json({ error: 'userId and action are required' });

  try {
    const saved = await saveAgentAction(userId, action);
    res.json(saved);
  } catch (error) {
    console.error('Agent action error:', error.message || error);
    res.status(500).json({ error: 'Failed to save agent action.' });
  }
});

app.get('/api/agent/actions/:userId', async (req, res) => {
  try {
    const actions = await getAgentActions(req.params.userId);
    res.json(actions);
  } catch (error) {
    console.error('Agent actions fetch error:', error.message || error);
    res.status(500).json({ error: 'Failed to fetch agent actions.' });
  }
});

app.patch('/api/agent/action/:actionId', async (req, res) => {
  try {
    const updated = await updateAgentAction(req.params.actionId, req.body);
    res.json(updated);
  } catch (error) {
    console.error('Agent action update error:', error.message || error);
    res.status(500).json({ error: 'Failed to update agent action.' });
  }
});

// ─────────────────────────────────────────────
// START SERVER
// ─────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`CipherSquad backend running on http://localhost:${PORT}`);
});
