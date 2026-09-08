(function () {
  const API_BASE = window.location.origin;
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const store = window.KyleState.createKyleState();
  const ui = window.KyleUi.createKyleUi(store);
  const audio = window.KyleAudio.createAudioEngine(handleMicAmplitude);

  let recognition = null;
  let recognitionTranscript = '';
  let recognitionTimer = null;
  let activeRun = 0;
  let utterance = null;
  let elevenAudio = null;
  let elevenAudioUrl = '';
  let speechRequest = null;
  let speakingRaf = null;
  let speakingStartedAt = 0;
  let smoothedSpeechEnergy = 0;
  let bargePeaks = 0;

  let currentRecorder = null;
  let activeInputMode = 'text';
  let voiceDetectedAt = 0;
  let lastVoiceAt = 0;

  function saveMutePreference() {
    try {
      if (typeof localStorage !== 'undefined' && typeof localStorage.setItem === 'function') {
        localStorage.setItem('kyle_muted', store.muted ? 'true' : 'false');
      }
    } catch (_) {
      // Muting still works when storage is unavailable or blocked.
    }
  }

  let storedMuted = null;
  try {
    if (typeof localStorage !== 'undefined' && typeof localStorage.getItem === 'function') {
      storedMuted = localStorage.getItem('kyle_muted');
    }
  } catch (_) {}
  if (storedMuted !== null && storedMuted !== '') {
    store.muted = storedMuted === 'true';
    ui.setMuted(store.muted);
  }

  ui.bind({
    onOrb: () => {
      if (store.current === store.states.SPEAKING) {
        interrupt(true);
        return;
      }
      if (store.current === store.states.LISTENING || store.current === store.states.TRANSCRIBING) {
        stopListening();
        return;
      }
      if ([store.states.THINKING, store.states.NAVIGATING, store.states.WORKING].includes(store.current)) {
        interrupt(false);
        ui.setLiveText('Action canceled.', 2500);
        return;
      }
      activeInputMode = 'voice';
      startListening();
    },
    onMute: () => {
      store.muted = !store.muted;
      saveMutePreference();
      ui.setMuted(store.muted);
      if (store.muted) interrupt(false);
      window.dispatchEvent(new CustomEvent('kyle:mute-change', { detail: { muted: store.muted } }));
    },
    onTextFocus: () => stopAudioForText(),
    onText: prompt => {
      stopAudioForText();
      activeInputMode = 'text';
      handlePrompt(prompt);
    }
  });

  window.addEventListener('kyle:toggle-mute', () => {
    store.muted = !store.muted;
    saveMutePreference();
    ui.setMuted(store.muted);
    if (store.muted) interrupt(false);
    window.dispatchEvent(new CustomEvent('kyle:mute-change', { detail: { muted: store.muted } }));
  });

  const whisperStatusCache = { ready: null, checkedAt: 0 };

  async function whisperReady() {
    const now = Date.now();
    const cacheMs = whisperStatusCache.ready ? 30000 : 1000;
    if (whisperStatusCache.ready !== null && now - whisperStatusCache.checkedAt < cacheMs) {
      return whisperStatusCache.ready;
    }
    try {
      const response = await fetch(`${API_BASE}/api/stt/status`, { cache: 'no-store' });
      if (!response.ok) return false;
      const status = await response.json();
      whisperStatusCache.ready = Boolean(status.loaded || status.available || status.downloading);
      whisperStatusCache.checkedAt = now;
      return whisperStatusCache.ready;
    } catch (_) {
      return false;
    }
  }

  async function prewarmVoiceInput() {
    try {
      await Promise.all([whisperReady(), audio.prewarmMic?.()]);
      console.log('[Kyle Voice] input stack prewarmed');
    } catch (error) {
      // A denied browser permission is handled normally on the first mic click.
      console.log('[Kyle Voice] microphone prewarm deferred:', error.message || error);
    }
  }

  setTimeout(prewarmVoiceInput, 0);
  window.addEventListener('beforeunload', () => audio.cleanupMic?.(true));

  async function startListening() {
    if (store.muted) return;
    if (store.current === store.states.LISTENING || store.current === store.states.TRANSCRIBING) return;
    if ([store.states.THINKING, store.states.NAVIGATING, store.states.WORKING].includes(store.current)) {
      console.log('[Kyle Voice] startListening suppressed: Kyle is actively working');
      return;
    }
    activeInputMode = 'voice';
    interrupt(false);

    activeRun += 1;
    const run = activeRun;
    recognitionTranscript = '';
    voiceDetectedAt = 0;
    lastVoiceAt = 0;
    const startedAt = performance.now();

    store.set(store.states.LISTENING);
    ui.setLiveText('Listening…');

    const micPromise = audio.openMic();
    const whisperPromise = whisperReady();

    try {
      await micPromise;
      if (run !== activeRun || activeInputMode !== 'voice') return;
      console.log(`[Kyle Voice] mic ready after ${Math.round(performance.now() - startedAt)} ms`);
      const useWhisper = await whisperPromise;
      if (useWhisper) return startWhisperListening(run, true);
      return startBrowserListening(run, true);
    } catch (error) {
      console.warn('[Kyle Voice] mic startup failed:', error.message || error);
      if (run !== activeRun || activeInputMode !== 'voice') return;
      return startBrowserListening(run, false);
    }
  }

  async function startWhisperListening(run, micReady = false) {
    try {
      if (!micReady) await audio.openMic();
      if (run !== activeRun || activeInputMode !== 'voice') return;

      store.set(store.states.LISTENING);
      ui.setLiveText('Listening (Whisper)...');
      console.log('[Kyle Voice] local Whisper recording started');

      currentRecorder = audio.startRecording(
        null,
        blob => transcribeWithWhisper(blob, run)
      );

      recognitionTimer = setTimeout(() => stopListening(), 15000);
    } catch (error) {
      console.warn('[Kyle Voice] local recording unavailable:', error.message || error);
      audio.cleanupMic();
      if (run === activeRun && activeInputMode === 'voice') {
        startBrowserListening(run);
      }
    }
  }

  async function transcribeWithWhisper(blob, run) {
    clearTimeout(recognitionTimer);
    recognitionTimer = null;
    currentRecorder = null;
    audio.scheduleMicClose?.(10000);

    if (run !== activeRun || activeInputMode !== 'voice') return;
    if (!blob || blob.size < 1000) {
      store.set(store.states.IDLE);
      ui.setLiveText('');
      return;
    }

    store.set(store.states.TRANSCRIBING);
    ui.setLiveText('Transcribing with Whisper...');

    const form = new FormData();
    form.append('audio', blob, 'kyle.webm');

    try {
      const response = await fetch(`${API_BASE}/api/stt/transcribe`, {
        method: 'POST',
        body: form
      });
      if (!response.ok) throw new Error(`STT returned ${response.status}`);
      const data = await response.json();
      const transcript = String(data.text || '').trim();

      if (run !== activeRun || activeInputMode !== 'voice') return;

      if (!transcript) {
        store.set(store.states.IDLE);
        ui.setLiveText('');
        return;
      }

      console.log('[Kyle Voice] Whisper transcript ready:', transcript);
      ui.setLiveText(transcript);
      handlePrompt(transcript, run);
    } catch (error) {
      console.warn('[Kyle Voice] Whisper failed:', error.message || error);
      if (run === activeRun && activeInputMode === 'voice' && SpeechRecognition) {
        ui.setLiveText('Local STT failed. Using browser fallback…', 1800);
        setTimeout(() => {
          if (run === activeRun && activeInputMode === 'voice') startBrowserListening(run);
        }, 150);
      } else {
        fail('Voice transcription failed. You can still type to Kyle.');
      }
    }
  }

  async function startBrowserListening(run, micReady = false) {
    if (!SpeechRecognition) {
      fail('Voice input is unavailable. You can still type to Kyle.');
      return;
    }

    try {
      if (!micReady) await audio.openMic();
      if (run !== activeRun || activeInputMode !== 'voice') return;

      recognition = new SpeechRecognition();
      recognition.lang = 'en-IN';
      recognition.interimResults = true;
      recognition.continuous = false;
      recognition.maxAlternatives = 1;

      recognition.onstart = () => {
        if (run !== activeRun || activeInputMode !== 'voice') {
          try { recognition.abort(); } catch (_) {}
          return;
        }
        store.set(store.states.LISTENING);
        ui.setLiveText('Listening…');
        console.log('[Kyle Voice] browser fallback recognition started');
      };

      recognition.onresult = event => {
        let interim = '';
        let finalText = '';
        for (let index = event.resultIndex; index < event.results.length; index += 1) {
          const text = event.results[index][0]?.transcript || '';
          if (event.results[index].isFinal) finalText += text;
          else interim += text;
        }
        if (finalText.trim()) recognitionTranscript = `${recognitionTranscript} ${finalText}`.trim();
        ui.setLiveText((recognitionTranscript || interim).trim());
      };

      recognition.onerror = event => {
        console.warn('[Kyle Voice] browser recognition error:', event.error);
        if (event.error === 'aborted' || event.error === 'no-speech') return;
        fail(`Voice input could not continue (${event.error}).`);
      };

      recognition.onend = () => finishBrowserRecognition(run);
      recognition.start();
      recognitionTimer = setTimeout(() => stopListening(), 15000);
    } catch (error) {
      console.error('[Kyle Voice] mic failed:', error.message || error);
      audio.cleanupMic();
      fail('Microphone access failed. You can still type to Kyle.');
    }
  }

  function stopListening() {
    clearTimeout(recognitionTimer);
    recognitionTimer = null;

    if (currentRecorder && currentRecorder.state !== 'inactive') {
      try { currentRecorder.stop(); } catch (_) {}
      return;
    }

    if (recognition) {
      try { recognition.stop(); } catch (_) { finishBrowserRecognition(activeRun); }
      return;
    }

    audio.cleanupMic();
    store.set(store.states.IDLE);
  }

  function finishBrowserRecognition(run) {
    clearTimeout(recognitionTimer);
    recognitionTimer = null;
    recognition = null;
    audio.scheduleMicClose?.(10000);
    ui.setAmplitude(0, 0);
    if (run !== activeRun) return;

    const transcript = recognitionTranscript.trim();
    recognitionTranscript = '';
    if (!transcript) {
      store.set(store.states.IDLE);
      ui.setLiveText('');
      return;
    }

    handlePrompt(transcript, run);
  }

  function handleMicAmplitude(value) {
    if (store.muted) return;
    if (store.current === store.states.LISTENING) {
      ui.setAmplitude(value, 0.016);
      const now = performance.now();
      if (value > 0.035) {
        if (!voiceDetectedAt) voiceDetectedAt = now;
        lastVoiceAt = now;
      } else if (currentRecorder && voiceDetectedAt && now - voiceDetectedAt > 650 && now - lastVoiceAt > 900) {
        stopListening();
      }
    }
  }

  async function guardWorkNarration(reply, voice) {
    const combined = `${reply || ''} ${voice || ''}`;
    const makesWorkClaim = /\b(drafts? (?:are )?waiting|prepared work|ready for review|waiting for review|tasks? waiting.*work|work tab.*(?:draft|prepared|review))\b/i.test(combined);
    if (!makesWorkClaim) return { reply, voice };

    try {
      const response = await fetch(`${API_BASE}/api/work/jobs`, { cache: 'no-store' });
      if (!response.ok) return { reply, voice };
      const jobs = await response.json();
      const live = (Array.isArray(jobs) ? jobs : []).filter(job => [
        'queued','reading_context','planning','researching','generating','drafting_reply',
        'creating_files','verifying','preparing','working','waiting_local_model',
        'waiting_approval','auto_send_countdown','needs_input'
      ].includes(job.status));
      if (live.length === 0) {
        const truth = 'There are no prepared Work items waiting for review right now.';
        return { reply: truth, voice: truth };
      }
    } catch (_) {}
    return { reply, voice };
  }

  async function handlePrompt(prompt, run = ++activeRun) {
    const cleanPrompt = String(prompt || '').trim();
    if (!cleanPrompt) return;

    store.addMessage('user', cleanPrompt);
    const overviewCanvasStarted = window.KyleCanvas?.beginForPrompt?.(cleanPrompt) || false;

    if (window.KylePlanner?.isUndo(cleanPrompt)) {
      const undone = await window.KyleExecutor?.undoLast?.();
      const reply = undone?.message || 'There is nothing I can safely undo yet.';
      store.addMessage('kyle', reply);
      ui.setLiveText(reply, 4200);
      speak(reply, run);
      return;
    }

    if (window.KyleExecutor?.pending?.() && window.KylePlanner?.isApproval(cleanPrompt)) {
      const approved = await window.KyleExecutor.approvePending();
      store.addMessage('kyle', approved.message);
      ui.setLiveText(approved.message, 4200);
      speak(approved.message, run);
      return;
    }

    if (window.KyleExecutor?.pending?.() && window.KylePlanner?.isCancellation(cleanPrompt)) {
      const cancelled = window.KyleExecutor.cancelPending();
      store.addMessage('kyle', cancelled.message);
      ui.setLiveText(cancelled.message, 4200);
      speak(cancelled.message, run);
      return;
    }

    // Only obvious navigation keeps a local fast path. Mail meaning and search
    // are planned by the server agent so multi-word names and context are semantic.
    const isCalendar = /\b(open|show|go\s+to)\s+(?:my\s+)?calendar\b/i.test(cleanPrompt);
    if (isCalendar) {
      await executeCalendarGuidance(cleanPrompt, run);
      return;
    }

    const resolution = window.KyleReferents?.resolvePrompt(cleanPrompt) || {
      hasReference: false,
      references: [],
      unresolved: false
    };

    const hasExplicitMailRecipient = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(cleanPrompt)
      && /\b(send|email|mail|compose|write)\b/i.test(cleanPrompt);
    if (resolution.unresolved && !hasExplicitMailRecipient) {
      const clarification = resolution.clarification || 'Which item do you mean? Select it and ask me again.';
      store.addMessage('kyle', clarification);
      ui.setLiveText(clarification, 5200);
      speak(clarification, run);
      return;
    }

    try {
      store.set(store.states.THINKING);
      const activeDraft = window.KyleUi?.active?.getActiveDraft?.() || null;
      const selectedEmail = window.AgentMail?.getSelectedEmail?.() || null;
      // Composer intent must represent a WRITE/SEND action, not a read-only
      // mention of the word "mail". This keeps commands such as
      // "show me the most recent mail" on the Inbox guidance path.
      const directRecipient =
        /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|\bto\s+[A-Z0-9._%+@-]+|\b(?:him|her|them)\b/i.test(cleanPrompt);

      const readOnlyMailIntent =
        /\b(?:show|find|open|read|search|summarize|summary|latest|recent|newest|most\s+recent|what|which)\b/i.test(cleanPrompt);

      const composerRequest =
        /\breply\b/i.test(cleanPrompt) ||
        (
          /\b(?:draft|compose|write)\b/i.test(cleanPrompt) &&
          (
            /\b(?:email|mail|message|reply)\b/i.test(cleanPrompt) ||
            directRecipient
          )
        ) ||
        (
          /\bsend\b/i.test(cleanPrompt) &&
          (
            Boolean(activeDraft) ||
            directRecipient ||
            /\bsaying\b|\bsubject\b|\bbody\b/i.test(cleanPrompt)
          )
        ) ||
        (
          /\b(?:email|mail)\b/i.test(cleanPrompt) &&
          directRecipient &&
          !readOnlyMailIntent
        );
      if (composerRequest && !activeDraft) {
        window.KyleUi?.active?.openPreparingComposer?.(
          /\breply\b/i.test(cleanPrompt) ? 'reply' : 'compose',
          cleanPrompt
        );
        ui.setSubtitle?.('Preparing draft...');
      }

      const askAgent = async (message) => {
        const response = await fetch(`${API_BASE}/api/kyle/agent`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: message,
            userId: getUserId(),
            context: store.context,
            uiContext: window.MailmateContext?.snapshot?.() || {},
            resolvedReferences: resolution.references,
            selectedCalendarEventId: window.AgentCalendar?.getSelectedEventId?.() || null,
            activeDraft: activeDraft,
            selectedEmail: selectedEmail,
            conversation: (store.conversation || []).slice(-12)
          })
        });
        if (!response.ok) throw new Error(`Kyle returned ${response.status}`);
        return response.json();
      };

      // Tool-call enforcement: a composer request MUST come back with a proper
      // mail.* tool action. If the model forgot the tool call, retry with an
      // explicit error reminder before giving up.
      const composerToolMissing = (payload) => !(payload?.actions || [])
        .some(action => ['mail.compose', 'mail.reply', 'mail.update_draft', 'mail.send_draft'].includes(action.tool));
      const composerNeedsClarification = (payload) =>
        ['message_required', 'recipient_required', 'contact_disambiguation'].includes(payload?.mode);

      const MAX_TOOL_RETRIES = 2;
      let data = null;
      let lastError = null;
      for (let attempt = 0; attempt <= MAX_TOOL_RETRIES; attempt++) {
        try {
          const retryNote = attempt > 0
            ? `${cleanPrompt}\n\nPlease use the appropriate mail tool for this request instead of returning text only.`
            : cleanPrompt;
          data = await askAgent(retryNote);
          if (!composerRequest || composerNeedsClarification(data) || !composerToolMissing(data)) {
            lastError = null;
            break;
          }
          lastError = new Error('agent returned no composer tool call');
          console.warn(`[Kyle Agent] missing composer tool call (attempt ${attempt + 1}/${MAX_TOOL_RETRIES + 1}), retrying`);
        } catch (err) {
          lastError = err;
          if (attempt < MAX_TOOL_RETRIES) {
            await new Promise(resolve => setTimeout(resolve, 600 * (attempt + 1)));
            continue;
          }
        }
      }

      if (composerRequest && lastError && composerToolMissing(data || {})) {
        const message = 'Kyle could not produce a valid composer tool call after retrying. The draft window is still open.';
        window.KyleUi?.active?.setComposerState?.('error', message);
        ui.setSubtitle?.(message);
        store.addMessage('kyle', message);
        return;
      }
      if (!data) throw lastError || new Error('Kyle returned no response');

      if (composerRequest && composerNeedsClarification(data)) {
        window.KyleUi?.active?.closeComposer?.();
        window.KyleCanvas?.cancelPending?.();
      }

      const useOverviewCanvas = window.KyleCanvas?.shouldPresent?.(cleanPrompt, data) || false;
      if (overviewCanvasStarted && !useOverviewCanvas) window.KyleCanvas?.cancelPending?.();

      if (data.mode !== 'semantic-agent') {
        const recentFallback = /\b(most\s+recent|latest|newest|show\s+(?:me\s+)?(?:the\s+)?recent)\s+(?:e?mail|message)\b/i.test(cleanPrompt);
        if (recentFallback) {
          await executeRecentEmailGuidance(cleanPrompt, run);
          return;
        }
        const senderFallback = cleanPrompt.match(/\b(?:show\s+|find\s+)?(?:mails?|emails?|messages?)\s+from\s+(.+)$/i);
        if (senderFallback) {
          const candidate = senderFallback[1].replace(/[?.!]+$/, '').trim();
          if (candidate) {
            await executeSenderEmailGuidance(candidate, cleanPrompt, run);
            return;
          }
        }
      }
      let reply = String(data.reply || data.text || '').trim() || 'Done.';
      let voice = String(data.voice || compactVoice(reply)).trim();

      ({ reply, voice } = await guardWorkNarration(reply, voice));

      if (run !== activeRun) return;

      const plan = window.KylePlanner?.fromResponse(cleanPrompt, data, resolution) || {
        id: `run_${Date.now().toString(36)}`,
        goal: cleanPrompt,
        steps: data.actions || []
      };
      const transaction = await window.KyleExecutor?.execute?.(plan);
      if (transaction && !['complete', 'waiting-approval'].includes(transaction.status)) {
        console.warn('[Kyle Agent] action transaction ended', transaction.status, transaction);
        const failedStep = [...(transaction.steps || [])].reverse().find(step => step.status === 'failed');
        const failureText = failedStep?.error
          ? `I couldn't complete ${failedStep.action?.tool || 'that action'}: ${failedStep.error}`
          : 'I could not complete that action.';
        if (composerRequest) {
          window.KyleUi?.active?.setComposerState?.('error', failureText);
        }
        reply = failureText;
        voice = failureText;
      }
      if (transaction?.status === 'waiting-approval') {
        reply = 'The preview is ready. Say confirm to save it, or cancel to leave your calendar unchanged.';
        voice = reply;
      } else if (!transaction || transaction.status === 'complete') {
        const observed = transaction?.narration || narrateObservedActions(data.actions || []);
        if (observed) {
          reply = observed;
          voice = observed;
        }
      }
      applyCommand(data.command);
      if (data.brief?.items?.length && !useOverviewCanvas) {
        ui.renderBrief(data.brief.title || 'Kyle', data.brief.items);
      }

      if (useOverviewCanvas) {
        window.KyleCanvas?.prepare?.({ canvas: data.canvas, reply, text: reply, prompt: cleanPrompt });
        await window.KyleCanvas?.reveal?.();
      }

      store.addMessage('kyle', reply);
      ui.setLiveText(voice || reply, 5200);
      speak(voice || reply, run);
    } catch (error) {
      console.error('[Kyle Voice] chat failed:', error.message || error);
      window.KyleCanvas?.showError?.(error.message || 'Kyle chat failed.');
      showStructuredError(error.message || 'Kyle chat failed.', () => handlePrompt(cleanPrompt, run));
    }
  }

  function applyCommand(command) {
    if (!command) return;
    if (command.type === 'open_page' && command.page) {
      window.KyleActions.openPage(command.page);
      return;
    }
    if (command.type === 'calendar_refresh') {
      window.dispatchEvent(new CustomEvent('harness:calendar-refresh'));
      return;
    }
    if (command.type === 'set_preference' && command.key) {
      window.dispatchEvent(new CustomEvent('mailmate:set-preference', { detail: command }));
    }
  }

  function compactVoice(text) {
    const clean = String(text || '')
      .replace(/[*_#>`]/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    if (!clean) return '';
    const sentences = clean.split(/(?<=[.!?])\s+/);
    let spoken = sentences[0] || clean;
    if (spoken.length < 75 && sentences[1]) spoken += ' ' + sentences[1];
    if (spoken.length > 190) spoken = spoken.slice(0, 190).replace(/\s+\S*$/, '') + '.';
    return spoken;
  }

  function speak(text, run, onReady = null) {
    stopSpeech(false);
    let readyPromise = null;
    const signalReady = () => {
      if (!readyPromise) {
        try {
          readyPromise = Promise.resolve(onReady?.());
        } catch (_) {
          readyPromise = Promise.resolve();
        }
      }
      return readyPromise;
    };
    const beginSpeaking = async () => {
      await signalReady();
      if (run !== activeRun) return false;
      await new Promise(resolve => {
        if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => requestAnimationFrame(resolve));
        else setTimeout(resolve, 0);
      });
      if (run !== activeRun) return false;
      store.set(store.states.SPEAKING);
      speakingStartedAt = typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
      smoothedSpeechEnergy = 0;
      startSpeechAnimation(text, run);
      return true;
    };
    if (store.muted || !text) {
      signalReady();
      store.set(window.KyleExecutor?.pending?.() ? store.states.WAITING_APPROVAL : store.states.IDLE);
      return;
    }

    if (typeof window.Audio === 'function' && window.URL?.createObjectURL) {
      speakWithElevenLabs(text, run, beginSpeaking).then(played => {
        if (!played && run === activeRun) {
          store.set(window.KyleExecutor?.pending?.() ? store.states.WAITING_APPROVAL : store.states.IDLE);
          ui.setLiveText(text);
        }
      });
      return;
    }
    store.set(window.KyleExecutor?.pending?.() ? store.states.WAITING_APPROVAL : store.states.IDLE);
  }

  async function speakWithElevenLabs(text, run, onReady = null) {
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    speechRequest = controller;
    try {
      const response = await fetch(`${API_BASE}/api/voice/speak`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
        signal: controller?.signal
      });
      if (!response.ok || run !== activeRun) return false;
      const blob = await response.blob();
      if (run !== activeRun) return false;
      elevenAudioUrl = window.URL.createObjectURL(blob);
      elevenAudio = new window.Audio(elevenAudioUrl);
      elevenAudio.onended = () => finishSpeech(run);
      elevenAudio.onerror = () => {
        stopElevenAudio();
        if (run === activeRun) {
          store.set(window.KyleExecutor?.pending?.() ? store.states.WAITING_APPROVAL : store.states.IDLE);
          ui.setLiveText(text);
        }
      };
      await elevenAudio.play();
      if (!await onReady?.()) {
        stopElevenAudio();
        return false;
      }
      return true;
    } catch (error) {
      if (error?.name !== 'AbortError') {
        console.warn('[Kyle Voice] ElevenLabs failed:', error);
      }
      return false;
    } finally {
      if (speechRequest === controller) speechRequest = null;
    }
  }

  function startSpeechAnimation(text, run) {
    if (speakingRaf && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(speakingRaf);
    if (typeof requestAnimationFrame !== 'function') return;
    const estimatedDuration = Math.max(1200, text.length * 44);

    const tick = now => {
      if (run !== activeRun || store.current !== store.states.SPEAKING) return;
      const elapsed = now - speakingStartedAt;
      const t = elapsed / 1000;
      const progress = Math.min(0.99, elapsed / estimatedDuration);
      const character = text[Math.floor(progress * text.length)] || '';
      const punctuationDip = /[.,!?;:]/.test(character) ? 0.18 : 1;
      const syllables = Math.abs(Math.sin(t * 7.1 + Math.sin(t * 1.7))) * 0.38;
      const consonants = Math.abs(Math.sin(t * 13.7 + 1.2)) * 0.23;
      const phrase = 0.18 + Math.abs(Math.sin(t * 2.25 + 0.4)) * 0.22;
      const microPause = Math.sin(t * 3.9) > 0.93 ? 0.22 : 1;
      const target = Math.min(1, (phrase + syllables + consonants) * punctuationDip * microPause);
      smoothedSpeechEnergy = smoothedSpeechEnergy * 0.72 + target * 0.28;
      ui.setAmplitude(smoothedSpeechEnergy, 0.018);
      speakingRaf = requestAnimationFrame(tick);
    };

    speakingRaf = requestAnimationFrame(tick);
  }

  function finishSpeech(run) {
    if (run !== activeRun) return;
    stopSpeech(false);
    store.set(window.KyleExecutor?.pending?.() ? store.states.WAITING_APPROVAL : store.states.IDLE);
    console.log('[Kyle Voice] short response finished');
  }

  function stopSpeech(cancelVoice = true) {
    if (speakingRaf && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(speakingRaf);
    speakingRaf = null;
    if (cancelVoice && 'speechSynthesis' in window) window.speechSynthesis.cancel();
    if (speechRequest) speechRequest.abort();
    speechRequest = null;
    stopElevenAudio();
    utterance = null;
    audio.cleanupMic();
    ui.setAmplitude(0, 0);
    smoothedSpeechEnergy = 0;
  }

  function stopElevenAudio() {
    if (elevenAudio) {
      elevenAudio.onended = null;
      elevenAudio.onerror = null;
      try { elevenAudio.pause(); } catch (_) {}
      elevenAudio = null;
    }
    if (elevenAudioUrl) {
      try { window.URL.revokeObjectURL(elevenAudioUrl); } catch (_) {}
      elevenAudioUrl = '';
    }
  }

  function interrupt(thenListen) {
    activeRun += 1;
    clearTimeout(recognitionTimer);
    recognitionTimer = null;

    if (currentRecorder && currentRecorder.state !== 'inactive') {
      try {
        currentRecorder.onstop = null;
        currentRecorder.stop();
      } catch (_) {}
      currentRecorder = null;
    }

    if (recognition) {
      recognition.onend = null;
      try { recognition.abort(); } catch (_) {}
      recognition = null;
    }

    stopSpeech(true);
    audio.cleanupMic();
    store.set(store.states.INTERRUPTED);
    if (thenListen && !store.muted) {
      activeInputMode = 'voice';
      setTimeout(() => startListening(), 90);
    } else {
      store.set(store.states.IDLE);
    }
  }

  function narrateObservedActions(actions) {
    const filterAction = [...actions].reverse().find(action => action?.tool === 'inbox.set_filter');
    if (filterAction) {
      const filter = String(filterAction.args?.filter || 'all');
      const active = document.querySelector('.filter-tab.active')?.dataset.filter;
      if (active !== filter) return '';
      const count = document.querySelectorAll('#emailList .email-item').length;
      const nouns = {
        important: ['important message', 'important messages'],
        unread: ['unread message', 'unread messages'],
        action: ['message requiring action', 'messages requiring action'],
        all: ['message', 'messages']
      };
      const [singular, plural] = nouns[filter] || nouns.all;
      if (count === 0) return `You don't have any ${plural} right now.`;
      return count === 1 ? `I found 1 ${singular}.` : `I found ${count} ${plural}.`;
    }
    return '';
  }

  function stopAudioForText() {
    activeInputMode = 'text';
    clearTimeout(recognitionTimer);
    recognitionTimer = null;
    audio.cancelScheduledClose?.();

    const active =
      recognition ||
      currentRecorder ||
      audio.isMicLive?.() ||
      [
        store.states.LISTENING,
        store.states.TRANSCRIBING,
        store.states.SPEAKING
      ].includes(store.current);

    if (active) interrupt(false);
  }

  function showStructuredError(errInfo, retryCallback = null) {
    store.set(store.states.ERROR);
    ui.setAmplitude(0, 0);

    let title = 'Action could not complete';
    let reason = 'Something went wrong while processing your request.';
    let actions = [];

    const raw = String(errInfo?.message || errInfo || '').toLowerCase();
    if (raw.includes('failed to fetch') || raw.includes('networkerror') || raw.includes('timed out') || raw.includes('aborted') || raw.includes('connection')) {
      title = 'Server connection took too long';
      reason = 'Could not establish connection with the AI server. The backend might be busy or restarting.';
      actions = [
        { label: 'Retry now', primary: true, icon: 'fas fa-arrows-rotate', onClick: () => { if (retryCallback) retryCallback(); else ui.closeSurface(); } },
        { label: 'Check Status', icon: 'fas fa-signal', onClick: () => window.KyleActions?.openPage('status') },
        { label: 'Open Inbox', icon: 'fas fa-inbox', onClick: () => window.KyleActions?.openPage('inbox') }
      ];
    } else if (raw.includes('inbox') || raw.includes('message') || raw.includes('empty')) {
      title = 'Inbox data unavailable';
      reason = 'The message list could not be loaded from your mailbox.';
      actions = [
        { label: 'Refresh Inbox', primary: true, icon: 'fas fa-arrows-rotate', onClick: () => window.AgentMail?.refresh?.() },
        { label: 'Open Inbox', icon: 'fas fa-inbox', onClick: () => window.KyleActions?.openPage('inbox') }
      ];
    } else if (raw.includes('reconnect_google') || raw.includes('token') || raw.includes('auth')) {
      title = 'Google session expired';
      reason = 'Your Gmail session needs to be renewed to access or send emails.';
      actions = [
        { label: 'Reconnect Google', primary: true, icon: 'fab fa-google', onClick: () => window.location.href = '/login' },
        { label: 'Check Status', icon: 'fas fa-signal', onClick: () => window.KyleActions?.openPage('status') }
      ];
    } else {
      title = 'Kyle needs attention';
      reason = String(errInfo?.message || errInfo || 'Request could not be completed.');
      actions = [
        { label: 'Retry', primary: true, icon: 'fas fa-arrows-rotate', onClick: () => { if (retryCallback) retryCallback(); else ui.closeSurface(); } },
        { label: 'Dismiss', onClick: () => ui.closeSurface() }
      ];
    }

    if (ui.showErrorRecovery) {
      ui.showErrorRecovery({ title, reason, actions });
    }
    ui.setLiveText(reason, 4500);
    window.dispatchEvent(new CustomEvent('harness:error', { detail: { message: reason } }));
  }

  function fail(message) {
    showStructuredError(message);
  }

  function getEmailTimestamp(email) {
    if (!email) return 0;
    if (email.internal_date) {
      const ms = Number(email.internal_date);
      if (!Number.isNaN(ms) && ms > 0) return ms;
    }
    if (email.internalDate) {
      const ms = Number(email.internalDate);
      if (!Number.isNaN(ms) && ms > 0) return ms;
    }
    if (email.timestamp) {
      const t = Number(email.timestamp);
      if (!Number.isNaN(t) && t > 1000000000) return t > 1000000000000 ? t : t * 1000;
      const parsed = Date.parse(email.timestamp);
      if (!Number.isNaN(parsed)) return parsed;
    }
    if (email.date) {
      const parsed = Date.parse(email.date);
      if (!Number.isNaN(parsed)) return parsed;
    }
    return 0;
  }

  async function executeRecentEmailGuidance(cleanPrompt, run) {
    store.set(store.states.THINKING);

    ui.showCommandCard?.({
      title: 'Kyle',
      subtitle: cleanPrompt,
      badge: 'THINKING',
      steps: [
        { id: 'step_nav', label: 'Switch to Inbox', status: 'active' },
        { id: 'step_fetch', label: 'Check latest messages', status: 'pending' },
        { id: 'step_spotlight', label: 'Highlight newest email', status: 'pending' },
        { id: 'step_open', label: 'Open message thread', status: 'pending' }
      ]
    });

    // 1. Navigate to Inbox with physical orb travel
    store.set(store.states.NAVIGATING);
    const inboxTab = document.querySelector('.nav-item[data-page="inbox"]') ||
                     document.querySelector('[data-page="inbox"]');
    if (inboxTab && window.KyleMotion?.moveOrbTo) {
      await window.KyleMotion.moveOrbTo(inboxTab);
    }
    window.KyleActions?.openPage('inbox');
    ui.updateCommandStep?.('step_nav', { status: 'done', label: 'Switched to Inbox' });

    // 2. Ensure inbox data is loaded
    store.set(store.states.WORKING);
    ui.updateCommandStep?.('step_fetch', { status: 'active', label: 'Checking latest messages…' });
    let emails = window.AgentMail?.getEmails?.() || store.context?.emails || [];
    if (!emails.length) {
      try {
        await window.AgentMail?.refresh?.();
        await window.KyleMotion?.wait?.(300);
        emails = window.AgentMail?.getEmails?.() || store.context?.emails || [];
      } catch (err) {
        console.warn('[Kyle] inbox refresh failed:', err);
      }
    }

    if (!emails.length) {
      if (window.KyleMotion?.moveOrbHome) await window.KyleMotion.moveOrbHome();
      ui.updateCommandStep?.('step_fetch', { status: 'failed', label: 'No messages found in inbox' });
      showStructuredError({
        title: 'Inbox is empty or loading',
        reason: 'Could not find any messages in your inbox yet.',
        actions: [
          { label: 'Refresh data', primary: true, icon: 'fas fa-arrows-rotate', onClick: () => executeRecentEmailGuidance(cleanPrompt, run) },
          { label: 'Open Inbox', icon: 'fas fa-inbox', onClick: () => window.KyleActions?.openPage('inbox') }
        ]
      });
      return;
    }
    ui.updateCommandStep?.('step_fetch', { status: 'done', label: 'Checked latest messages' });

    // Sort by timestamp descending - never rely solely on array index
    const sortedEmails = [...emails].sort((a, b) => getEmailTimestamp(b) - getEmailTimestamp(a));
    const topEmail = sortedEmails[0] || emails[0];

    // 3. Spotlight and travel beside top email row
    ui.updateCommandStep?.('step_spotlight', { status: 'active', label: 'Highlighting newest message…' });
    const topEmailId = topEmail?.id || topEmail?.gmail_id;
    const topEmailRow = (topEmailId ? document.querySelector(`[data-kyle-id="${topEmailId}"]`) : null) ||
                        (topEmailId ? document.querySelector(`[data-email-id="${topEmailId}"]`) : null) ||
                        document.querySelector('.email-item[data-index="0"]') ||
                        document.querySelector('.email-item');

    if (topEmailRow && window.KyleMotion?.moveOrbTo) {
      await window.KyleMotion.moveOrbTo(topEmailRow);
    }
    if (topEmailRow && window.KyleSpotlight?.spotlight) {
      window.KyleSpotlight.spotlight(topEmailRow, { duration: 2500, scroll: false });
      await window.KyleMotion?.wait?.(350);
    }
    ui.updateCommandStep?.('step_spotlight', { status: 'done', label: 'Highlighted newest message' });

    // 4. Open email thread and glide beside detail view
    ui.updateCommandStep?.('step_open', { status: 'active', label: 'Opening thread…' });
    if (topEmail && window.AgentMail?.openEmail) {
      await window.AgentMail.openEmail(topEmail);
      await window.KyleMotion?.wait?.(300);
    } else if (topEmailRow) {
      topEmailRow.click();
      await window.KyleMotion?.wait?.(300);
    }

    const emailHeader = document.querySelector('.email-detail-header');
    if (emailHeader && window.KyleMotion?.moveOrbTo) {
      await window.KyleMotion.moveOrbTo(emailHeader);
    }
    if (emailHeader && window.KyleSpotlight?.spotlight) {
      window.KyleSpotlight.spotlight(emailHeader, { duration: 3500, scroll: false });
    }
    ui.updateCommandStep?.('step_open', { status: 'done', label: 'Opened message thread' });

    // 5. Return orb to dock when presenting results and command card
    if (window.KyleMotion?.moveOrbHome) {
      await window.KyleMotion.moveOrbHome();
    }

    // 6. Present result & contextual action chips
    store.set(store.states.SUCCESS);
    const sender = (topEmail?.sender || 'Sender').split('<')[0].trim();
    const subject = topEmail?.subject || 'No Subject';

    ui.showCommandCard?.({
      title: 'Most recent mail',
      subtitle: `From: ${sender} · ${subject}`,
      badge: 'SUCCESS',
      steps: [
        { label: 'Switched to Inbox', status: 'done' },
        { label: 'Checked latest messages', status: 'done' },
        { label: 'Highlighted newest message', status: 'done' },
        { label: 'Opened message thread', status: 'done' }
      ],
      actions: [
        {
          label: 'Summarize',
          icon: 'fas fa-wand-magic-sparkles',
          primary: true,
          onClick: () => {
            handlePrompt(`Summarize this email: "${subject}" from ${sender}`);
          }
        },
        {
          label: 'Draft reply',
          icon: 'fas fa-reply',
          onClick: () => {
            const rawSender = topEmail?.sender || '';
            const match = rawSender.match(/<(.+)>/);
            const addr = match ? match[1] : rawSender;
            window.KyleUi?.active?.openComposer?.({
              to: addr,
              recipient: rawSender,
              subject: subject.toLowerCase().startsWith('re:') ? subject : `Re: ${subject}`,
              thread_id: topEmail?.thread_id || topEmail?.threadId || topEmail?.id
            }, 'reply');
          }
        },
        {
          label: 'Mark important',
          icon: 'fas fa-star',
          onClick: async () => {
            const emailId = topEmail?.id || topEmail?.gmail_id;
            if (!emailId) {
              ui.setLiveText('Could not find email ID to mark as important.', 3000);
              return;
            }
            ui.setLiveText('Marking email as important in Gmail…');
            try {
              const res = await fetch(`${API_BASE}/api/gmail/messages/${emailId}/important`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' }
              });
              if (!res.ok) {
                const errData = await res.json().catch(() => ({}));
                throw new Error(errData.error || `Server returned ${res.status}`);
              }
              const data = await res.json();
              if (topEmail) {
                topEmail.is_important = true;
                topEmail.labels = data.labels || [...(topEmail.labels || []), 'IMPORTANT', 'STARRED'];
              }
              await window.AgentMail?.refresh?.();
              const msg = 'Marked as important and starred in Gmail.';
              ui.setLiveText(msg, 3500);
              store.addMessage('kyle', msg);
            } catch (err) {
              console.error('[Kyle] Mark important failed:', err);
              showStructuredError({
                title: 'Could not mark email as important',
                reason: err.message || 'Gmail label update failed.',
                actions: [
                  { label: 'Try again', primary: true, icon: 'fas fa-star', onClick: () => { /* retry */ } }
                ]
              });
            }
          }
        }
      ]
    });

    const voiceNarration = `This is your most recent email from ${sender} regarding ${subject}. Would you like a summary or a reply draft?`;
    store.addMessage('kyle', voiceNarration);
    ui.setLiveText(voiceNarration, 5000);
    speak(voiceNarration, run);

    setTimeout(() => {
      if (store.current === store.states.SUCCESS) store.set(store.states.IDLE);
    }, 4000);
  }

  async function executeCalendarGuidance(cleanPrompt, run) {
    store.set(store.states.NAVIGATING);
    ui.showCommandCard?.({
      title: 'Calendar',
      subtitle: cleanPrompt,
      badge: 'NAVIGATING',
      steps: [
        { id: 'step_cal_nav', label: 'Switch to Calendar', status: 'active' },
        { id: 'step_cal_spot', label: 'Highlight current day schedule', status: 'pending' }
      ]
    });

    const calTab = document.querySelector('.nav-item[data-page="calendar"]') ||
                   document.querySelector('[data-page="calendar"]');
    if (calTab && window.KyleMotion?.moveOrbTo) {
      await window.KyleMotion.moveOrbTo(calTab);
    }
    window.KyleActions?.openPage('calendar');
    ui.updateCommandStep?.('step_cal_nav', { status: 'done', label: 'Switched to Calendar' });

    store.set(store.states.WORKING);
    ui.updateCommandStep?.('step_cal_spot', { status: 'active', label: 'Locating current day…' });

    const todayCol = document.querySelector('.calendar-day-column.is-today') ||
                     document.querySelector('.calendar-day-column');
    if (todayCol && window.KyleMotion?.moveOrbTo) {
      await window.KyleMotion.moveOrbTo(todayCol);
    }
    if (todayCol && window.KyleSpotlight?.spotlight) {
      window.KyleSpotlight.spotlight(todayCol, { duration: 3000, scroll: false });
    }
    ui.updateCommandStep?.('step_cal_spot', { status: 'done', label: 'Calendar ready' });

    if (window.KyleMotion?.moveOrbHome) {
      await window.KyleMotion.moveOrbHome();
    }

    store.set(store.states.SUCCESS);
    const reply = "Here is your calendar for this week.";
    store.addMessage('kyle', reply);
    ui.setLiveText(reply, 4000);
    speak(reply, run);

    setTimeout(() => {
      if (store.current === store.states.SUCCESS) store.set(store.states.IDLE);
    }, 3500);
  }

  async function executeSenderEmailGuidance(senderName, cleanPrompt, run) {
    store.set(store.states.NAVIGATING);
    ui.showCommandCard?.({
      title: `Emails from ${senderName}`,
      subtitle: cleanPrompt,
      badge: 'NAVIGATING',
      steps: [
        { id: 'step_s_nav', label: 'Switch to Inbox', status: 'active' },
        { id: 'step_s_find', label: `Filter messages from ${senderName}`, status: 'pending' },
        { id: 'step_s_open', label: 'Open newest matching email', status: 'pending' }
      ]
    });

    const inboxTab = document.querySelector('.nav-item[data-page="inbox"]') ||
                     document.querySelector('[data-page="inbox"]');
    if (inboxTab && window.KyleMotion?.moveOrbTo) {
      await window.KyleMotion.moveOrbTo(inboxTab);
    }
    window.KyleActions?.openPage('inbox');
    ui.updateCommandStep?.('step_s_nav', { status: 'done', label: 'Switched to Inbox' });

    store.set(store.states.WORKING);
    ui.updateCommandStep?.('step_s_find', { status: 'active', label: `Searching messages from ${senderName}…` });

    let emails = window.AgentMail?.getEmails?.() || store.context?.emails || [];
    const query = String(senderName || '').trim().toLowerCase();
    const queryTokens = query.split(/[\s._+-]+/).filter(Boolean);

    const matched = emails.filter(e => {
      const rawSender = (e.sender || '').toLowerCase();
      const fromName = (e.from?.name || '').toLowerCase();
      const fromEmail = (e.from?.email || '').toLowerCase();
      if (rawSender.includes(query) || fromName.includes(query) || fromEmail.includes(query)) {
        return true;
      }
      if (queryTokens.length > 1) {
        const combined = `${rawSender} ${fromName} ${fromEmail}`;
        return queryTokens.every(tok => combined.includes(tok));
      }
      return false;
    });

    if (!matched.length) {
      if (window.KyleMotion?.moveOrbHome) await window.KyleMotion.moveOrbHome();
      ui.updateCommandStep?.('step_s_find', { status: 'failed', label: `No emails found from ${senderName}` });
      showStructuredError({
        title: `No emails from ${senderName}`,
        reason: `Could not find any emails from ${senderName} in your inbox.`,
        actions: [
          { label: 'Show all mail', primary: true, icon: 'fas fa-inbox', onClick: () => window.KyleActions?.openPage('inbox') }
        ]
      });
      return;
    }

    // Sort matched by timestamp descending so newest is opened
    matched.sort((a, b) => getEmailTimestamp(b) - getEmailTimestamp(a));
    ui.updateCommandStep?.('step_s_find', { status: 'done', label: `Found ${matched.length} email${matched.length === 1 ? '' : 's'}` });

    const topMatch = matched[0];
    const topRow = document.querySelector(`[data-kyle-id="${topMatch.id || topMatch.gmail_id}"]`) ||
                   document.querySelector(`[data-email-id="${topMatch.id || topMatch.gmail_id}"]`) ||
                   document.querySelector('.email-item');

    if (topRow && window.KyleMotion?.moveOrbTo) {
      await window.KyleMotion.moveOrbTo(topRow);
    }
    if (topRow && window.KyleSpotlight?.spotlight) {
      window.KyleSpotlight.spotlight(topRow, { duration: 2500, scroll: false });
    }

    ui.updateCommandStep?.('step_s_open', { status: 'active', label: 'Opening thread…' });
    if (window.AgentMail?.openEmail) {
      await window.AgentMail.openEmail(topMatch);
      await window.KyleMotion?.wait?.(300);
    }

    const emailHeader = document.querySelector('.email-detail-header');
    if (emailHeader && window.KyleMotion?.moveOrbTo) {
      await window.KyleMotion.moveOrbTo(emailHeader);
    }
    ui.updateCommandStep?.('step_s_open', { status: 'done', label: 'Opened thread' });

    if (window.KyleMotion?.moveOrbHome) {
      await window.KyleMotion.moveOrbHome();
    }

    store.set(store.states.SUCCESS);
    const reply = `I found ${matched.length} email${matched.length === 1 ? '' : 's'} from ${senderName} and opened the latest one.`;
    store.addMessage('kyle', reply);
    ui.setLiveText(reply, 4500);
    speak(reply, run);

    setTimeout(() => {
      if (store.current === store.states.SUCCESS) store.set(store.states.IDLE);
    }, 4000);
  }

  function setContext(context) {
    store.context = context;
    window.dispatchEvent(new CustomEvent('harness:context', { detail: context }));
  }

  function runLocalAction(prompt) {
    const text = prompt.toLowerCase();
    const emails = store.context?.emails || [];

    if (/open\s+(my\s+)?calendar/.test(text)) {
      window.KyleActions.navigation.openCalendar();
    }

    if (/top\s*(ten|10)|important|priority/.test(text) && emails.length) {
      const ranked = emails
        .filter(email => /urgent|asap|blocked|approval|deadline|waiting|review|important/i.test(`${email.subject || ''} ${email.snippet || ''}`))
        .concat(emails)
        .filter((email, index, all) => all.findIndex(candidate => (candidate.id || candidate.gmail_id || candidate.subject) === (email.id || email.gmail_id || email.subject)) === index)
        .slice(0, 10);
      window.KyleActions.showEmailResults(ranked);
      ui.renderResults('Top emails', ranked);
    }

    const openMatch = text.match(/open\s+(?:email\s+)?(?:number\s+)?(\d+)/);
    if (openMatch) window.KyleActions.openEmail(openMatch[1]);
  }

  function getUserId() {
    return window.localStorage?.getItem?.('userId') || store.context?.user_id || '';
  }

  window.Kyle = { store, setContext, startListening, interrupt, handlePrompt };
})();
