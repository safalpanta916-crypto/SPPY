import { useCallback, useEffect, useRef, useState } from 'react';
import { Activity, Camera, Check, ChevronDown, CircleHelp, Expand, Hand, Maximize2, Minus, MousePointer2, RotateCcw, Shield, Sparkles, Sun, Moon, X } from 'lucide-react';
import { useHandTracking } from '../hooks/use-hand-tracking';
import type { NormalizedLandmark } from '@mediapipe/tasks-vision';

type MotionLabPageProps = {
  theme: 'dark' | 'light';
  toggleTheme: () => void;
  onAskSppy: (question: string) => void;
};
type ControlId = 'energy-draw' | 'energy-shield' | 'orb-control' | 'two-hand-expansion';

const controls: { id: ControlId; title: string; cue: string; icon: typeof Sparkles }[] = [
  { id: 'energy-draw', title: 'Energy Draw', cue: 'Raise one index finger', icon: Sparkles },
  { id: 'energy-shield', title: 'Energy Shield', cue: 'Open your palm', icon: Shield },
  { id: 'orb-control', title: 'Orb Control', cue: 'Pinch thumb and index', icon: MousePointer2 },
  { id: 'two-hand-expansion', title: 'Two-hand expansion', cue: 'Bring both hands into view', icon: Expand },
];

function point(landmark: NormalizedLandmark, width: number, height: number) {
  return { x: (1 - landmark.x) * width, y: landmark.y * height };
}

export default function MotionLabPage({ theme, toggleTheme, onAskSppy }: MotionLabPageProps) {
  const { videoRef, cameraState, cameraActive, loading, error, frame, startCamera, stopCamera } = useHandTracking();
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const trailsRef = useRef<Array<{ x: number; y: number }>>([]);
  const lastFrameRef = useRef(0);
  const [intensity, setIntensity] = useState(68);
  const [guideOpen, setGuideOpen] = useState(false);
  const [gestureNavigation, setGestureNavigation] = useState(false);
  const [selectedControl, setSelectedControl] = useState<ControlId>('energy-draw');
  const [fullscreen, setFullscreen] = useState(false);
  const [localMessage, setLocalMessage] = useState('');

  useEffect(() => {
    const onFullscreenChange = () => setFullscreen(document.fullscreenElement === stageRef.current);
    document.addEventListener('fullscreenchange', onFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const stage = stageRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !stage || !context) return;
    const bounds = stage.getBoundingClientRect();
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(bounds.width * ratio));
    canvas.height = Math.max(1, Math.round(bounds.height * ratio));
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, bounds.width, bounds.height);
    if (!cameraActive || !frame.landmarks.length) {
      if (!frame.landmarks.length) trailsRef.current = [];
      return;
    }

    const alpha = Math.max(0.3, intensity / 100);
    const activeGesture = selectedControl === frame.gesture ? frame.gesture : 'none';

    if (frame.timestamp !== lastFrameRef.current) {
      lastFrameRef.current = frame.timestamp;
      const hand = frame.landmarks[0];
      if (activeGesture === 'energy-draw' && hand?.[8]) {
        const tip = point(hand[8], bounds.width, bounds.height);
        const prior = trailsRef.current[trailsRef.current.length - 1];
        if (!prior || Math.hypot(tip.x - prior.x, tip.y - prior.y) < 100) trailsRef.current.push(tip);
        else trailsRef.current = [tip];
        if (trailsRef.current.length > 180) trailsRef.current.splice(0, trailsRef.current.length - 180);
      }
    }

    context.save();
    context.lineCap = 'round';
    context.lineJoin = 'round';
    if (selectedControl === 'energy-draw' && trailsRef.current.length > 1) {
      context.beginPath();
      trailsRef.current.forEach((item, index) => index === 0 ? context.moveTo(item.x, item.y) : context.lineTo(item.x, item.y));
      context.strokeStyle = `rgba(255, 112, 190, ${alpha})`;
      context.lineWidth = 3 + intensity / 24;
      context.shadowColor = '#ff5cad';
      context.shadowBlur = 18 * alpha;
      context.stroke();
      context.shadowBlur = 0;
      const tip = trailsRef.current[trailsRef.current.length - 1];
      context.beginPath(); context.arc(tip.x, tip.y, 4 + intensity / 25, 0, Math.PI * 2);
      context.fillStyle = '#ffd5ec'; context.fill();
    }

    if (activeGesture === 'energy-shield' && frame.landmarks[0]?.length >= 21) {
      const hand = frame.landmarks[0];
      const palm = point(hand[9], bounds.width, bounds.height);
      const fingertips = [8, 12, 16, 20].map((index) => point(hand[index], bounds.width, bounds.height));
      const radius = Math.max(60, Math.hypot(fingertips[0].x - fingertips[3].x, fingertips[0].y - fingertips[3].y) * 1.25);
      context.beginPath();
      context.moveTo(fingertips[0].x, fingertips[0].y);
      fingertips.slice(1).forEach((tip) => context.lineTo(tip.x, tip.y));
      context.lineTo(point(hand[0], bounds.width, bounds.height).x, point(hand[0], bounds.width, bounds.height).y);
      context.closePath();
      context.fillStyle = `rgba(133, 220, 255, ${0.12 * alpha})`;
      context.strokeStyle = `rgba(163, 233, 255, ${0.78 * alpha})`;
      context.lineWidth = 2;
      context.shadowColor = '#79d8ff'; context.shadowBlur = 24 * alpha;
      context.fill(); context.stroke(); context.shadowBlur = 0;
      context.beginPath(); context.arc(palm.x, palm.y, radius, 0, Math.PI * 2);
      context.strokeStyle = `rgba(167, 230, 255, ${0.35 * alpha})`; context.lineWidth = 1; context.stroke();
    }

    if (activeGesture === 'orb-control' && frame.landmarks[0]?.[4] && frame.landmarks[0]?.[8]) {
      const hand = frame.landmarks[0];
      const thumb = point(hand[4], bounds.width, bounds.height);
      const index = point(hand[8], bounds.width, bounds.height);
      const center = { x: (thumb.x + index.x) / 2, y: (thumb.y + index.y) / 2 };
      const radius = 24 + intensity * 0.42;
      context.beginPath(); context.arc(center.x, center.y, radius, 0, Math.PI * 2);
      context.fillStyle = `rgba(255, 185, 94, ${0.18 * alpha})`;
      context.strokeStyle = `rgba(255, 218, 163, ${0.9 * alpha})`;
      context.lineWidth = 2; context.shadowColor = '#ffbd65'; context.shadowBlur = 24 * alpha;
      context.fill(); context.stroke(); context.shadowBlur = 0;
      context.beginPath(); context.arc(center.x, center.y, 5, 0, Math.PI * 2); context.fillStyle = '#fff0cf'; context.fill();
    }

    if (activeGesture === 'two-hand-expansion' && frame.landmarks.length >= 2) {
      const centers = frame.landmarks.slice(0, 2).map((hand) => point(hand[9] ?? hand[0], bounds.width, bounds.height));
      const distance = Math.hypot(centers[0].x - centers[1].x, centers[0].y - centers[1].y);
      const radius = Math.min(Math.max(distance * 0.58, 50), Math.max(bounds.width, bounds.height) * 0.8);
      [centers[0], centers[1]].forEach((center, i) => {
        context.beginPath(); context.arc(center.x, center.y, radius, 0, Math.PI * 2);
        context.strokeStyle = i === 0 ? `rgba(255, 117, 192, ${0.58 * alpha})` : `rgba(136, 207, 255, ${0.58 * alpha})`;
        context.lineWidth = 2; context.stroke();
        context.beginPath(); context.arc(center.x, center.y, 5, 0, Math.PI * 2);
        context.fillStyle = i === 0 ? '#ff8dc9' : '#91d5ff'; context.fill();
      });
      context.beginPath(); context.moveTo(centers[0].x, centers[0].y); context.lineTo(centers[1].x, centers[1].y);
      context.strokeStyle = `rgba(235, 223, 255, ${0.3 * alpha})`; context.setLineDash([5, 8]); context.stroke(); context.setLineDash([]);
    }
    context.restore();
  }, [cameraActive, frame, intensity, selectedControl, gestureNavigation]);

  useEffect(() => {
    trailsRef.current = [];
  }, [selectedControl]);

  useEffect(() => {
    if (!gestureNavigation || frame.gesture === 'none') return;
    setSelectedControl(frame.gesture);
  }, [frame.gesture, gestureNavigation]);

  const clearDrawing = useCallback(() => {
    trailsRef.current = [];
    setLocalMessage('Energy Draw trail cleared.');
    window.setTimeout(() => setLocalMessage(''), 2200);
  }, []);

  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await stageRef.current?.requestFullscreen();
    } catch {
      setLocalMessage('Fullscreen is not available in this browser.');
      window.setTimeout(() => setLocalMessage(''), 2800);
    }
  };

  const statusText = cameraActive ? 'Camera active · processing on device' : loading ? (cameraState === 'requesting' ? 'Waiting for permission' : 'Loading hand tracking') : cameraState === 'error' ? 'Camera unavailable' : 'Camera off';
  const activeGestureName = controls.find((item) => item.id === frame.gesture)?.title ?? 'No gesture detected';
  const requestCamera = () => { setLocalMessage(''); void startCamera(); };

  return <main className="app-shell grain px-4 pb-16 pt-10 md:px-8 md:pt-14" data-theme={theme} data-testid="page-motion-lab">
    <div className="mx-auto max-w-6xl">
      <header className="mb-8 flex flex-col gap-5 md:mb-10 md:flex-row md:items-end md:justify-between">
        <div className="fade-in">
          <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-primary/25 bg-accent/55 px-3 py-1.5 text-[10px] font-semibold tracking-[.16em] text-accent-foreground"><Activity size={13} /> SPPY MOTION LAB <span className="opacity-50">/</span> LOCAL EXPERIMENT</div>
          <h1 className="display text-4xl font-extrabold leading-[1.02] tracking-[-.065em] sm:text-5xl md:text-6xl">Move an idea<br className="sm:hidden" /> into the room.</h1>
          <p className="mt-4 max-w-xl text-sm leading-6 text-muted-foreground md:text-base">Your hands. Your movements. Your digital world.</p>
        </div>
        <button type="button" onClick={() => onAskSppy('Explain how hand tracking works.')} className="inline-flex w-fit items-center gap-2 rounded-xl border border-border bg-card/75 px-4 py-2.5 text-sm font-semibold transition hover:border-primary/40 hover:bg-secondary" data-testid="button-ask-sppy"><CircleHelp size={16} className="text-primary" />Ask SPPY</button>
      </header>

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1.7fr)_minmax(290px,.8fr)]">
        <section className="min-w-0 overflow-hidden rounded-2xl border border-border bg-card/65 shadow-[0_18px_60px_hsl(var(--background)/.2)]" aria-label="Hand tracking playground">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/75 px-4 py-3.5 sm:px-5">
            <div className="flex min-w-0 items-center gap-2.5"><span className={`relative h-2 w-2 rounded-full ${cameraActive ? 'bg-emerald-400' : loading ? 'animate-pulse bg-amber-400' : cameraState === 'error' ? 'bg-destructive' : 'bg-muted-foreground/50'}`} /><span className="truncate text-xs font-medium text-muted-foreground" data-testid="status-camera">{statusText}</span></div>
            <div className="flex items-center gap-1.5">
              <button type="button" onClick={clearDrawing} className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-xs text-muted-foreground transition hover:bg-secondary hover:text-foreground" data-testid="button-clear-drawing" title="Clear Energy Draw trail"><RotateCcw size={13} /><span className="hidden sm:inline">Clear trail</span></button>
              <button type="button" onClick={toggleFullscreen} className="grid h-8 w-8 place-items-center rounded-lg text-muted-foreground transition hover:bg-secondary hover:text-foreground" aria-label={fullscreen ? 'Exit fullscreen' : 'Enter fullscreen'} data-testid="button-fullscreen"><Maximize2 size={15} /></button>
            </div>
          </div>
          <div ref={stageRef} className="relative aspect-video min-h-[260px] overflow-hidden bg-[radial-gradient(ellipse_at_50%_48%,hsl(var(--primary)/.11),transparent_56%),linear-gradient(145deg,hsl(var(--secondary)/.55),hsl(var(--background)))] data-[fullscreen]:aspect-auto" data-testid="motion-stage">
            <video ref={videoRef} className={`absolute inset-0 h-full w-full object-cover ${cameraActive || loading ? 'opacity-100' : 'opacity-0'} [transform:scaleX(-1)]`} aria-label="Local mirrored camera preview" data-testid="video-camera-preview" />
            <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden="true" data-testid="canvas-motion-effects" />
            {!cameraActive && !loading && <div className="absolute inset-0 flex flex-col items-center justify-center px-6 text-center">
              <div className="relative mb-6 grid h-24 w-24 place-items-center rounded-full border border-primary/20 bg-background/35"><span className="absolute inset-2 rounded-full border border-primary/15" /><span className="absolute inset-0 animate-pulse rounded-full border border-primary/10" /><Hand size={31} strokeWidth={1.25} className="text-primary/80" /></div>
              <p className="display text-lg font-semibold tracking-tight">The stage is yours.</p>
              <p className="mt-2 w-full max-w-sm text-xs leading-5 text-muted-foreground">Camera access starts only after you enable it.</p>
              {cameraState === 'error' && <div className="mt-3 max-w-md rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs leading-5 text-destructive" role="alert" data-testid="text-camera-error">{error || 'Hand tracking could not start. Check browser camera support and try again.'}</div>}
              <button type="button" onClick={requestCamera} disabled={loading} className="mt-5 inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition hover:opacity-90 disabled:cursor-wait disabled:opacity-60" data-testid="button-enable-camera"><Camera size={15} />{cameraState === 'error' ? 'Try camera again' : 'Enable camera'}</button>
            </div>}
            {loading && <div className="absolute inset-0 flex flex-col items-center justify-center bg-background/55 px-6 text-center backdrop-blur-[2px]" role="status" data-testid="status-camera-loading"><div className="mb-4 h-10 w-10 animate-pulse rounded-full border border-primary/30 bg-primary/10" /><p className="display text-base font-semibold">{cameraState === 'requesting' ? 'Waiting for camera permission' : 'Preparing hand tracking'}</p><p className="mt-2 max-w-sm text-xs leading-5 text-muted-foreground">{cameraState === 'requesting' ? 'Your browser may ask you to allow camera access.' : 'Loading the local hand-tracking model. This can take a moment.'}</p><button type="button" onClick={stopCamera} className="mt-4 rounded-lg border border-border bg-card/80 px-3 py-2 text-xs hover:bg-secondary" data-testid="button-cancel-camera">Cancel</button></div>}
            {cameraActive && <div className="absolute left-3 top-3 flex items-center gap-2 rounded-lg border border-white/10 bg-black/45 px-2.5 py-1.5 text-[10px] font-medium text-white backdrop-blur-md" data-testid="status-active-gesture"><span className="h-1.5 w-1.5 rounded-full bg-emerald-300" />{activeGestureName}<span className="mono text-white/55">{Math.round(frame.confidence * 100)}%</span></div>}
            {cameraActive && <button type="button" onClick={stopCamera} className="absolute bottom-3 right-3 inline-flex items-center gap-2 rounded-lg border border-white/15 bg-black/65 px-3 py-2 text-xs font-semibold text-white backdrop-blur transition hover:bg-black/80" data-testid="button-stop-camera"><X size={14} />Stop camera</button>}
            {!cameraActive && !loading && <div className="pointer-events-none absolute bottom-4 left-0 right-0 flex justify-center gap-2 opacity-70"><span className="h-px w-10 bg-primary/35" /><span className="h-px w-3 bg-primary/60" /><span className="h-px w-10 bg-primary/35" /></div>}
          </div>
          <div className="flex flex-col gap-3 border-t border-border/75 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:px-5">
            <div><p className="text-xs font-semibold">Effect intensity <span className="mono ml-1 text-primary" data-testid="text-intensity-value">{intensity}%</span></p><p className="mt-1 text-[10px] text-muted-foreground">Adjust the visual response, not camera sensitivity.</p></div>
            <label className="flex w-full items-center gap-2 sm:max-w-[220px]" aria-label="Effect intensity"><Minus size={13} className="text-muted-foreground" /><input type="range" min="20" max="100" value={intensity} onChange={(event) => setIntensity(Number(event.target.value))} className="h-1.5 min-w-0 flex-1 cursor-pointer accent-primary" data-testid="input-intensity" /><span className="text-muted-foreground">+</span></label>
          </div>
        </section>

        <aside className="flex flex-col gap-4">
          <section className="rounded-2xl border border-border bg-card/65 p-4 sm:p-5" aria-labelledby="controls-heading">
            <div className="mb-4 flex items-start justify-between gap-3"><div><span className="mono text-[9px] tracking-[.16em] text-primary">FOUR WAYS TO PLAY</span><h2 id="controls-heading" className="display mt-1 text-xl font-bold">Choose a movement</h2></div><button type="button" onClick={() => setGuideOpen(!guideOpen)} className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg border transition ${guideOpen ? 'border-primary/30 bg-accent text-accent-foreground' : 'border-border text-muted-foreground hover:bg-secondary'}`} aria-label={guideOpen ? 'Close gesture guide' : 'Open gesture guide'} aria-expanded={guideOpen} data-testid="button-gesture-guide"><ChevronDown size={15} className={`transition-transform ${guideOpen ? 'rotate-180' : ''}`} /></button></div>
            <div className="space-y-2">
              {controls.map((item) => {
                const Icon = item.icon;
                const selected = selectedControl === item.id;
                return <button key={item.id} type="button" onClick={() => setSelectedControl(item.id)} className={`group flex w-full items-center gap-3 rounded-xl border px-3 py-3 text-left transition ${selected ? 'border-primary/35 bg-accent/55' : 'border-transparent bg-background/35 hover:border-border hover:bg-secondary/55'}`} aria-pressed={selected} data-testid={`button-control-${item.id}`}><span className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg ${selected ? 'bg-primary/15 text-primary' : 'bg-secondary text-muted-foreground group-hover:text-foreground'}`}><Icon size={16} /></span><span className="min-w-0 flex-1"><span className="block text-xs font-semibold">{item.title}</span><span className="mt-1 block truncate text-[10px] text-muted-foreground">{item.cue}</span></span>{selected && <Check size={14} className="shrink-0 text-primary" />}</button>;
              })}
            </div>
            {guideOpen && <div className="mt-4 rounded-xl border border-border/75 bg-background/45 p-3.5" data-testid="panel-gesture-guide"><p className="text-xs font-semibold">A small movement guide</p><ul className="mt-2 space-y-2 text-[10px] leading-4 text-muted-foreground"><li><strong className="font-semibold text-foreground">Energy Draw</strong> — point with one index finger and trace through the air.</li><li><strong className="font-semibold text-foreground">Energy Shield</strong> — hold an open palm toward the camera.</li><li><strong className="font-semibold text-foreground">Orb Control</strong> — bring thumb and index fingertip together.</li><li><strong className="font-semibold text-foreground">Expansion</strong> — show both hands, then move them apart or together.</li></ul></div>}
          </section>

          <section className="rounded-2xl border border-border bg-card/65 p-4 sm:p-5" aria-label="Motion settings">
            <div className="mb-3 flex items-center gap-2"><span className="grid h-8 w-8 place-items-center rounded-lg bg-secondary text-primary"><Activity size={15} /></span><div><h2 className="text-sm font-semibold">Lab settings</h2><p className="text-[10px] text-muted-foreground">Your controls, your pace.</p></div></div>
            <div className="flex items-center justify-between gap-3 border-t border-border/75 py-3"><div><p className="text-xs font-semibold">Gesture navigation</p><p className="mt-1 max-w-[190px] text-[10px] leading-4 text-muted-foreground">Let detected gestures select a control in this lab only.</p></div><button type="button" role="switch" aria-checked={gestureNavigation} onClick={() => setGestureNavigation((enabled) => !enabled)} className={`relative h-6 w-11 shrink-0 rounded-full transition ${gestureNavigation ? 'bg-primary' : 'bg-secondary'}`} data-testid="switch-gesture-navigation"><span className={`absolute top-1 h-4 w-4 rounded-full bg-primary-foreground transition-transform ${gestureNavigation ? 'translate-x-6' : 'translate-x-1'}`} /></button></div>
            <div className="flex items-center justify-between border-t border-border/75 py-3"><div><p className="text-xs font-semibold">Appearance</p><p className="mt-1 text-[10px] text-muted-foreground">Currently {theme} mode</p></div><button type="button" onClick={toggleTheme} className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-[10px] font-medium hover:bg-secondary" data-testid="button-motion-theme">{theme === 'dark' ? <Sun size={13} /> : <Moon size={13} />}{theme === 'dark' ? 'Light' : 'Dark'}</button></div>
          </section>
        </aside>
      </div>

      <div className="mt-5 grid gap-4 md:grid-cols-[1fr_auto] md:items-center">
        <div className="flex gap-3 rounded-2xl border border-primary/20 bg-accent/35 px-4 py-4 sm:px-5" role="note" data-testid="note-camera-privacy"><span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary"><Shield size={15} /></span><div><p className="text-xs font-semibold">Private by design</p><p className="mt-1 text-[11px] leading-5 text-muted-foreground">Frames stay on this device. They are not uploaded or recorded. Hand tracking runs locally in your browser; camera access begins only after you enable it.</p></div></div>
        <div className="flex min-h-5 items-center justify-end text-[10px] text-muted-foreground" role="status" aria-live="polite" data-testid="text-motion-feedback">{localMessage}</div>
      </div>
    </div>
  </main>;
}
