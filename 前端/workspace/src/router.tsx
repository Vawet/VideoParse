import NotFound from "./pages/NotFound";
import Workspace from "./pages/workspace";

export const routers = [
  {
    path: "/",
    name: "workspace",
    element: <Workspace />,
  },
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
