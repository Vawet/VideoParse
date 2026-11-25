import { BilibiliComments } from "./Bilibili";
import { useWorkspace } from "../hooks/use-workspace";
import { ChapterList } from "./ChapterList";
import { PlayerSurface } from "./PlayerSurface";

/** Left pane of the workbench: player on top, chapter timeline below. */
export function VideoPane() {
  const {isLive,videoId} = useWorkspace();
  return (
    <div className="study-video-pane flex min-h-0 flex-1 flex-col gap-3 p-3 md:p-4">
      <div className="study-player"><PlayerSurface /></div>
      {import.meta.env.VITE_PLATFORM === "true" && isLive && videoId && <BilibiliComments key={videoId} video={videoId}/>}
      <div className="study-chapters flex min-h-0 flex-1 flex-col"><ChapterList /></div>
    </div>
  );
}
