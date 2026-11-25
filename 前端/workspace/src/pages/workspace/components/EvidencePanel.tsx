import { useEffect, useRef } from "react";
import { API_BASE } from "@/lib/api";

export default function EvidencePanel({video, seek}: {video: string; seek: (time: number) => void}) {
  const element = useRef<HTMLDivElement>(null);
  const jump = useRef(seek);
  useEffect(() => { jump.current = seek; }, [seek]);
  useEffect(() => {
    let disposed = false;
    let unmount: (() => void) | undefined;
    void Promise.all([import("vue"), import("./EvidenceSearch.vue")]).then(([{createApp}, component]) => {
      if (disposed || !element.current) return;
      const app = createApp(component.default, { base: API_BASE, video, jump: (t: number) => jump.current(t) });
      app.mount(element.current);
      unmount = () => app.unmount();
    }).catch(() => { if (!disposed && element.current) element.current.textContent = "证据检索面板加载失败，请刷新重试"; });
    return () => { disposed = true; unmount?.(); };
  }, [video]);
  return <div ref={element} />;
}
