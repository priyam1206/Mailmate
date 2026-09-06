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
  let speakingRaf = null;
  let speakingStartedAt = 0;
  let smoothedSpeechEnergy = 0;
  let bargePeaks = 0;

  ui.bind({
    onOrb: () => {
      if (store.current === store.states.SPEAKING) {
        interrupt(true);
        return;
      }
      if (store.current === store.states.LISTENING) {
        stopListening();
        return;
      }
      startListening();
    },
    onMute: () => {
      store.muted = !store.muted;
      ui.setMuted(store.muted);
      if (store.muted && store.current === store.states.SPEAKING) interrupt(false);
    },
    onText: prompt => handlePrompt(prompt)
  });

  async function startListening() {
    if (store.current === store.states.LISTENING) return;
    interrupt(false);

    if (!SpeechRecognition) {
      console.warn('[Kyle Voice] browser speech recognition unavailable');
      store.set(store.states.ERROR);
      ui.setLiveText('Voice input is not available in this browser. Type your message instead.', 4200);
      setTimeout(() => store.set(store.states.IDLE), 500);
      return;
    }

    activeRun += 1;
    const run = activeRun;
    recognitionTranscript = '';

    try {
      await audio.openMic();
      if (run !== activeRun) return;

      recognition = new SpeechRecognition();
      recognition.lang = 'en-US';
      recognition.interimResults = true;
      recognition.continuous = false;
      recognition.maxAlternatives = 1;

      recognition.onstart = () => {
        store.set(store.states.LISTENING);
        ui.setLiveText('');
        console.log('[Kyle Voice] browser recognition started');
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
        console.warn('[Kyle Voice] recognition error:', event.error);
        if (event.error === 'aborted' || event.error === 'no-speech') return;
        fail(`Browser voice input could not continue (${event.error}). Type your message instead.`);
      };

      recognition.onend = () => finishRecognition(run);
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
    if (recognition) {
      try { recognition.stop(); } catch (_) { finishRecognition(activeRun); }
    }
  }

  function finishRecognition(run) {
    clearTimeout(recognitionTimer);
    recognitionTimer = null;
    recognition = null;
    audio.cleanupMic();
    ui.setAmplitude(0, 0);
    if (run !== activeRun) return;

    const transcript = recognitionTranscript.trim();
    recognitionTranscript = '';
    if (!transcript) {
      store.set(store.states.IDLE);
      ui.setLiveText('', 0);
      return;
    }

    console.log('[Kyle Voice] browser transcript ready');
    handlePrompt(transcript, run);
  }

  function handleMicAmplitude(value) {
    if (store.current === store.states.LISTENING) {
      ui.setAmplitude(value, 0.016);
      return;
    }

    if (store.current !== store.states.SPEAKING || performance.now() - speakingStartedAt < 650) return;
    bargePeaks = value > 0.42 ? bargePeaks + 1 : Math.max(0, bargePeaks - 1);
    if (bargePeaks >= 5) {
      console.log('[Kyle Voice] barge-in detected');
      bargePeaks = 0;
      interrupt(true);
    }
  }

  async function handlePrompt(prompt, run = ++activeRun) {
    const cleanPrompt = String(prompt || '').trim();
    if (!cleanPrompt) return;

    store.addMessage('user', cleanPrompt);
    ui.setLiveText(cleanPrompt);
    runLocalAction(cleanPrompt);

    try {
      store.set(store.states.THINKING);
      const response = await fetch(`${API_BASE}/api/kyle/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: cleanPrompt, userId: getUserId(), context: store.context })
      });
      if (!response.ok) throw new Error(`Kyle returned ${response.status}`);
      const data = await response.json();
      const reply = String(data.reply || '').trim() || 'I can help with that. Which thread should we handle first?';
      if (run !== activeRun) return;
      store.addMessage('kyle', reply);
      ui.setLiveText(reply);
      speak(reply, run);
    } catch (error) {
      console.error('[Kyle Voice] chat failed:', error.message || error);
      fail(error.message || 'Kyle chat failed.');
    }
  }

  function speak(text, run) {
    stopSpeech(false);
    if (store.muted || !('speechSynthesis' in window)) {
      store.set(store.states.IDLE);
      ui.setLiveText(text, 5500);
      return;
    }

    store.set(store.states.SPEAKING);
    utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 0.98;
    utterance.pitch = 0.96;
    utterance.volume = 1;
    chooseVoice(utterance);

    utterance.onstart = () => {
      if (run !== activeRun) return;
      speakingStartedAt = performance.now();
      smoothedSpeechEnergy = 0;
      bargePeaks = 0;
      startSpeechAnimation(text, run);
      audio.openMic().catch(error => console.warn('[Kyle Voice] visual barge-in mic unavailable:', error.message || error));
      console.log('[Kyle Voice] browser TTS started');
    };

    utterance.onend = () => finishSpeech(run);
    utterance.onerror = event => {
      if (event.error === 'interrupted' || event.error === 'canceled') return;
      console.warn('[Kyle Voice] browser TTS error:', event.error);
      finishSpeech(run);
    };

    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
  }

  function chooseVoice(target) {
    const voices = window.speechSynthesis.getVoices();
    const preferred = voices.find(voice => /^en-IN/i.test(voice.lang) && /natural|google|microsoft/i.test(voice.name))
      || voices.find(voice => /^en-(IN|GB|US)/i.test(voice.lang));
    if (preferred) target.voice = preferred;
  }

  function startSpeechAnimation(text, run) {
    cancelAnimationFrame(speakingRaf);
    const estimatedDuration = Math.max(1600, text.length * 48);

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
    store.set(store.states.IDLE);
    ui.setLiveText(uiTextFromLastKyleMessage(), 4800);
    console.log('[Kyle Voice] browser TTS finished');
  }

  function stopSpeech(cancelVoice = true) {
    if (speakingRaf) cancelAnimationFrame(speakingRaf);
    speakingRaf = null;
    if (cancelVoice && 'speechSynthesis' in window) window.speechSynthesis.cancel();
    utterance = null;
    audio.cleanupMic();
    ui.setAmplitude(0, 0);
    smoothedSpeechEnergy = 0;
  }

  function interrupt(thenListen) {
    activeRun += 1;
    clearTimeout(recognitionTimer);
    recognitionTimer = null;
    if (recognition) {
      recognition.onend = null;
      try { recognition.abort(); } catch (_) {}
      recognition = null;
    }
    stopSpeech(true);
    audio.cleanupMic();
    store.set(store.states.INTERRUPTED);
    if (thenListen) setTimeout(() => startListening(), 90);
    else store.set(store.states.IDLE);
  }

  function fail(message) {
    store.set(store.states.ERROR);
    ui.setAmplitude(0, 0);
    ui.setLiveText(message, 5200);
    window.dispatchEvent(new CustomEvent('harness:error', { detail: { message } }));
    setTimeout(() => store.set(store.states.IDLE), 600);
  }

  function setContext(context) {
    store.context = context;
    window.dispatchEvent(new CustomEvent('harness:context', { detail: context }));
  }

  function runLocalAction(prompt) {
    const text = prompt.toLowerCase();
    const emails = store.context?.emails || [];

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

  function uiTextFromLastKyleMessage() {
    return [...store.conversation].reverse().find(message => message.role === 'kyle')?.text || '';
  }

  function getUserId() {
    return localStorage.getItem('userId') || store.context?.user_id || '';
  }

  window.Kyle = { store, setContext, startListening, interrupt, handlePrompt };
})();
