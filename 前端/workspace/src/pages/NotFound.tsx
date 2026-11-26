import { Link } from "react-router-dom";
import { ArrowLeft, FolderSearch } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return <main className="grid h-full place-items-center bg-background p-6">
    <section className="rounded-2xl border border-border bg-card p-9 text-center shadow-soft">
      <FolderSearch size={32} className="mx-auto mb-4 text-primary" aria-hidden/>
      <h1 className="text-2xl font-semibold">找不到这个页面</h1>
      <p className="mb-6 mt-2 text-sm text-muted-foreground">请检查地址，或回到工作台打开资料。</p>
      <Button asChild><Link to="/"><ArrowLeft size={15}/>返回工作台</Link></Button>
    </section>
  </main>;
}
