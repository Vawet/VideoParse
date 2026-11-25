import NotFound from "./pages/NotFound";
import Library from "./pages/library";
import Workspace from "./pages/workspace";

export const routers = [
  {
    path: "/",
    name: "workspace",
    element: <Workspace />,
  },
  ...(import.meta.env.VITE_PLATFORM === "true" ? [{path: "/library", name: "library", element: <Library />}] : []),
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
