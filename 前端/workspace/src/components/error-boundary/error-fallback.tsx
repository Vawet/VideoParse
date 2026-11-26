import { getErrorMessage, type FallbackProps } from "react-error-boundary";

import { Button } from "@/components/ui/button";

/** Full-page fallback shown when a render error escapes a page or the app shell. */
export const ErrorFallback = ({ error, resetErrorBoundary }: FallbackProps) => {
  // Error details help while building; published builds keep them out of the UI.
  const details = import.meta.env.DEV ? getErrorMessage(error) : undefined;

  return (
    <div
      role="alert"
      className="flex min-h-screen items-center justify-center bg-background p-6"
    >
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-7 text-center shadow-soft">
        <h1 className="mb-2 text-2xl font-semibold text-foreground">
          页面加载失败
        </h1>
        <p className="mb-6 text-muted-foreground">
          请重试，或返回工作台重新打开。
        </p>
        {details && (
          <pre className="mb-6 whitespace-pre-wrap break-words rounded-md bg-muted p-3 text-left text-sm text-muted-foreground">
            {details}
          </pre>
        )}
        <div className="flex justify-center gap-3">
          <Button onClick={resetErrorBoundary}>重试</Button>
          <Button variant="outline" asChild>
            <a href="/">返回工作台</a>
          </Button>
        </div>
      </div>
    </div>
  );
};
