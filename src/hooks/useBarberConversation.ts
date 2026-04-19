'use client';

import { useRef, useState } from 'react';
import { Conversation, VoiceConversation } from '@elevenlabs/client';

const AGENT_ID = 'agent_0901kpj07qs1fa6stm6m2njts5y4';
const VOICE_ID = 'JBFqnCBsd6RMkjVDRZzb';
const API_KEY  = process.env.NEXT_PUBLIC_ELEVENLABS_API_KEY;

export type BarberStatus =
  | 'idle' | 'speaking' | 'waiting' | 'listening'
  | 'processing' | 'done' | 'mic-denied' | 'no-mic';

export type StyleSuggestion = {
  label: string;
  searchQuery: string;
};

async function speakDirect(text: string): Promise<void> {
  try {
    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}`, {
      method: 'POST',
      headers: { 'xi-api-key': API_KEY!, 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, model_id: 'eleven_multilingual_v2', output_format: 'mp3_44100_128' }),
    });
    if (!res.ok) return;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    await new Promise<void>((resolve) => {
      const audio = new Audio(url);
      audio.onended = () => { URL.revokeObjectURL(url); resolve(); };
      audio.onerror = () => { URL.revokeObjectURL(url); resolve(); };
      audio.play().catch(() => resolve());
    });
  } catch { /* ignore */ }
}

export function useBarberConversation(
  onConversationEnd: (transcript: string) => void,
  onSuggestion?: (suggestion: StyleSuggestion) => void,
) {
  const [status, setStatus] = useState<BarberStatus>('idle');
  const sessionRef         = useRef<VoiceConversation | null>(null);
  const userTranscriptRef  = useRef<string[]>([]);

  async function endCurrentSession() {
    const s = sessionRef.current;
    sessionRef.current = null;
    if (s?.isOpen()) {
      try { await s.endSession(); } catch { /* ignore */ }
    }
  }

  return {
    status,

    async start() {
      userTranscriptRef.current = [];
      setStatus('idle');
      try {
        const session = await Conversation.startSession({
          agentId: AGENT_ID,

          onConnect: () => setStatus('waiting'),

          onDisconnect: () => {
            sessionRef.current = null;
            setStatus('done');
          },

          onModeChange: ({ mode }: { mode: string }) => {
            setStatus(mode === 'speaking' ? 'speaking' : 'listening');
          },

          onMessage: ({ source, message }: { source: string; message: string }) => {
            if (source === 'user') userTranscriptRef.current.push(message);
          },

          onError: (err: unknown) => {
            console.error('[useBarberConversation] error:', err);
            setStatus('mic-denied');
          },

          clientTools: {
            end_consultation: async () => {
              setStatus('processing');
              const transcript = userTranscriptRef.current.join(' ');
              onConversationEnd(transcript);
              setTimeout(() => endCurrentSession(), 400);
            },
            suggest_style: ({ label, searchQuery }: { label: string; searchQuery: string }) => {
              onSuggestion?.({ label, searchQuery });
            },
          },
        }) as VoiceConversation;

        sessionRef.current = session;
      } catch (err) {
        console.error('[useBarberConversation] startSession failed:', err);
        setStatus('mic-denied');
      }
    },

    async stop() {
      await endCurrentSession();
      setStatus('done');
    },

    async notifyGenerating() {
      await endCurrentSession(); // close CA session if still open
      const lines = [
        "Aight, let me work on that.",
        "Say less. Give me a sec.",
        "Bet. Let me see what I can do.",
      ];
      await speakDirect(lines[Math.floor(Math.random() * lines.length)]);
    },

    async notifyFinished() {
      const lines = [
        "Alright, take a look. How's that feel?",
        "Okay, check it out.",
        "There we go. What do you think?",
      ];
      await speakDirect(lines[Math.floor(Math.random() * lines.length)]);
    },
  };
}
