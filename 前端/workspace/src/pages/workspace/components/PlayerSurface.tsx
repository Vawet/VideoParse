import { Pause, Play } from "lucide-react";
import { usePlayback, useWorkspace } from "../hooks/use-workspace";
import { PlayerControls } from "./PlayerControls";

/** The video surface and its transport — everything above the chapter list. */
export function PlayerSurface() {
  const { videoMode, videoUrl, posterImage, videoRef, reportMediaDuration, status } =
    useWorkspace();
  const { playing, toggle } = usePlayback();
  const hasFile = videoMode === "file" && Boolean(videoUrl);

  return (
    <div className="space-y-2.5">
      <div className="frame-brackets">
        <div className="relative aspect-video w-full overflow-hidden rounded-xl border border-border/70 bg-gradient-stage">
          {hasFile ? (
            <video
              ref={videoRef}
              src={videoUrl ?? undefined}
              className="h-full w-full object-contain"
              playsInline
              onLoadedMetadata={(event) => reportMediaDuration(event.currentTarget.duration)}
            />
          ) : (
            <>
              <img
                src={posterImage}
                alt="示例视频封面帧"
                crossOrigin="anonymous"
                className="h-full w-full object-cover opacity-90"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-background/70 via-transparent to-transparent" aria-hidden />
              <div className="vp-stage-grid absolute inset-0 opacity-60" aria-hidden />
              <button
                type="button"
                onClick={toggle}
                aria-label={playing ? "暂停示例视频" : "播放示例视频"}
                className="group absolute inset-0 flex items-center justify-center"
              >
                <span className="flex h-16 w-16 items-center justify-center rounded-full border border-primary/40 bg-background/70 text-primary shadow-elevated backdrop-blur transition-transform duration-200 ease-smooth group-hover:scale-105">
                  {playing ? (
                    <Pause className="h-5 w-5" aria-hidden />
                  ) : (
                    <Play className="ml-0.5 h-5 w-5" aria-hidden />
                  )}
                </span>
              </button>
              <span className="absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-background/70 px-2.5 py-1 backdrop-blur">
                <span className="h-1.5 w-1.5 rounded-full bg-gold" aria-hidden />
                <span className="label-mono text-[8px] text-foreground/80">
                  {status === "empty" ? "Demo reel" : "Demo · no media file"}
                </span>
              </span>
            </>
          )}
        </div>
      </div>

      <PlayerControls />
    </div>
  );
}
