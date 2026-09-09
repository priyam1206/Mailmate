# MailMate

> A privacy-first Gmail, Calendar, and AI work assistant.

MailMate turns an inbox into an action-oriented workspace instead of another list of messages. It combines Gmail, Google Calendar, deadline detection, a context-aware assistant called **Kyle**, reviewable Work preparation, scheduled automations, voice interaction, and optional local AI compute in one browser workspace.

MailMate was originally prototyped during **Code2Create 7.0** and is now maintained through the **MailMateCS** organization.

---

## What MailMate Does

MailMate is designed to answer four practical questions quickly:

1. **What needs my attention now?**
2. **What is coming up next?**
3. **What work can be prepared automatically?**
4. **What can Kyle safely do without hiding important context or taking risky actions silently?**

The current application includes:

- **Overview** — time-aware priorities, upcoming events, deadlines, Work state, and waiting-on-others signals.
- **Inbox** — Gmail reading, filtering, stable priority sorting, search, context-aware actions, and message-level Kyle controls.
- **Kyle** — conversational assistance with structured Canvas answers, deterministic UI actions, email context, drafting, and voice interaction.
- **Work** — privacy-gated preparation for actionable mail, including summaries, checklists, drafts, and generated files.
- **Calendar** — Google Calendar integration, deadline surfacing, and schedule-conflict detection.
- **Automations** — once, daily, weekly, and interval jobs that can run Kyle goals and record output as Work.
- **Settings** — appearance, assistant, inbox, automation, privacy, storage, service, and developer preferences.

---

## Core Product Principles

### 1. The inbox remains visible

MailMate does not hide authorized Gmail messages merely because they are irrelevant to an AI workflow. The browser display plane can render the mailbox while AI processing remains separately gated.

### 2. Raw mailbox content is not an application database

The design target is **zero central mailbox retention**. Raw message bodies, HTML, attachments, and sensitive correspondence should remain transient. Only minimized derived state required for features such as Work, classifications, references, or session continuity may be persisted.

### 3. AI access is narrower than display access

A local deterministic privacy gate filters sensitive or unnecessary material before it is passed into AI-assisted workflows. Sensitive categories and `LOCAL_ONLY` Work are prevented from silently falling back to cloud models.

### 4. Writes require stronger safety than reads

Drafting, sending mail, changing calendar events, and other writes are separated from ordinary analysis. Riskier or substantive actions remain reviewable, with approval and cancellation paths instead of silent execution.

---

## Architecture

```text
Google Gmail + Calendar
        |
        v
+-----------------------------+
| Flask application / APIs    |
| auth · mail · calendar      |
| work · automations · voice  |
+-----------------------------+
        |
        +------------------------------+
        |                              |
        v                              v
Browser display plane          Privacy / policy gate
(transient mailbox UI)                 |
                                       +--> Kyle interactive intelligence
                                       +--> Work Agent
                                       +--> Calendar/deadline reasoning
                                       +--> approved write actions

Optional compute paths
  - Gemini / configured cloud model for approved interactive tasks
  - LM Studio local-first Work inference
  - Tailscale route to private local compute
  - Faster Whisper for local speech-to-text
  - ElevenLabs TTS with browser speech fallback

Optional persistence
  - minimized derived context / Work state
  - automation definitions and run state
  - never intended as a raw Gmail archive
```

### Two-plane privacy boundary

| Flow | Policy |
| --- | --- |
| Gmail → browser display | Allowed for the authenticated user |
| Gmail → raw central mailbox storage | Prohibited by design |
| Gmail → AI | Privacy gate required |
| Sensitive / `LOCAL_ONLY` Work → cloud model | Blocked |
| Mail/calendar write | Explicit policy and approval requirements |

---

## Major Capabilities

### Gmail workspace

- Google OAuth with Gmail and Calendar permissions
- transient mailbox rendering
- message search and filtering
- stable Smart/priority ordering
- unread and important-state synchronization
- message prefetching and thread-aware context
- contextual **Summarize**, **Draft reply**, and **Ask about this** actions

### Kyle assistant

Kyle is the interaction layer across MailMate. It combines natural-language requests with deterministic application tools rather than using an LLM for every action.

Current Kyle capabilities include:

- navigating MailMate views
- answering questions about the current email
- summarizing and ranking mail
- drafting and editing replies
- structured Canvas responses with references to email, calendar, and Work items
- deterministic tool execution for supported UI actions
- persistent in-session answer history
- voice input and spoken responses
- natural-language creation and control of recurring automations

### Work Agent

Work converts actionable mail into reviewable preparation rather than immediately performing high-impact actions. Depending on privacy and policy state, Work can:

- analyze an actionable request
- build checklists
- prepare response drafts
- generate workspace files such as Markdown or DOCX artifacts
- preserve progress across compute interruptions
- use local LM Studio inference
- resume waiting jobs when private compute becomes available
- keep substantive commitments and sensitive actions for review

### Calendar intelligence

- Google Calendar event rendering
- upcoming event and deadline surfacing
- conflict detection
- grouped and all-day event handling
- time-aware Overview filtering
- preview and confirmation paths before destructive calendar changes

### Automations

MailMate supports persistent scheduled Kyle goals with:

- one-time schedules
- daily schedules
- weekly schedules
- interval schedules
- enable and disable controls
- manual **Run now**
- Work records for automation output
- natural-language automation creation from Kyle

### Voice and local compute

- local Faster Whisper speech-to-text with browser fallback
- microphone and model prewarming for lower perceived latency
- ElevenLabs TTS when configured
- local LM Studio Work inference
- optional private Tailscale route to separate local compute

---

## Repository Layout

```text
app.py                         Flask application and API routes
services/                      Gmail, Calendar, AI, Work, privacy, and automation services
services/agent/                bounded agent runtime, registry, models, and tools
dashboard.html                 authenticated application shell
dashboard.js                   primary dashboard behavior
dashboard.css                  primary application styling
kyle*.js                       Kyle UI, state, tools, executor, voice, and Canvas runtime
mailmate-context.js            browser-side context references
mailmate-objects.js            browser-side object registry
calendar-conflicts.js          client conflict handling
remote-worker-ui.*             remote/private compute UI
compute-ui-fix.*               compute-state presentation fixes
mailmate-master-polish.css     current presentation polish layer
index.html                     landing and authentication entry page
styles.css / landing.css       landing-page styling
script.js / landing.js         landing-page behavior
supabase/migrations/           optional minimized derived-context persistence
tests/                         Python and JavaScript tests
api.env.example                environment template
```

---

## Requirements

- Python 3.10+
- Google Cloud project with Gmail API and Google Calendar API enabled
- Google OAuth 2.0 Web application credentials
- configured Gemini/API provider for cloud-assisted Kyle features
- optional LM Studio for local Work inference
- optional NVIDIA CUDA environment for faster local Whisper
- optional ElevenLabs key for TTS
- optional Tailscale network for private remote local-compute routing

---

## Install and Run

Clone the repository:

```bash
git clone https://github.com/MailMateCS/MailMate.git
cd MailMate
```

Create the local environment file:

```bat
copy api.env.example api.env
```

Install dependencies:

```bash
pip install -r requirements.txt
```

Configure the required credentials in `api.env`, then start Flask:

```bash
python app.py
```

Open:

```text
http://localhost:5000
```

Choose **Continue with Google** and authorize the Gmail and Calendar permissions required by the features you want to use.

---

## Environment Configuration

Start from [`api.env.example`](./api.env.example). **Never commit a completed `api.env`, OAuth secret, API key, Supabase secret, model-provider credential, mailbox export, or user data.**

Typical Google configuration:

```env
GOOGLE_CLIENT_ID=your_google_oauth_web_client_id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your_google_oauth_web_client_secret
GOOGLE_REDIRECT_URI=http://localhost:5000/auth/google/callback
PORT=5000
FRONTEND_URL=http://localhost:5000
```

Typical Gemini configuration:

```env
GEMINI_API_KEY=your_gemini_key
GEMINI_MODEL=your_configured_model
GMAIL_FETCH_LIMIT=50
GMAIL_QUERY=newer_than:30d
```

See `api.env.example` for optional Whisper, ElevenLabs, Supabase, LM Studio, and remote-compute settings.

---

## Optional Supabase Derived Context

Supabase is optional and is intended only for minimized derived state, not raw mailbox storage.

When enabled, the design excludes raw message bodies, HTML, attachments, links, and full mailbox archives. Identity is namespaced and Row Level Security is used to scope records to the authenticated account.

Apply the migrations under:

```text
supabase/migrations/
```

Then enable only the corresponding settings documented in `api.env.example`.

---

## Testing

Python tests:

```bash
python -m pytest -q
```

JavaScript tests can be run with Node's test runner for the relevant files under `tests/`.

The test suite covers areas including Calendar conflict handling, Kyle runtime and guided UX, deletion safety, AI runtime/provider behavior, Gmail message handling, mail context, automation scheduling, Work state, Whisper configuration, and dashboard markup.

---

## Troubleshooting

### Google access blocked

Add the Gmail account as an OAuth test user or configure and publish the Google consent screen appropriately.

### Gmail draft/send returns 403 or insufficient permissions

Reconnect through the Google auth flow so the current token contains the Gmail modify permission required for drafts and sends. Older sessions may contain read-only scopes.

### Kyle voice input does not start

Check Chrome microphone permissions. Local Whisper is preferred when configured; browser speech recognition is the fallback path.

### Work is waiting for compute

If Work is configured for local/private inference, confirm LM Studio is running. For remote local compute, also confirm Tailscale connectivity and the configured host route.

---

## Contributing

1. Keep `main` reviewable and stable.
2. Develop meaningful changes on a focused branch.
3. Open a pull request describing behavior, safety implications, and testing.
4. Preserve Git authorship and commit history.
5. Do not commit private credentials, mailbox exports, or user data.

---

## Project Status

MailMate remains an actively developed prototype. It demonstrates an inbox assistant that combines cloud APIs, deterministic controls, and local AI while keeping sensitive-data boundaries explicit.

It is **not** a production mail security product. Use test accounts and credentials where appropriate, review writes before sending, and rotate any credential that has ever been exposed outside its intended secret store.
