import NotFound from "./pages/NotFound";
import ArchivedWorkspace from "./pages/library/ArchivedWorkspace";
import Library from "./pages/library";
import LibraryShell from "./pages/library/LibraryShell";
import Workspace from "./pages/workspace";

export const routers = [
  ...(import.meta.env.VITE_PLATFORM === "true" ? [{
    element: <LibraryShell/>,
    children: [
      {path: "/", name: "workspace", element: null},
      {path: "/library", name: "library", element: <Library/>},
      {path: "/library/videos/:videoId", name: "archived-video", element: <ArchivedWorkspace/>},
    ],
  }] : [{path: "/", name: "workspace", element: <Workspace/>}]),
  {path: "*", name: "404", element: <NotFound/>},
];

declare global {
  interface Window {
    __routers__: typeof routers;
  }
}

window.__routers__ = routers;
