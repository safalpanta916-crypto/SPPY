import { useCallback, useEffect, useRef, useState } from "react";
import type {
  HandLandmarker as HandLandmarkerType,
  NormalizedLandmark,
} from "@mediapipe/tasks-vision";

export type MotionGesture =
  | "none"
  | "energy-draw"
  | "energy-shield"
  | "orb-control"
  | "two-hand-expansion";

export interface HandFrame {
  landmarks: NormalizedLandmark[][];
  gesture: MotionGesture;
  confidence: number;
  timestamp: number;
}

type CameraState = "idle" | "requesting" | "loading" | "ready" | "error";

const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";
const WASM_URL =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.2/wasm";

function distance(a: NormalizedLandmark, b: NormalizedLandmark) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function fingerExtended(
  points: NormalizedLandmark[],
  tip: number,
  pip: number,
) {
  return points[tip].y < points[pip].y;
}

export function classifyGesture(hands: NormalizedLandmark[][]): MotionGesture {
  if (hands.length >= 2) return "two-hand-expansion";
  const points = hands[0];
  if (!points || points.length < 21) return "none";

  const index = fingerExtended(points, 8, 6);
  const middle = fingerExtended(points, 12, 10);
  const ring = fingerExtended(points, 16, 14);
  const pinky = fingerExtended(points, 20, 18);
  const palmScale = Math.max(distance(points[0], points[9]), 0.001);
  const pinchRatio = distance(points[4], points[8]) / palmScale;

  if (pinchRatio < 0.38) return "orb-control";
  if (index && middle && ring && pinky) return "energy-shield";
  if (index && !middle && !ring && !pinky) return "energy-draw";
  return "none";
}

function confidenceFromResult(
  handedness: { score?: number }[][] | undefined,
): number {
  const scores =
    handedness?.flatMap((hand) =>
      hand.map((category) => category.score).filter(
        (score): score is number => typeof score === "number",
      ),
    ) ?? [];
  if (scores.length === 0) return 0;
  return scores.reduce((total, score) => total + score, 0) / scores.length;
}

function cameraErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    if (error.name === "NotAllowedError" || error.name === "SecurityError") {
      return "Camera access was denied. Allow camera access in your browser settings, then try again.";
    }
    if (error.name === "NotFoundError" || error.name === "DevicesNotFoundError") {
      return "No camera was found on this device.";
    }
    if (error.name === "NotReadableError" || error.name === "TrackStartError") {
      return "The camera is busy in another app. Close it there and try again.";
    }
  }
  return "SPPY could not start hand tracking. Check your camera and connection, then try again.";
}

export function useHandTracking() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const landmarkerRef = useRef<HandLandmarkerType | null>(null);
  const animationRef = useRef<number | null>(null);
  const generationRef = useRef(0);
  const stableRef = useRef({
    candidate: "none" as MotionGesture,
    gesture: "none" as MotionGesture,
    frames: 0,
  });
  const [cameraState, setCameraState] = useState<CameraState>("idle");
  const [error, setError] = useState("");
  const [frame, setFrame] = useState<HandFrame>({
    landmarks: [],
    gesture: "none",
    confidence: 0,
    timestamp: 0,
  });

  const stopCamera = useCallback(() => {
    generationRef.current += 1;
    if (animationRef.current !== null) {
      cancelAnimationFrame(animationRef.current);
      animationRef.current = null;
    }
    try {
      landmarkerRef.current?.close();
    } catch {
      // A model may already be disposed while camera permission was pending.
    }
    landmarkerRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.srcObject = null;
    }
    stableRef.current = { candidate: "none", gesture: "none", frames: 0 };
    setFrame({ landmarks: [], gesture: "none", confidence: 0, timestamp: 0 });
    setCameraState("idle");
    setError("");
  }, []);

  const startCamera = useCallback(async () => {
    if (cameraState === "requesting" || cameraState === "loading" || cameraState === "ready") {
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraState("error");
      setError("Camera access is unavailable in this browser or page context.");
      return;
    }

    const generation = generationRef.current + 1;
    generationRef.current = generation;
    setError("");
    setCameraState("requesting");

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: "user",
          width: { ideal: 960 },
          height: { ideal: 540 },
          frameRate: { ideal: 24, max: 30 },
        },
      });
      if (generation !== generationRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) throw new Error("Camera preview is not ready.");
      video.srcObject = stream;
      video.muted = true;
      video.playsInline = true;
      await video.play();
      setCameraState("loading");

      const { FilesetResolver, HandLandmarker } = await import("@mediapipe/tasks-vision");
      const fileset = await FilesetResolver.forVisionTasks(WASM_URL);
      let landmarker: HandLandmarkerType;
      try {
        landmarker = await HandLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: MODEL_URL, delegate: "GPU" },
          runningMode: "VIDEO",
          numHands: 2,
          minHandDetectionConfidence: 0.55,
          minHandPresenceConfidence: 0.5,
          minTrackingConfidence: 0.5,
        });
      } catch {
        landmarker = await HandLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: MODEL_URL, delegate: "CPU" },
          runningMode: "VIDEO",
          numHands: 2,
          minHandDetectionConfidence: 0.55,
          minHandPresenceConfidence: 0.5,
          minTrackingConfidence: 0.5,
        });
      }

      if (generation !== generationRef.current) {
        landmarker.close();
        return;
      }
      landmarkerRef.current = landmarker;
      setCameraState("ready");

      let lastTime = 0;
      let lastVideoTime = -1;
      const detect = (time: number) => {
        if (generation !== generationRef.current) return;
        const activeVideo = videoRef.current;
        const task = landmarkerRef.current;
        if (
          activeVideo &&
          task &&
          activeVideo.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
          activeVideo.currentTime !== lastVideoTime &&
          time - lastTime >= 66
        ) {
          lastTime = time;
          lastVideoTime = activeVideo.currentTime;
          try {
            const result = task.detectForVideo(activeVideo, time);
            const nextGesture = classifyGesture(result.landmarks);
            if (nextGesture === stableRef.current.candidate) {
              stableRef.current.frames += 1;
            } else {
              stableRef.current.candidate = nextGesture;
              stableRef.current.frames = 1;
            }
            if (nextGesture === "none") {
              stableRef.current.gesture = "none";
            } else if (stableRef.current.frames >= 3) {
              stableRef.current.gesture = nextGesture;
            }
            setFrame({
              landmarks: result.landmarks,
              gesture: stableRef.current.gesture,
              confidence: confidenceFromResult(result.handedness),
              timestamp: time,
            });
          } catch {
            setError("Hand tracking paused. Try stopping and enabling the camera again.");
          }
        }
        animationRef.current = requestAnimationFrame(detect);
      };
      animationRef.current = requestAnimationFrame(detect);
    } catch (cameraError) {
      if (generation !== generationRef.current) return;
      stopCamera();
      setCameraState("error");
      setError(cameraErrorMessage(cameraError));
    }
  }, [cameraState, stopCamera]);

  useEffect(() => () => stopCamera(), [stopCamera]);

  return {
    videoRef,
    cameraState,
    cameraActive: cameraState === "ready",
    loading: cameraState === "requesting" || cameraState === "loading",
    error,
    frame,
    startCamera,
    stopCamera,
  };
}
