import { useCallback, useMemo, useState } from "react";
import type { QuizQuestion } from "../data/types";

export type QuizAnswer = {
  /** Chosen option for a single-choice question. */
  choiceId?: string;
  /** Whether the answer has been marked correct (choice or self-graded). */
  correct?: boolean;
  /** True once the learner has graded a short-answer question themselves. */
  revealedShort?: boolean;
};

export type QuizSession = {
  answers: Record<string, QuizAnswer>;
  answeredCount: number;
  correctCount: number;
  total: number;
  choose: (questionId: string, optionId: string) => void;
  revealShort: (questionId: string) => void;
  gradeShort: (questionId: string, correct: boolean) => void;
  restart: () => void;
};

/** Keeps quiz progress alive across tab switches. */
export function useQuizSession(questions: QuizQuestion[]): QuizSession {
  const [answers, setAnswers] = useState<Record<string, QuizAnswer>>({});

  const choose = useCallback(
    (questionId: string, optionId: string) => {
      const question = questions.find((item) => item.id === questionId);
      if (!question) return;
      setAnswers((previous) => {
        if (previous[questionId]?.choiceId) return previous;
        return {
          ...previous,
          [questionId]: { choiceId: optionId, correct: optionId === question.answerId },
        };
      });
    },
    [questions],
  );

  const revealShort = useCallback((questionId: string) => {
    setAnswers((previous) => ({
      ...previous,
      [questionId]: { ...previous[questionId], revealedShort: true },
    }));
  }, []);

  const gradeShort = useCallback((questionId: string, correct: boolean) => {
    setAnswers((previous) => ({
      ...previous,
      [questionId]: { ...previous[questionId], revealedShort: true, correct },
    }));
  }, []);

  const restart = useCallback(() => setAnswers({}), []);

  const { answeredCount, correctCount } = useMemo(() => {
    const values = Object.values(answers).filter(
      (answer) => answer.choiceId !== undefined || answer.correct !== undefined,
    );
    return {
      answeredCount: values.length,
      correctCount: values.filter((answer) => answer.correct).length,
    };
  }, [answers]);

  return {
    answers,
    answeredCount,
    correctCount,
    total: questions.length,
    choose,
    revealShort,
    gradeShort,
    restart,
  };
}
