import { useContext } from "react";
import { PlaybackContext, WorkspaceContext, type PlaybackValue, type WorkspaceValue } from "../workspace-context";

export function useWorkspace(): WorkspaceValue {
  const value = useContext(WorkspaceContext);
  if (!value) throw new Error("useWorkspace must be used inside WorkspaceProvider");
  return value;
}

export function usePlayback(): PlaybackValue {
  const value = useContext(PlaybackContext);
  if (!value) throw new Error("usePlayback must be used inside WorkspaceProvider");
  return value;
}
