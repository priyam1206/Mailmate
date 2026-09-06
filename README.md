# Agent Harness - Team CIPHERSQUAD

Agent Harness is a Gmail intelligence workspace built for Code2Create 7.0. It signs users in with Google, fetches their recent Gmail, stores processed context in Supabase, uses Gemini to identify priorities and actions, and provides the optional Kyle browser voice assistant.

## Features

- Google OAuth with each user's Google name and profile picture
- Real Gmail fetching with compact Inbox and message detail views
- Gemini summaries, priorities, blockers, and natural spoken replies
- Supabase caching for users, OAuth tokens, emails, insights, tasks, and actions
- Kyle text chat on every dashboard page
- Browser speech recognition and browser text-to-speech; ElevenLabs and Whisper are not required
- Overview, Inbox, Work, Automations, Status, Integrations, and Settings views

## Requirements

- Node.js 18 or newer
- A Google Cloud project with Gmail API enabled
- A Google OAuth 2.0 Web application client
- A Gemini API key
- A Supabase project for shared persistence (recommended)
- Chrome or another browser that supports the Web Speech API for Kyle voice input

## Install And Run

Clone the repository and enter the project:

```bash
git clone https://github.com/sphereofrupayan/CipherSquad.git
cd CipherSquad
```

Install dependencies:

```bash
npm install
```

Create your local environment file.

Windows Command Prompt:

```bat
copy api.env.example api.env
```

PowerShell:

```powershell
Copy-Item api.env.example api.env
```

macOS or Linux:

```bash
cp api.env.example api.env
```

Fill in `api.env`, then start the app:

```bash
npm start
```

Open [http://localhost:5000](http://localhost:5000), choose **Continue with Google**, and allow read-only Gmail access.

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
GMAIL_FETCH_LIMIT=20
GMAIL_QUERY=newer_than:30d
```

Recommended for shared persistence:

```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_PUBLISHABLE_KEY=your_supabase_publishable_key
SUPABASE_SECRET_KEY=your_supabase_service_role_key
SUPABASE_JWKS_URL=https://your-project.supabase.co/auth/v1/.well-known/jwks.json
```

ElevenLabs and Whisper variables remain in the example only for future integration. The current Kyle implementation uses `SpeechRecognition`/`webkitSpeechRecognition` and `window.speechSynthesis` in the browser.

## Google OAuth Setup

1. Open Google Cloud Console and select the project used by this app.
2. Enable **Gmail API** under **APIs & Services > Library**.
3. Configure the OAuth consent screen under **Google Auth Platform**.
4. Create an **OAuth client ID** with application type **Web application**.
5. Add this Authorized redirect URI exactly:

```text
http://localhost:5000/auth/google/callback
```

6. Put the client ID and client secret into `api.env`.
7. While publishing status is **Testing**, add every teammate and judge under **Google Auth Platform > Audience > Test users**.

Users who are not listed as test users cannot sign in until the OAuth app is published. If Google reports `redirect_uri_mismatch`, confirm the URI, protocol, port, and path match exactly and restart the server after changing `api.env`.

## Supabase Setup

1. Create or open the Supabase project.
2. Open **SQL Editor**.
3. Run the complete [`supabase_schema.sql`](./supabase_schema.sql) file once.
4. Add the project URL and keys to `api.env`.
5. Restart the server.

Without Supabase variables, the app can use an in-memory Gmail session for a single local demo. Restarting the server clears that fallback session.

## Kyle Voice

- Hover over the Kyle orb in the bottom-right corner to open the text prompt.
- Click the orb to start or stop browser speech recognition.
- Kyle's Gemini response is spoken using the browser's built-in voice.
- Use the small speaker icon on the orb to mute or unmute speech.
- If voice recognition is unavailable, text input continues to work.
- Microphone access is used only while Kyle is listening or monitoring for an interruption.

## Useful Checks

Backend health:

```text
http://localhost:5000/api/health
```

Expected local pages:

- Landing page: `http://localhost:5000/`
- Dashboard: `http://localhost:5000/dashboard.html`
- Google login: `http://localhost:5000/auth/google`

## Troubleshooting

- **Google access blocked:** add the Gmail account as an OAuth test user or publish the consent screen.
- **No emails appear:** reconnect Google, then use Refresh on Overview and inspect the Status page.
- **Authentication failed after a restart:** verify `GOOGLE_CLIENT_SECRET`, the callback URI, and Supabase token storage.
- **Kyle cannot hear you:** use Chrome, allow microphone access, and check Browser speech recognition on Status.
- **Gemini falls back:** verify `GEMINI_API_KEY` and `GEMINI_MODEL`, then restart the server.
- **Supabase errors:** run `supabase_schema.sql` and verify the project URL and server-side secret key.

## Security

- `api.env`, `.env`, logs, and `node_modules` are ignored by Git.
- Do not paste live Google, Gemini, Supabase, or voice-provider secrets into issues or commits.
- Rotate any credential that has been posted publicly or shared with people outside the team.
- Prefer a password manager or encrypted secret-sharing channel when distributing the completed `api.env`.

The previous dashboard implementation is preserved under [`backup-current-dashboard`](./backup-current-dashboard/) for reference.
