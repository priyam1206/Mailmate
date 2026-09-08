# Mailmate - Team CIPHERSQUAD

Mailmate is a proactive Gmail intelligence & autonomous work preparation workspace built for Code2Create 7.0.

> **Mailmate displays user-authorized Gmail data transiently, but does not centrally retain mailbox content. Before any AI or autonomous processing, a local privacy gate blocks sensitive and irrelevant messages and passes only the minimum required context.**

---

## Two-Plane Security Architecture

Mailmate enforces a strict boundary between user email viewing and machine intelligence:

```text
Gmail
  |
  +-- Display plane: authorized mail in transient browser RAM
  |
  +-- Privacy gate: minimum required, policy-approved context
        |
        +-- Kyle and Inbox intelligence: Gemini
        +-- Deterministic Kyle actions: no LLM
        +-- Work Agent: LM Studio local-first
        +-- LOCAL_ONLY Work: local model only
```

### Boundary Enforcement Rules
- `Gmail -> browser`: Allowed display (transient in browser RAM only; no emails hidden from user).
- `Gmail -> disk/database`: **Prohibited** (zero central mailbox retention; only minimal derived task state is stored).
- `Gmail -> Gemini`: **Gate required** for interactive Kyle, drafting, and Inbox intelligence.
- `Gmail -> Work Agent`: **Gate required**; Work uses LM Studio local-first, and `LOCAL_ONLY` data never leaves the local model.
- `Gmail -> auto-send`: **Gate + AutoSendPolicy required** (routine acknowledgements only, 20s cancelable countdown).

---

## Features

- **Google OAuth with Gmail modify & Calendar access**
- **Transient In-Memory Inbox**: Full Gmail viewing with zero central mailbox storage
- **Deterministic Local Privacy Gate**: Screens out banking, OTPs, and personal records before AI
- **Proactive Work Agent**: Uses LM Studio local-first to prepare checklists (`.md`, `.docx`) and response drafts
- **Autopilot Safety Engine (`AutoSendPolicy`)**: 20-second cancelable auto-send countdown for routine acknowledgements only
- **Kyle Browser Voice Assistant** with native browser speech input and speech synthesis
- **Persistent Kyle Automations** with once, daily, weekly, and interval schedules; every run is recorded in Work
- **Overview, Inbox, Work, Calendar, Automations, Status, Integrations, and Settings views**

---

## Requirements

- Python 3.10 or newer
- A Google Cloud project with Gmail API and Google Calendar API enabled
- A Google OAuth 2.0 Web application client
- A Gemini API key
- (Optional) NVIDIA GPU with CUDA for local Whisper STT acceleration

---

## Install And Run

Clone the repository and enter the project:

```bash
git clone https://github.com/sphereofrupayan/CipherSquad.git
cd CipherSquad
```

Create your local environment file:

```bat
copy api.env.example api.env
```

Start the application:

```bash
py app.py
```

Open [http://localhost:5000](http://localhost:5000), choose **Continue with Google**, and grant Gmail and Calendar access.

---

## Environment Variables

Start from [`api.env.example`](./api.env.example). Never commit the completed `api.env` file.

Required for Google login and Gmail:

```env
GOOGLE_CLIENT_ID=your_google_oauth_web_client_id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your_google_oauth_web_client_secret
GOOGLE_REDIRECT_URI=http://localhost:5000/auth/google/callback
PORT=5000
FRONTEND_URL=http://localhost:5000
```

Required for Gemini analysis and Kyle replies:

```env
GEMINI_API_KEY=your_google_gemini_api_key
GEMINI_MODEL=gemini-3.6-flash
GMAIL_FETCH_LIMIT=50
GMAIL_QUERY=newer_than:30d
```

### AI provider boundary

- Gemini handles interactive Kyle language, mail drafting/editing, and privacy-approved Inbox intelligence.
- Deterministic Kyle actions do not call an LLM.
- LM Studio and `/api/compute` are reserved for Work Agent execution.
- A `LOCAL_ONLY` Work item never falls back to Gemini or another cloud model.

### Incremental derived context

Mailmate checks Gmail's `historyId` before fetching thread metadata. If Gmail has not changed, it reuses the process-RAM snapshot and the existing overview result. Each message also has a versioned source fingerprint, so deterministic scoring only reruns for changed messages or a new classifier version.

Optional Supabase storage contains minimized derived scores and identifiers only. It never contains raw bodies, HTML, attachments, links, recipient lists, or full subjects. To enable it:

1. Apply `supabase/migrations/001_mail_context.sql` in the Supabase SQL editor.
2. Set `SUPABASE_CONTEXT_ENABLED=1` and the four Supabase identity variables shown in `api.env.example`.
3. Use the publishable key and legacy JWT signing secret. Do not configure a service-role key for this path.

Flask maps the stable Google account ID to a namespaced UUID and signs a five-minute `authenticated` JWT. RLS then limits every operation to `auth.uid() = user_id`. Until that bridge is fully configured, storage remains memory-only by design.


---

## Kyle Voice Assistant

- Speech-to-text uses local Faster Whisper first and browser speech recognition as a fallback. Mailmate preloads both the model and microphone stream so a permitted mic starts immediately.
- CUDA machines default to `small` with FP16. CPU-only machines default to the lighter English `base.en` model with INT8 and at most four worker threads.
- Override those portable defaults with `WHISPER_MODEL`, `WHISPER_GPU_MODEL`, `WHISPER_CPU_MODEL`, `WHISPER_CPU_THREADS`, or `WHISPER_LANGUAGE`.
- Kyle uses ElevenLabs Flash TTS with the George voice when `ELEVENLABS_API_KEY` is a valid `sk_...` secret; browser speech synthesis remains the automatic fallback.
- Private ElevenLabs Agents use the server-only `ELEVENLABS_AGENT_ID` signed-URL endpoint, so the API key is never exposed to the browser.
- Calendar deletions always show the exact event or grouped event list before Kyle makes the change.

---

## Automations

Create an automation from the Automations view and choose a once, daily, weekly, or interval schedule. Schedules are stored locally in `data/automations.json`, restored after restarts, and run in the background while Mailmate is open. Each run creates a visible Work record with progress steps and its final summary.

---

## Troubleshooting

- **Google access blocked:** Add the Gmail account as an OAuth test user or publish the consent screen.
- **Insufficient Permissions / 403 on Drafts:** Reconnect Google at `http://localhost:5000/auth/google` to grant `gmail.modify` permissions. Older tokens may contain only `gmail.readonly`.
- **Kyle voice input:** Ensure microphone permissions are granted in Chrome.

