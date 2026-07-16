import { useEffect } from "react";

// Favicon injected at runtime so every consumer app gets the brand icon from
// this single source (the package ships raw source, so inline data-URIs avoid
// depending on the consumer's asset pipeline). Follows the OS theme, not the
// in-app theme choice: the tab strip renders on browser chrome, which tracks
// the OS.
const GLYPH =
  "M6.54545 1C2.9305 1 -7.15256e-07 3.71427 -7.15256e-07 7.06249C-7.15256e-07 10.4107 2.9305 13.125 6.54545 13.125H6.9V6.68148H4.6V4.92161H11.3V6.68148H9V16C10.6368 14.9031 12.7225 13.2314 14.4449 10.9855C15.4148 9.92818 16 8.55865 16 7.06249C16 3.71427 13.0695 1 9.45455 1H6.54545Z";

// Light tab bar: dark plate + white glyph. Dark tab bar: bare white glyph,
// since the dark plate would melt into the dark chrome.
const LIGHT_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect width="16" height="16" fill="#122310"/><path d="${GLYPH}" fill="white"/></svg>`;
const DARK_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path d="${GLYPH}" fill="white"/></svg>`;

const toHref = (svg: string) => `data:image/svg+xml,${encodeURIComponent(svg)}`;

export function useThemeFavicon(): void {
  useEffect(() => {
    // Drop any static icon links so a stale per-app favicon can't win.
    document.querySelectorAll('link[rel~="icon"]').forEach((el) => el.remove());
    const link = document.createElement("link");
    link.rel = "icon";
    link.type = "image/svg+xml";
    document.head.appendChild(link);

    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      link.href = toHref(mq.matches ? DARK_SVG : LIGHT_SVG);
    };
    apply();
    mq.addEventListener("change", apply);
    // Keep the link on unmount (removing it would blank the tab icon).
    return () => mq.removeEventListener("change", apply);
  }, []);
}
