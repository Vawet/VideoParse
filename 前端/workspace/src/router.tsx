import NotFound from "./pages/NotFound";
import ArchivedWorkspace from "./pages/library/ArchivedWorkspace";
import Library from "./pages/library";
import Workspace from "./pages/workspace";

export const routers = [
  {
    path: "/",
    name: "workspace",
    element: <Workspace />,
  },
  ...(import.meta.env.VITE_PLATFORM === "true" ? [{path: "/library", name: "library", element: <Library />},
    {path: "/library/videos/:videoId", name: "archived-video", element: <ArchivedWorkspace />}] : []),
  /* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */
  {
    path: "*",
    name: "404",
    element: <NotFound />,
  },
];

declare global {
  interface Window {
    __routers__: typeof routers;
  }
}

window.__routers__ = routers;
