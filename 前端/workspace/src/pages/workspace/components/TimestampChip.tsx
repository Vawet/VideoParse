import { Clock } from "lucide-react";
import { formatTime } from "@/lib/format";
import { cn } from "@/lib/utils";

type TimestampChipProps = {
  seconds: number;
  onJump: (seconds: number) => void;
  label?: string;
  variant?: "chip" | "plain";
  className?: string;
};

/** Timestamps are the editorial gold of the interface — always rendered the same way. */
export function TimestampChip({
  seconds,
  onJump,
  label,
  variant = "chip",
  className,
}: TimestampChipProps) {
  return (
    <button
      type="button"
      onClick={() => onJump(seconds)}
      title={`跳转到 ${formatTime(seconds)}`}
      className={cn(
        "inline-flex items-center gap-1 rounded-full font-mono text-[0.72em] tabular-nums transition-colors duration-200 ease-smooth focus-visible:ring-offset-0",
        variant === "chip"
          ? "border border-gold/25 bg-gold-soft px-2 py-0.5 font-medium tracking-wide text-gold-soft-foreground hover:border-gold/50 hover:bg-gold/15"
          : "text-gold underline-offset-4 hover:underline",
        className,
      )}
    >
      <Clock className="h-2.5 w-2.5 shrink-0" aria-hidden />
      <span>{label ?? formatTime(seconds)}</span>
    </button>
  );
}
