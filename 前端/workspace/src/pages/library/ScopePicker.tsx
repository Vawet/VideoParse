import { useState } from "react";
import { Check, ChevronsUpDown, Layers3 } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

type ScopeGroup = {label: string; icon: LucideIcon; items: {value: string; name: string}[]};

export function ScopePicker({value, groups, disabled, onChange}: {
  value: string; groups: ScopeGroup[]; disabled: boolean; onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const group = groups.find(group => group.items.some(item => item.value === value));
  const selected = group?.items.find(item => item.value === value);
  const Icon = group?.icon ?? Layers3;
  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger asChild>
      <button type="button" disabled={disabled} aria-label="检索范围" title={selected?.name}
        className="inline-flex min-h-9 max-w-[55%] items-center gap-2 rounded-full border border-primary/25 bg-primary/5 px-3 text-xs font-medium hover:bg-primary/10 focus-visible:outline-ring disabled:opacity-50">
        <Icon size={15} aria-hidden className="shrink-0 text-primary"/>
        <span className="truncate">{selected?.name ?? "选择资料"}</span><ChevronsUpDown size={13} aria-hidden className="shrink-0 text-muted-foreground"/>
      </button>
    </PopoverTrigger>
    <PopoverContent aria-label="选择检索范围" side="top" align="start" collisionPadding={10}
      className="w-[min(21rem,calc(100vw-1.5rem))] overflow-hidden rounded-2xl p-1 shadow-xl">
      <Command loop label="搜索检索范围">
        <CommandInput placeholder="搜索资料名称…" aria-label="搜索资料名称"/>
        <CommandList className="max-h-[min(18rem,calc(var(--radix-popover-content-available-height)-3.5rem))]">
          <CommandEmpty>没有匹配的资料</CommandEmpty>
          {groups.filter(g => g.items.length > 0).map(({label, icon: ItemIcon, items}) =>
            <CommandGroup key={label} heading={label}>
              {items.map(item => <CommandItem key={item.value} value={"scope:" + item.value} keywords={[item.name]}
                onSelect={() => {if (item.value !== value) onChange(item.value); setOpen(false);}}
                className="min-h-10 gap-2 rounded-lg px-2.5">
                <ItemIcon size={16} aria-hidden className="shrink-0 text-primary"/>
                <span className="min-w-0 flex-1 break-all">{item.name}</span>
                {item.value === value && <><Check size={15} aria-hidden className="shrink-0 text-primary"/><span className="sr-only">已选中</span></>}
              </CommandItem>)}
            </CommandGroup>)}
        </CommandList>
      </Command>
    </PopoverContent>
  </Popover>;
}
