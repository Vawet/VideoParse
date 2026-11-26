import { useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { changeAccount, workspaceUsername } from "@/lib/api";

export function WorkspaceAccount() {
  const {data:user} = useQuery({queryKey:["workspace-account"],queryFn:workspaceUsername,staleTime:Infinity});
  const [register,setRegister] = useState(false);
  const [name,setName] = useState("");
  const [password,setPassword] = useState("");
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault(); if (busy) return;
    setBusy(true); setError("");
    try {
      await changeAccount(user?"logout":register?"register":"login",{username:name,password});
    } catch (e) { setError((e as Error).message); setBusy(false); }
  }
  return <Dialog onOpenChange={open=>{if (!open) {setPassword(""); setError("");}}}><DialogTrigger asChild>
    <Button variant={user ? "ghost" : "default"} size="sm" className="mx-3 mb-2 justify-start">
      <UserRound size={16}/><span className="truncate">{user || "登录 / 注册"}</span>
    </Button></DialogTrigger>
    <DialogContent><DialogHeader><DialogTitle>{user?"我的账号":register?"注册账号":"登录账号"}</DialogTitle>
      <DialogDescription>{user?"当前工作区属于 "+user+"。退出后将回到示例课程。":
        register?"创建账号后即可上传视频和 Markdown。":"登录后即可上传资料，并在其他设备上继续学习。"}</DialogDescription></DialogHeader>
      <form className="space-y-4" onSubmit={submit}>
        {!user && <>
          <label className="block space-y-1 text-sm">用户名<Input autoComplete="username" value={name} onChange={e=>setName(e.target.value)}
            placeholder="3–64 位字母、数字或 ._-" required minLength={3} maxLength={64}/></label>
          <label className="block space-y-1 text-sm">密码<Input type="password" autoComplete={register?"new-password":"current-password"}
            value={password} onChange={e=>setPassword(e.target.value)} placeholder="至少 8 个字符" required minLength={8} maxLength={128}/></label>
        </>}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <div className="flex items-center justify-between gap-2">
          <Button type="submit" disabled={busy}>{user?"退出账号":register?"注册并登录":"登录"}</Button>
          {!user && <Button type="button" disabled={busy} variant="ghost" onClick={()=>{setRegister(!register);setError("");}}>{register?"已有账号":"注册账号"}</Button>}
        </div>
      </form>
    </DialogContent>
  </Dialog>;
}
