import { AccountBoundary } from "./pages/library/AccountBoundary";
import { ApiUsageBar } from "./components/ApiUsageBar";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import { RouteErrorBoundary } from "./components/error-boundary/route-error-boundary";
import { routers } from "./router";

const queryClient = new QueryClient();

// Created once so remounting App (e.g. after an error-boundary retry) never
// leaves a second router listening to history. The pathless root route is the
// shared errorElement every page bubbles up to; a page can still declare its
// own errorElement, statically or through lazy().
const router = createBrowserRouter([
  { errorElement: <RouteErrorBoundary />, children: routers },
]);

const App = () => {
  const workspace = (
    <div className="flex h-dvh min-h-0 flex-col">
      <div className="min-h-0 flex-1"><RouterProvider router={router} /></div>
      <ApiUsageBar />
    </div>
  );
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <Toaster />
          <Sonner />
          {import.meta.env.VITE_PLATFORM === "true" ? <AccountBoundary>{workspace}</AccountBoundary> : workspace}
        </TooltipProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
};

export default App;
