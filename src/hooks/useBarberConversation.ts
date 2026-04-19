'use client';

import { useRef, useState } from 'react';

const VOICE_ID = 'JBFqnCBsd6RMkjVDRZzb';
const API_KEY   = process.env.NEXT_PUBLIC_ELEVENLABS_API_KEY;

// Hold backtick ` to talk
const PTT_KEY = '`';

// Wake-word variants — STT often mishears "Jerry"
const WAKE_VARIANTS = ['hey jerry', 'hey gerry', 'hey gary', 'hey jery', 'a jerry', 'hey jerry'];

const LEO_GREETINGS = [
  "Yo, what are we working with today?",
  "What's good — what kind of look are you going for?",
  "Alright, so what are we doing with the cut?",
  "Sup. What are we doing today?",
];

const ACK_LINES = [
  "Yeah?",
  "Sup?",
  "What's up?",
  "Talk to me.",
  "Yeah, go ahead.",
];

export type BarberStatus =
  | 'idle' | 'speaking' | 'waiting' | 'listening'
  | 'processing' | 'done' | 'mic-denied' | 'no-mic';

type ChatMessage = { role: 'user' | 'assistant'; content: string };
type ActivationResult = { mode: 'wake' } | { mode: 'ptt'; transcript: string } | 'stale' | 'fatal';

async function fetchLeoReply(
  history: ChatMessage[],
  state: 'CONSULTATION' | 'GENERATING_HAIRCUT' | 'FINISHED',
): Promise<{ reply: string | null; done: boolean }> {
  try {
    const res = await fetch('/api/leo-chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ history, state }),
    });
    const data = await res.json();
    return { reply: data.reply ?? null, done: data.done ?? false };
  } catch {
    return { reply: null, done: false };
  }
}

export function useBarberConversation(onConversationEnd: (transcript: string) => void) {
  const [status, setStatus] = useState<BarberStatus>('idle');

  const loopIdRef      = useRef(0);
  const audioRef       = useRef<HTMLAudioElement | null>(null);
  const recognitionRef = useRef<any>(null);
  const chatHistory    = useRef<ChatMessage[]>([]);

  // ── mic permission ──────────────────────────────────────────────────────────

  async function requestMicPermission(): Promise<'granted' | 'denied' | 'no-device'> {
    if (!navigator.mediaDevices?.getUserMedia) return 'denied';
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach(t => t.stop());
      return 'granted';
    } catch (err: any) {
      const name: string = err?.name ?? '';
      if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
        try {
          const devices = await navigator.mediaDevices.enumerateDevices();
          return devices.some(d => d.kind === 'audioinput') ? 'denied' : 'no-device';
        } catch { return 'no-device'; }
      }
      return 'denied';
    }
  }

  // ── speak ───────────────────────────────────────────────────────────────────

  async function speakText(text: string, loopId: number | null): Promise<boolean> {
    if (loopId !== null && loopIdRef.current !== loopId) return false;
    setStatus('speaking');
    try {
      const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}`, {
        method: 'POST',
        headers: { 'xi-api-key': API_KEY!, 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, model_id: 'eleven_multilingual_v2', output_format: 'mp3_44100_128' }),
      });
      if (!res.ok) return false;
      const blob = await res.blob();
      if (loopId !== null && loopIdRef.current !== loopId) return false;
      const url = URL.createObjectURL(blob);
      await new Promise<void>((resolve) => {
        const audio = new Audio(url);
        audioRef.current = audio;
        audio.onended = () => { URL.revokeObjectURL(url); audioRef.current = null; resolve(); };
        audio.onerror = () => { URL.revokeObjectURL(url); audioRef.current = null; resolve(); };
        audio.play().catch(() => resolve());
      });
    } catch { return false; }
    return loopId === null || loopIdRef.current === loopId;
  }

  // ── wait for "Hey Jerry" OR hold-backtick PTT ────────────────────────────

  function waitForActivation(loopId: number): Promise<ActivationResult> {
    return new Promise((resolve) => {
      if (loopIdRef.current !== loopId) { resolve('stale'); return; }

      let resolved    = false;
      let pttKeyHeld  = false;
      let pttTranscript = '';
      let wakeRec: any = null;
      let pttRec:  any = null;

      const SR = (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition;

      function done(result: ActivationResult) {
        if (resolved) return;
        resolved = true;
        window.removeEventListener('keydown', onKeyDown);
        window.removeEventListener('keyup',   onKeyUp);
        try { wakeRec?.stop(); } catch { /* ignore */ }
        recognitionRef.current = null;
        resolve(result);
      }

      // ── PTT: hold backtick ────────────────────────────────────────────────
      const onKeyDown = (e: KeyboardEvent) => {
        if (e.key !== PTT_KEY || pttKeyHeld || resolved) return;
        e.preventDefault();
        pttKeyHeld    = true;
        pttTranscript = '';

        // Stop wake-word SR first
        try { wakeRec?.stop(); wakeRec = null; } catch { /* ignore */ }
        recognitionRef.current = null;

        if (!SR) { done({ mode: 'ptt', transcript: '' }); return; }

        pttRec = new SR();
        pttRec.continuous     = true;
        pttRec.interimResults = false;
        pttRec.lang           = 'en-US';
        recognitionRef.current = pttRec;

        pttRec.onresult = (e: any) => {
          pttTranscript = Array.from(e.results as any[])
            .map((r: any) => r[0].transcript).join(' ');
        };

        pttRec.onerror = (e: any) => {
          if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
            done('fatal');
          }
        };

        pttRec.onend = () => {
          recognitionRef.current = null;
          if (resolved) return;
          if (pttKeyHeld && loopIdRef.current === loopId) {
            // Key still held, silence timeout fired — restart so we keep capturing
            try { pttRec.start(); recognitionRef.current = pttRec; } catch { done({ mode: 'ptt', transcript: pttTranscript }); }
          } else {
            done({ mode: 'ptt', transcript: pttTranscript });
          }
        };

        setStatus('listening');
        try { pttRec.start(); } catch { done({ mode: 'ptt', transcript: '' }); }
      };

      const onKeyUp = (e: KeyboardEvent) => {
        if (e.key !== PTT_KEY || !pttKeyHeld) return;
        pttKeyHeld = false;
        try { pttRec?.stop(); } catch {
          // Already ended — resolve directly
          done({ mode: 'ptt', transcript: pttTranscript });
        }
      };

      window.addEventListener('keydown', onKeyDown);
      window.addEventListener('keyup',   onKeyUp);

      // ── Wake word: continuous SR ──────────────────────────────────────────
      if (!SR) { setStatus('waiting'); return; }

      wakeRec = new SR();
      wakeRec.continuous     = true;
      wakeRec.interimResults = true;
      wakeRec.lang           = 'en-US';
      recognitionRef.current = wakeRec;

      wakeRec.onresult = (e: any) => {
        if (pttKeyHeld || resolved) return;
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const t: string = e.results[i][0].transcript.toLowerCase();
          if (WAKE_VARIANTS.some(v => t.includes(v))) {
            done({ mode: 'wake' });
            return;
          }
        }
      };

      wakeRec.onerror = (e: any) => {
        if (e.error === 'not-allowed' || e.error === 'service-not-allowed') done('fatal');
      };

      wakeRec.onend = () => {
        recognitionRef.current = null;
        if (resolved) return;
        if (loopIdRef.current !== loopId) { done('stale'); return; }
        // Restart to keep the wake-word listener alive
        try { wakeRec.start(); recognitionRef.current = wakeRec; } catch { done('fatal'); }
      };

      setStatus('waiting');
      try { wakeRec.start(); } catch { done('fatal'); }
    });
  }

  // ── one-shot listen after wake word ────────────────────────────────────────

  function listenOnce(loopId: number): Promise<string> {
    return new Promise((resolve) => {
      if (loopIdRef.current !== loopId) { resolve('__STALE__'); return; }

      setStatus('listening');
      const SR = (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition;
      if (!SR) { resolve('__FATAL__'); return; }

      const rec = new SR();
      rec.continuous     = false;
      rec.interimResults = false;
      rec.lang           = 'en-US';
      recognitionRef.current = rec;

      let transcript  = '';
      let fatalError  = false;

      rec.onspeechstart = () => {
        if (audioRef.current) { audioRef.current.pause(); audioRef.current = null; }
      };
      rec.onresult = (e: any) => {
        transcript = Array.from(e.results as any[]).map((r: any) => r[0].transcript).join(' ');
      };
      rec.onerror = (e: any) => {
        recognitionRef.current = null;
        if (e.error === 'not-allowed' || e.error === 'service-not-allowed') fatalError = true;
      };
      rec.onend = () => {
        recognitionRef.current = null;
        resolve(fatalError ? '__FATAL__' : transcript);
      };
      try { rec.start(); } catch { recognitionRef.current = null; resolve(''); }
    });
  }

  // ── main loop ───────────────────────────────────────────────────────────────

  async function runLoop(loopId: number) {
    const micResult = await requestMicPermission();
    if (loopIdRef.current !== loopId) return;
    if (micResult === 'denied')    { setStatus('mic-denied'); return; }

    const greeting = LEO_GREETINGS[Math.floor(Math.random() * LEO_GREETINGS.length)];
    chatHistory.current.push({ role: 'assistant', content: greeting });
    const ok = await speakText(greeting, loopId);
    if (!ok) return;

    if (micResult === 'no-device') { setStatus('no-mic'); return; }

    while (loopIdRef.current === loopId) {
      // Wait for "Hey Jerry" or backtick PTT
      const activation = await waitForActivation(loopId);

      if (activation === 'stale' || loopIdRef.current !== loopId) break;
      if (activation === 'fatal') { loopIdRef.current++; setStatus('mic-denied'); return; }

      let chunk: string;

      if (activation.mode === 'ptt') {
        chunk = activation.transcript;
      } else {
        // Wake word — ack then listen
        const ack = ACK_LINES[Math.floor(Math.random() * ACK_LINES.length)];
        await speakText(ack, loopId);
        if (loopIdRef.current !== loopId) break;
        chunk = await listenOnce(loopId);
      }

      if (chunk === '__STALE__' || loopIdRef.current !== loopId) break;
      if (chunk === '__FATAL__') { loopIdRef.current++; setStatus('mic-denied'); return; }
      if (!chunk.trim()) continue;

      chatHistory.current.push({ role: 'user', content: chunk.trim() });

      setStatus('processing');
      const { reply, done } = await fetchLeoReply(chatHistory.current, 'CONSULTATION');
      if (loopIdRef.current !== loopId) break;

      const leoLine = reply ?? "Got it, anything else?";
      chatHistory.current.push({ role: 'assistant', content: leoLine });

      if (done) {
        const transcript = chatHistory.current
          .filter(m => m.role === 'user')
          .map(m => m.content)
          .join(' ');
        await speakText(leoLine, loopId);
        loopIdRef.current++;
        setStatus('processing');
        onConversationEnd(transcript);
        return;
      }

      const ack = await speakText(leoLine, loopId);
      if (!ack) break;
    }

    setStatus('done');
  }

  // ── state notifications (called externally) ─────────────────────────────────

  async function notifyState(state: 'GENERATING_HAIRCUT' | 'FINISHED') {
    const { reply } = await fetchLeoReply(chatHistory.current, state);
    const line = reply ?? (state === 'FINISHED'
      ? "Alright, take a look. How's that feel?"
      : "Let me work my magic on this.");
    chatHistory.current.push({ role: 'assistant', content: line });
    await speakText(line, null);
    setStatus('done');
  }

  return {
    status,
    start() {
      const id = ++loopIdRef.current;
      chatHistory.current = [];
      runLoop(id);
    },
    stop() {
      loopIdRef.current++;
      if (audioRef.current) { audioRef.current.pause(); audioRef.current = null; }
      if (recognitionRef.current) {
        try { recognitionRef.current.abort(); } catch { /* ignore */ }
        recognitionRef.current = null;
      }
      setStatus('done');
    },
    notifyGenerating() { notifyState('GENERATING_HAIRCUT'); },
    notifyFinished()   { notifyState('FINISHED'); },
  };
}
