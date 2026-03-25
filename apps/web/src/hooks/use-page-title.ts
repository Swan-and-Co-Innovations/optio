import { useEffect } from "react";

const SUFFIX = "Optio";

export function usePageTitle(title: string | undefined) {
  useEffect(() => {
    document.title = title ? `${title} — ${SUFFIX}` : SUFFIX;
  }, [title]);
}
