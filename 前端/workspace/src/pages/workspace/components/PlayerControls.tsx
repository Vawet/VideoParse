import { ChevronsLeft, ChevronsRight, Gauge, Pause, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Slider } from "@/components/ui/slider";
import { formatTime } from "@/lib/format";
import { usePlayback } from "../hooks/use-workspace";

const RATES = [0.75, 1, 1.25, 1.5, 2];

export function PlayerControls() {
  const { currentTime, playing, rate, duration, toggle, skip, seek, setRate } = usePlayback();

  return (
    <div className="space-y-2.5">
      <Slider
        value={[Math.min(currentTime, duration)]}
        max={duration}
        step={1}
        aria-label="播放进度"
        className="px-1.5"
        onValueChange={([value]) => seek(value)}
      />

      <div className="flex items-center gap-1">
        <Button
          size="icon"
          variant="ghost"
          className="h-8 w-8 rounded-full text-muted-foreground hover:text-foreground"
          onClick={() => skip(-5)}
          aria-label="后退 5 秒"
          title="后退 5 秒(←)"
        >
          <ChevronsLeft className="h-4 w-4" aria-hidden />
        </Button>
        <Button
          size="icon"
          className="h-10 w-10 rounded-full bg-primary text-primary-foreground hover:bg-primary/90"
          onClick={toggle}
          aria-label={playing ? "暂停" : "播放"}
          title={playing ? "暂停(空格)" : "播放(空格)"}
        >
          {playing ? (
            <Pause className="h-4 w-4" aria-hidden />
          ) : (
            <Play className="ml-0.5 h-4 w-4" aria-hidden />
          )}
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="h-8 w-8 rounded-full text-muted-foreground hover:text-foreground"
          onClick={() => skip(5)}
          aria-label="前进 5 秒"
          title="前进 5 秒(→)"
        >
          <ChevronsRight className="h-4 w-4" aria-hidden />
        </Button>

        <span className="ml-2 font-mono text-[11px] tabular-nums text-muted-foreground">
          <span className="text-gold">{formatTime(currentTime)}</span>
          <span className="px-1 text-border">/</span>
          {formatTime(duration)}
        </span>

        <div className="ml-auto flex items-center gap-2">
          <span className="hidden items-center gap-1.5 lg:flex">
            <kbd className="rounded border border-border/80 bg-card px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
              space
            </kbd>
            <kbd className="rounded border border-border/80 bg-card px-1.5 py-0.5 font-mono text-[9px] text-muted-foreground">
              ← →
            </kbd>
            <span className="label-mono text-[8px]">±5s</span>
          </span>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 gap-1.5 rounded-full px-2.5 font-mono text-[11px] tabular-nums text-muted-foreground hover:text-foreground"
              >
                <Gauge className="h-3.5 w-3.5" aria-hidden />
                {rate}×
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-36">
              <DropdownMenuLabel className="label-mono text-[9px]">播放速度</DropdownMenuLabel>
              <DropdownMenuRadioGroup
                value={String(rate)}
                onValueChange={(value) => setRate(Number(value))}
              >
                {RATES.map((option) => (
                  <DropdownMenuRadioItem key={option} value={String(option)}>
                    {option}×
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </div>
  );
}
