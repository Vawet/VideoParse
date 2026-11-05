import { useCallback, useMemo, useState } from "react";
import type { ReviewCard } from "../data/types";

export type ReviewOutcome = "forgot" | "shaky" | "known";

export type ReviewQueueItem = {
  card: ReviewCard;
  outcome: ReviewOutcome;
  /** Next interval the scheduler picked, in days. */
  nextIntervalDays: number;
};

export type ReviewSession = {
  /** Cards still waiting in the session queue. */
  pending: ReviewCard[];
  /** Cards already graded, newest first. */
  graded: ReviewQueueItem[];
  masteredCount: number;
  total: number;
  grade: (card: ReviewCard, outcome: ReviewOutcome) => void;
  restart: () => void;
};

const MULTIPLIER: Record<ReviewOutcome, number> = { forgot: 0.5, shaky: 1.5, known: 2.5 };

/** In-session spaced repetition: three feedback levels, SM-2 style intervals. */
export function useReviewSession(cards: ReviewCard[]): ReviewSession {
  const [index, setIndex] = useState(0);
  const [graded, setGraded] = useState<ReviewQueueItem[]>([]);

  const grade = useCallback(
    (card: ReviewCard, outcome: ReviewOutcome) => {
      setGraded((previous) => [
        {
          card,
          outcome,
          nextIntervalDays: Math.max(1, Math.round(card.intervalDays * MULTIPLIER[outcome])),
        },
        ...previous,
      ]);
      setIndex((value) => value + 1);
    },
    [],
  );

  const restart = useCallback(() => {
    setIndex(0);
    setGraded([]);
  }, []);

  const pending = useMemo(() => cards.slice(index), [cards, index]);
  const masteredCount = graded.filter((item) => item.outcome === "known").length;

  return {
    pending,
    graded,
    masteredCount,
    total: cards.length,
    grade,
    restart,
  };
}
