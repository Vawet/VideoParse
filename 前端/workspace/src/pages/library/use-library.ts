import { useQuery } from "@tanstack/react-query";
import { fetchLibrary, getClientId } from "@/lib/api";

export const libraryKey = () => ["library", getClientId()] as const;
export const indexPending = (state: string) => state === "pending" || state === "indexing";

export function useLibrary() {
  return useQuery({
    queryKey: libraryKey(),
    queryFn: fetchLibrary,
    staleTime: 15_000,
    retry: 1,
    refetchOnWindowFocus: "always",
    refetchInterval: query => query.state.data?.documents.some(d => indexPending(d.indexState)) ? 3000 : false,
  });
}
