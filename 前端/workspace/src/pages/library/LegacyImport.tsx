import { useState } from "react";
import { getClientId } from "@/lib/api";

export function LegacyImport() {
  const [command, setCommand] = useState("");
  const [notice, setNotice] = useState("");
  if (!["localhost", "127.0.0.1", "[::1]"].includes(window.location.hostname)) return null;

  function select(files: FileList | null) {
    setCommand(""); setNotice("");
    if (!files?.length) return;
    const ids = Array.from(files, file => /^([A-Za-z0-9_-]{1,64})_result\.json$/.exec(file.name)?.[1]);
    const owner = getClientId();
    if (ids.some(id => !id) || !/^[0-9a-f]{32}$/.test(owner)) {
      setNotice("请选择旧版 outputs 目录中的 视频编号_result.json 文件，并确认资料库已加载。");
      return;
    }
    setCommand("./infra/platform/import-local-videos.sh --workspace " + owner + " -- " + ids.join(" "));
  }

  return <details className="mt-3 text-xs text-muted-foreground">
    <summary className="cursor-pointer">迁入本机旧版视频</summary>
    <label className="mt-2 block">选择旧版 outputs 目录中属于你的解析结果
      <input className="mt-2 block w-full" type="file" multiple accept=".json" onChange={e=>select(e.target.files)}/>
    </label>
    {command && <div className="mt-2 space-y-2">
      <p>在运行本机平台的 Mac 上，从项目根目录执行以下命令。发布完成后刷新资料库。</p>
      <code className="block select-all break-all">{command}</code>
      <button className="text-primary underline" onClick={() => navigator.clipboard.writeText(command)
        .then(()=>setNotice("已复制")).catch(()=>setNotice("请选择上方命令后手动复制。"))}>复制迁移命令</button>
    </div>}
    {notice && <p role="status" className="mt-2">{notice}</p>}
  </details>;
}
