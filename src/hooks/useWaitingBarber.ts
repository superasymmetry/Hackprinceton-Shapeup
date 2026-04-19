'use client';

import { useRef } from 'react';

const VOICE_ID = 'JBFqnCBsd6RMkjVDRZzb';
const API_KEY = process.env.NEXT_PUBLIC_ELEVENLABS_API_KEY;

const WELCOME_LINES = [
  "Welcome to ShapeUp, man. Just take a seat — we'll get to you in a sec.",
  "Hey, welcome in. Sit tight, almost ready for you.",
  "What's good, welcome to ShapeUp. Just give me a minute.",
  "Yo, welcome. Take a seat — I got you in just a bit.",
];

const WAITING_LINES = [
  "Yo, just two minutes — let me finish up real quick.",
  "Almost there, just two more minutes.",
  "Two minutes, I got you.",
  "Hang tight — just wrapping this up.",
  "One sec, almost done.",
  "Yeah, two minutes. I'm on it.",
  "Hold on — nearly there, I promise.",
];

export function useWaitingBarber() {
  const activeRef  = useRef(false);
  const musicRef   = useRef<HTMLAudioElement | null>(null);
  const speechRef  = useRef<HTMLAudioElement | null>(null);

  async function speakLine(text: string): Promise<void> {
    if (!activeRef.current) return;
    try {
      const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}`, {
        method: 'POST',
        headers: { 'xi-api-key': API_KEY!, 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, model_id: 'eleven_multilingual_v2', output_format: 'mp3_44100_128' }),
      });
      if (!res.ok || !activeRef.current) return;
      const blob = await res.blob();
      if (!activeRef.current) return;
      const url = URL.createObjectURL(blob);
      await new Promise<void>((resolve) => {
        const audio = new Audio(url);
        speechRef.current = audio;
        audio.onended = () => { URL.revokeObjectURL(url); speechRef.current = null; resolve(); };
        audio.onerror = () => { URL.revokeObjectURL(url); speechRef.current = null; resolve(); };
        audio.play().catch(() => resolve());
      });
    } catch { /* ignore network/playback errors */ }
  }

  async function waitingLoop() {
    while (activeRef.current) {
      // Random gap between "just two minutes" lines — feels natural, not robotic
      const delay = 18000 + Math.random() * 14000;
      await new Promise(r => setTimeout(r, delay));
      if (!activeRef.current) break;
      const line = WAITING_LINES[Math.floor(Math.random() * WAITING_LINES.length)];
      await speakLine(line);
    }
  }

  return {
    start() {
      activeRef.current = true;

      const music = new Audio('/waiting_music.mp3');
      music.loop   = true;
      music.volume = 0.3;
      music.play().catch(() => {}); // fails silently if file missing
      musicRef.current = music;

      // 2-4 second random delay before Leo acknowledges the client
      const delay = 2000 + Math.random() * 2000;
      setTimeout(() => {
        if (!activeRef.current) return;
        const welcome = WELCOME_LINES[Math.floor(Math.random() * WELCOME_LINES.length)];
        speakLine(welcome).then(() => {
          if (activeRef.current) waitingLoop();
        });
      }, delay);
    },
    stop() {
      activeRef.current = false;
      if (musicRef.current) { musicRef.current.pause(); musicRef.current = null; }
      if (speechRef.current) { speechRef.current.pause(); speechRef.current = null; }
    },
  };
}
