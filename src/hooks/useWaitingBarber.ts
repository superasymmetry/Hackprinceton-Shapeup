'use client';

import { useRef } from 'react';

const VOICE_ID = 'JBFqnCBsd6RMkjVDRZzb';
const API_KEY = process.env.NEXT_PUBLIC_ELEVENLABS_API_KEY;

const GREETING_LINES = [
  "Welcome to ShapeUp, man. Go ahead and check in when you're ready.",
  "Yo, welcome to ShapeUp. Hit that check in button and we'll get you sorted.",
  "What's good, welcome in. Just check in on the screen whenever you're ready.",
  "Hey, welcome to ShapeUp. Check in whenever — I'll have you in the chair real quick.",
];

const STARTING_LINES = [
  "Aight, let me get on this.",
  "Say less, I got you.",
  "Bet, let me work my magic.",
  "Alright, let's see what we can do.",
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

// Told once per wait session, Curtis Sliwa style, in Leo's voice
const STORY_LINES = [
  "Yo, aight — this actually happened. We're talking Trenton, two in the morning. My boy calls me, says someone's hitting cars on his block one by one, like they're on a schedule. So we post up. Hoodie, shadows, just watching. Dude comes around the corner with a slim jim, calm as anything. And I'm thinking — wrong block tonight. We step out. He sees us. Freezes. Then just runs. Never came back. Block stayed clean for months.",
  "Nah nah, this one gets under my skin. Guy in my old neighborhood used to walk around like he ran things. Fake clout, real intimidation — shaking down corner stores, the whole bit. Shop owners too scared to talk. So the real ones, the ones who actually been there, we just started showing up. Every day. Present. And slowly that dude's whole operation just dissolved. Turns out confidence with nothing behind it is just a costume. City'll expose you.",
  "Okay so this is wild. Summer night, me and two guys I grew up with, walking back from a show, like 1am. Car slows down next to us, window rolls down. And I just — instinct — grab my boys and we step into a doorway. Car idles. Thirty seconds. A minute. Then pulls off. We never found out what that was. But sometimes the thing you don't see is the one that matters most. That's what these streets teach you.",
];

const DONE_LINES = [
  "Hmm. Looks done.",
  "Alright, finished.",
  "Okay — looks like we're finished.",
  "Oh — that's it actually.",
];

export function useWaitingBarber() {
  const activeRef    = useRef(false);
  const finishingRef = useRef(false);
  const storyToldRef = useRef(false);
  const musicRef     = useRef<HTMLAudioElement | null>(null);
  const speechRef    = useRef<HTMLAudioElement | null>(null);

  async function speakRaw(text: string): Promise<void> {
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
        speechRef.current = audio;
        audio.onended = () => { URL.revokeObjectURL(url); speechRef.current = null; resolve(); };
        audio.onerror = () => { URL.revokeObjectURL(url); speechRef.current = null; resolve(); };
        audio.play().catch(() => resolve());
      });
    } catch { /* ignore */ }
  }

  async function speakLine(text: string): Promise<void> {
    if (!activeRef.current || finishingRef.current) return;
    await speakRaw(text);
  }

  function startMusic() {
    const music = new Audio('/waiting_music.mp3');
    music.loop   = true;
    music.volume = 0.3;
    music.play().catch(() => {});
    musicRef.current = music;
  }

  async function waitingLoop() {
    while (activeRef.current && !finishingRef.current) {
      const delay = 18000 + Math.random() * 14000;
      await new Promise(r => setTimeout(r, delay));
      if (!activeRef.current || finishingRef.current) break;

      if (!storyToldRef.current && Math.random() < 0.65) {
        storyToldRef.current = true;
        const story = STORY_LINES[Math.floor(Math.random() * STORY_LINES.length)];
        await speakLine(story);
      } else {
        const line = WAITING_LINES[Math.floor(Math.random() * WAITING_LINES.length)];
        await speakLine(line);
      }
    }
  }

  return {
    // After photo capture: music + welcome + check-in prompt, no loop
    startGreeting() {
      activeRef.current  = true;
      finishingRef.current = false;
      startMusic();
      const delay = 2000 + Math.random() * 2000;
      setTimeout(() => {
        if (!activeRef.current) return;
        const line = GREETING_LINES[Math.floor(Math.random() * GREETING_LINES.length)];
        speakLine(line);
      }, delay);
    },

    // After Check In: opening line + waiting loop with occasional story
    start() {
      activeRef.current    = true;
      finishingRef.current = false;
      startMusic();
      const line = STARTING_LINES[Math.floor(Math.random() * STARTING_LINES.length)];
      speakLine(line).then(() => {
        if (activeRef.current) waitingLoop();
      });
    },

    // Called when 3D render succeeds — cuts off mid-story and says done line
    async finish() {
      finishingRef.current = true;
      activeRef.current    = false;
      if (speechRef.current) { speechRef.current.pause(); speechRef.current = null; }
      const line = DONE_LINES[Math.floor(Math.random() * DONE_LINES.length)];
      await speakRaw(line);
      if (musicRef.current) { musicRef.current.pause(); musicRef.current = null; }
      finishingRef.current = false;
    },

    // Silent stop — for errors or unmount cleanup
    stop() {
      activeRef.current    = false;
      finishingRef.current = true;
      if (musicRef.current) { musicRef.current.pause(); musicRef.current = null; }
      if (speechRef.current) { speechRef.current.pause(); speechRef.current = null; }
    },
  };
}
