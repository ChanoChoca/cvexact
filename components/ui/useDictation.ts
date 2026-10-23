import { useCallback, useEffect, useRef, useState } from "react";

/**
 * The subset of the Web Speech API this app uses, typed locally rather than
 * assumed from the DOM lib — it is still non-standard, on neither the WHATWG
 * nor the W3C track, and not every `lib.dom` carries it the same way.
 */
type RecognitionResult = { isFinal: boolean; 0: { transcript: string } };
type RecognitionEvent = { resultIndex: number; results: ArrayLike<RecognitionResult> };
type RecognitionErrorEvent = { error: string };
interface Recognition extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  onresult: ((event: RecognitionEvent) => void) | null;
  onerror: ((event: RecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
}
type RecognitionCtor = new () => Recognition;

function recognitionCtor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/**
 * Whether this browser can dictate at all — Chrome and the browsers built on
 * it, and Safari; not Firefox, which never shipped either constructor.
 * `false` until an effect has actually checked: computing it straight from
 * `window` during render would run on the server too, where there is none.
 * Privacy clause 20 is what a caller should point to if it explains this.
 */
export function useDictationSupport(): boolean {
  const [supported, setSupported] = useState(false);
  useEffect(() => {
    const check = () => setSupported(recognitionCtor() !== null);
    check();
  }, []);
  return supported;
}

/**
 * Dictation for one text field. The browser does the listening and the
 * transcribing itself — sent to Google in Chrome/Chromium, to Apple in
 * Safari — never through a server of ours; `onFinal` only ever receives a
 * finished phrase, never an interim guess still being revised, so what lands
 * in the field is exactly what the person said, not a word half-corrected a
 * moment later.
 */
export function useDictation(onFinal: (text: string) => void) {
  const supported = useDictationSupport();
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recognitionRef = useRef<Recognition | null>(null);
  const onFinalRef = useRef(onFinal);
  // Kept current without forcing `start` to be re-created on every render a
  // caller passes it a fresh inline function.
  useEffect(() => {
    onFinalRef.current = onFinal;
  }, [onFinal]);

  // Never leaves the microphone open behind a screen the person has left.
  useEffect(() => () => recognitionRef.current?.stop(), []);

  const start = useCallback(() => {
    const Ctor = recognitionCtor();
    if (!Ctor) return;
    setError(null);
    const recognition = new Ctor();
    recognition.lang = "es-AR";
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.onresult = (event) => {
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          const transcript = result[0].transcript.trim();
          if (transcript) onFinalRef.current(transcript);
        }
      }
    };
    recognition.onerror = (event) => {
      setError(event.error === "not-allowed" ? "No pudimos usar el micrófono: revisá los permisos del navegador." : "No se pudo dictar. Probá de nuevo o escribilo.");
      setListening(false);
    };
    recognition.onend = () => setListening(false);
    recognitionRef.current = recognition;
    recognition.start();
    setListening(true);
  }, []);

  const stop = useCallback(() => recognitionRef.current?.stop(), []);

  return { supported, listening, error, start, stop };
}
