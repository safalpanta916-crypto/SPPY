import { useCallback, useEffect, useRef, useState } from "react";
import { Mic, Pause, Play, Square, Trash2 } from "lucide-react";

interface RecognitionResultItem {
  isFinal: boolean;
  0: { transcript: string };
}

interface RecognitionResultEvent {
  resultIndex: number;
  results: ArrayLike<RecognitionResultItem>;
}

interface RecognitionErrorEvent {
  error: string;
}

interface BrowserSpeechRecognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onresult: ((event: RecognitionResultEvent) => void) | null;
  onerror: ((event: RecognitionErrorEvent) => void) | null;
  start: () => void;
  stop: () => void;
}

type SpeechRecognitionConstructor = new () => BrowserSpeechRecognition;

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  }
}

function recognitionConstructor(): SpeechRecognitionConstructor | undefined {
  if (typeof window === "undefined") return undefined;
  return window.SpeechRecognition ?? window.webkitSpeechRecognition;
}

export function VoiceInputControls({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [error, setError] = useState("");
  const [lastInserted, setLastInserted] = useState("");
  const recognitionRef = useRef<BrowserSpeechRecognition | null>(null);
  const draftRef = useRef(value);
  const available = Boolean(recognitionConstructor());

  useEffect(() => {
    draftRef.current = value;
  }, [value]);

  const stopListening = useCallback(() => {
    try {
      recognitionRef.current?.stop();
    } catch {
      // Recognition may have ended between the status update and this click.
    }
    recognitionRef.current = null;
    setListening(false);
    setInterim("");
  }, []);

  useEffect(
    () => () => {
      try {
        recognitionRef.current?.stop();
      } catch {
        // Recognition may already have ended during route cleanup.
      }
    },
    [],
  );

  const startListening = () => {
    const Constructor = recognitionConstructor();
    if (!Constructor) {
      setError("Voice input is not supported in this browser. You can still type normally.");
      return;
    }
    setError("");
    setInterim("");
    try {
      const recognition = new Constructor();
      recognition.lang = navigator.language || "en-US";
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.onstart = () => setListening(true);
      recognition.onend = () => {
        recognitionRef.current = null;
        setListening(false);
        setInterim("");
      };
      recognition.onresult = (event) => {
        let finalText = "";
        let interimText = "";
        for (let index = event.resultIndex; index < event.results.length; index += 1) {
          const item = event.results[index];
          if (!item) continue;
          if (item.isFinal) finalText += item[0]?.transcript ?? "";
          else interimText += item[0]?.transcript ?? "";
        }
        if (finalText.trim()) {
          const spoken = finalText.trim().replace(/\s+/g, " ");
          const current = draftRef.current;
          const insertion = `${current && !/\s$/.test(current) ? " " : ""}${spoken}`;
          const next = current + insertion;
          draftRef.current = next;
          onChange(next);
          setLastInserted((previous) => previous + insertion);
        }
        setInterim(interimText.trim());
      };
      recognition.onerror = (event) => {
        const messages: Record<string, string> = {
          "not-allowed": "Microphone permission was denied. Allow it in your browser settings and try again.",
          "service-not-allowed": "The browser’s speech service is unavailable or blocked.",
          "audio-capture": "No microphone was found on this device.",
          network: "Voice recognition needs a network connection in this browser.",
          "no-speech": "No speech was detected. Try again when ready.",
        };
        setError(messages[event.error] ?? "Voice input stopped. You can continue by typing.");
        setListening(false);
        setInterim("");
      };
      recognitionRef.current = recognition;
      recognition.start();
    } catch {
      recognitionRef.current = null;
      setListening(false);
      setError("Voice input could not start. Check your microphone permission and try again.");
    }
  };

  const clearTranscription = () => {
    if (!lastInserted) return;
    const start = value.lastIndexOf(lastInserted);
    if (start < 0) {
      setError("The transcription was edited. Remove it from the message draft manually.");
      return;
    }
    const next = value.slice(0, start) + value.slice(start + lastInserted.length);
    draftRef.current = next;
    onChange(next);
    setLastInserted("");
    setError("");
  };

  return (
    <div className="flex flex-col items-start gap-0.5">
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={listening ? stopListening : startListening}
          disabled={!available && !listening}
          title={
            available
              ? listening
                ? "Stop voice input"
                : "Use voice input"
              : "Voice input is not supported in this browser"
          }
          aria-label={listening ? "Stop voice input" : "Start voice input"}
          aria-pressed={listening}
          className={`grid h-8 w-8 place-items-center rounded-lg transition hover:bg-secondary hover:text-foreground disabled:cursor-not-allowed disabled:opacity-45 ${listening ? "text-primary" : "text-muted-foreground"}`}
          data-testid="button-voice-input"
        >
          {listening ? <Square size={14} /> : <Mic size={15} />}
        </button>
        {lastInserted && (
          <button
            type="button"
            onClick={clearTranscription}
            title="Clear the latest voice transcription"
            aria-label="Clear voice transcription"
            className="grid h-8 w-8 place-items-center rounded-lg text-muted-foreground transition hover:bg-secondary hover:text-foreground"
            data-testid="button-clear-transcription"
          >
            <Trash2 size={14} />
          </button>
        )}
      </div>
      {!available && !error && (
        <span className="max-w-[240px] text-[9px] leading-4 text-muted-foreground" data-testid="status-voice-unsupported">
          Voice input is not supported here. You can still type normally.
        </span>
      )}
      {(error || interim || listening) && (
        <span
          className={`max-w-[240px] text-[9px] leading-4 ${error ? "text-destructive" : "text-primary"}`}
          role={error ? "alert" : "status"}
          aria-live="polite"
          data-testid="status-voice-input"
        >
          {error || (interim ? `Listening: ${interim}` : "Listening…")}
        </span>
      )}
    </div>
  );
}

export function VoiceOutputControls({
  text,
  rate,
  voiceName,
}: {
  text: string;
  rate: number;
  voiceName: string;
}) {
  const [state, setState] = useState<"idle" | "playing" | "paused">("idle");
  const [unavailable, setUnavailable] = useState(false);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);

  const stop = useCallback(() => {
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
    utteranceRef.current = null;
    setState("idle");
  }, []);

  useEffect(
    () => () => {
      if (utteranceRef.current && typeof window !== "undefined" && "speechSynthesis" in window) {
        window.speechSynthesis.cancel();
      }
    },
    [],
  );

  const play = () => {
    if (!("speechSynthesis" in window) || typeof SpeechSynthesisUtterance === "undefined") {
      setUnavailable(true);
      return;
    }
    if (state === "paused") {
      window.speechSynthesis.resume();
      setState("playing");
      return;
    }
    if (state === "playing") {
      window.speechSynthesis.pause();
      setState("paused");
      return;
    }
    stop();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = rate;
    if (voiceName) {
      const selectedVoice = window.speechSynthesis.getVoices().find((voice) => voice.name === voiceName);
      if (selectedVoice) utterance.voice = selectedVoice;
    }
    utterance.onend = () => {
      if (utteranceRef.current !== utterance) return;
      utteranceRef.current = null;
      setState("idle");
    };
    utterance.onerror = () => {
      if (utteranceRef.current !== utterance) return;
      utteranceRef.current = null;
      setState("idle");
      setUnavailable(true);
    };
    utteranceRef.current = utterance;
    setUnavailable(false);
    setState("playing");
    window.speechSynthesis.speak(utterance);
  };

  if (unavailable) {
    return (
      <span
        className="px-2 py-1 text-[10px] text-muted-foreground"
        role="status"
        data-testid="status-voice-output"
      >
        Speech output unavailable
      </span>
    );
  }

  return (
    <div className="inline-flex items-center gap-1" data-testid="controls-voice-output">
      <button
        type="button"
        onClick={play}
        title={state === "paused" ? "Resume response" : state === "playing" ? "Pause response" : "Play response"}
        aria-label={state === "paused" ? "Resume response" : state === "playing" ? "Pause response" : "Play response"}
        className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[10px] text-muted-foreground transition hover:bg-secondary hover:text-foreground"
        data-testid="button-play-response"
      >
        {state === "playing" ? <Pause size={12} /> : state === "paused" ? <Play size={12} /> : <Play size={12} />}
        {state === "paused" ? "Resume" : state === "playing" ? "Pause" : "Play"}
      </button>
      {state !== "idle" && (
        <>
          <button
            type="button"
            onClick={stop}
            title="Stop response"
            aria-label="Stop response"
            className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[10px] text-muted-foreground transition hover:bg-secondary hover:text-foreground"
            data-testid="button-stop-response"
          >
            <Square size={11} />
            Stop
          </button>
        </>
      )}
    </div>
  );
}
