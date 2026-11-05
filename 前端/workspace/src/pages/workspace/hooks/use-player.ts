import { useCallback, useEffect, useState } from "react";
import { clamp } from "@/lib/format";

export type PlayerMode = "mock" | "file";

type Options = {
  mode: PlayerMode;
  duration: number;
  /** The <video> element used when a real file is loaded. */
  mediaRef: React.RefObject<HTMLVideoElement | null>;
  /** Changing key means a new media source: playback restarts from zero. */
  sourceKey: string;
};

/**
 * One player surface over two backends: a real <video> element for an uploaded
 * file, and a simulated clock for the bundled demo video. Both feed the same
 * current time, so chapters, notes and chat citations stay in sync either way.
 */
export function usePlayer({ mode, duration, mediaRef, sourceKey }: Options) {
  const [currentTime, setCurrentTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [rate, setRate] = useState(1);

  useEffect(() => {
    setCurrentTime(0);
    setPlaying(false);
  }, [sourceKey]);

  // Simulated clock — sampled at 5 Hz, which is plenty for a progress bar.
  useEffect(() => {
    if (mode !== "mock" || !playing) return;
    let last = performance.now();
    const timer = window.setInterval(() => {
      const now = performance.now();
      const delta = (now - last) / 1000;
      last = now;
      setCurrentTime((value) => {
        const next = value + delta * rate;
        if (next >= duration) {
          setPlaying(false);
          return duration;
        }
        return next;
      });
    }, 200);
    return () => window.clearInterval(timer);
  }, [mode, playing, rate, duration]);

  // Real media element: mirror its state, and apply the playback rate.
  useEffect(() => {
    const element = mediaRef.current;
    if (mode !== "file" || !element) return;
    element.playbackRate = rate;
    const sync = () => setCurrentTime(element.currentTime);
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    element.addEventListener("timeupdate", sync);
    element.addEventListener("seeking", sync);
    element.addEventListener("play", onPlay);
    element.addEventListener("pause", onPause);
    element.addEventListener("ended", onPause);
    return () => {
      element.removeEventListener("timeupdate", sync);
      element.removeEventListener("seeking", sync);
      element.removeEventListener("play", onPlay);
      element.removeEventListener("pause", onPause);
      element.removeEventListener("ended", onPause);
    };
  }, [mode, mediaRef, rate, sourceKey]);

  const play = useCallback(() => {
    const element = mediaRef.current;
    if (mode === "file" && element) void element.play().catch(() => setPlaying(false));
    setPlaying(true);
  }, [mediaRef, mode]);

  const pause = useCallback(() => {
    mediaRef.current?.pause();
    setPlaying(false);
  }, [mediaRef]);

  const toggle = useCallback(() => {
    if (playing) pause();
    else play();
  }, [pause, play, playing]);

  const seek = useCallback(
    (time: number) => {
      const target = clamp(time, 0, duration || 0);
      const element = mediaRef.current;
      if (mode === "file" && element) element.currentTime = target;
      setCurrentTime(target);
    },
    [duration, mediaRef, mode],
  );

  const skip = useCallback((delta: number) => seek(currentTime + delta), [currentTime, seek]);

  return { currentTime, playing, rate, play, pause, toggle, seek, skip, setRate };
}
