import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { fetchArchivedVideo, type ArchivedVideo } from "@/lib/api";
import { useLibrary } from "./use-library";
import Workspace from "../workspace";

function LoadVideo({id}: {id: string}) {
  const [archive, setArchive] = useState<ArchivedVideo>();
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    fetchArchivedVideo(id, controller.signal).then(setArchive).catch(e => {
      if (!controller.signal.aborted) setError(e.message);
    });
    return () => controller.abort();
  }, [id]);
  const {data} = useLibrary();
  const name = data?.videos.find(v => v.id === id)?.name;
  const current = useMemo(() => archive && name && archive.video.name !== name
    ? {...archive, video: {...archive.video, name}} : archive, [archive, name]);
  if (current) return <Workspace archive={current}/>;
  return <main className="mx-auto max-w-3xl space-y-4 px-6 pt-16">
    <Link to="/library" className="text-sm text-primary underline">返回资料库</Link>
    <p role="status">{error || "正在读取视频解析结果…"}</p>
  </main>;
}

export default function ArchivedWorkspace() {
  const {videoId = ""} = useParams();
  return <LoadVideo key={videoId} id={videoId}/>;
}
