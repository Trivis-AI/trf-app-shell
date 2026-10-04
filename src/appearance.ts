import { useCallback, useEffect, useState } from "react";

// Color palette (independent of light/dark). "trivis" is the base brand palette
// (no class); the others add a `theme-<value>` class on <html>, the palette tokens
// shipped by @trf/ui2. Picked under Settings › User settings › Appearance (frontlogin).
export const PALETTE_OPTIONS: { value: string; label: string }[] = [
  { value: "default", label: "Default" },
  { value: "trivis", label: "Trivis" },
  { value: "neutral", label: "Neutral" },
  { value: "amber", label: "Amber" },
  { value: "coffee", label: "Coffee" },
  { value: "claude", label: "Claude" },
  { value: "tangerine", label: "Tangerine" },
  { value: "sky", label: "Sky" },
  { value: "mars", label: "Mars" },
  { value: "disco", label: "Disco" },
  { value: "modern", label: "Modern" },
];
const PALETTE_VALUES = PALETTE_OPTIONS.map((p) => p.value);

// Default is the default: on localhost since 2026-10-01, everywhere since 2026-10-04.
// The palette cookie is written back on every load, so a stored "trivis" cannot tell a
// pick from the old fallback: until this marker is set, the palette reads as Default
// once, and any pick after that stands. Cookies, not localStorage: they sit on the apex
// domain, so every app shares them (on localhost every port does).
const DEFAULT_MARKER = "trf-palette-default-v1";
const hasDefaultMarker = () =>
  document.cookie.split("; ").some((c) => c.startsWith(`${DEFAULT_MARKER}=`));

function cookieAttrs(): string {
  const parts = window.location.hostname.split(".");
  const domain = parts.length >= 2 ? `; domain=.${parts.slice(-2).join(".")}` : "";
  return `; path=/; max-age=31536000; samesite=lax${domain}`;
}

export function readPalette(): string {
  if (!hasDefaultMarker()) return "default";
  const m = document.cookie.match(/(?:^|; )trf-palette=([^;]*)/);
  const v = m ? decodeURIComponent(m[1]) : localStorage.getItem("trf-palette");
  return v && PALETTE_VALUES.includes(v) ? v : "default";
}

function persistPalette(v: string): void {
  document.cookie = `trf-palette=${v}${cookieAttrs()}`;
  document.cookie = `${DEFAULT_MARKER}=1${cookieAttrs()}`;
  localStorage.setItem("trf-palette", v);
}

function applyPalette(v: string): void {
  const el = document.documentElement;
  [...el.classList].filter((c) => c.startsWith("theme-")).forEach((c) => el.classList.remove(c));
  if (v && v !== "trivis") el.classList.add(`theme-${v}`);
}

// One value shared by every hook instance on the page (the shell, the Appearance
// setting): a set broadcasts it and every instance follows.
function useBroadcastState<T>(event: string, read: () => T, valid: (v: T) => boolean): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(read);
  useEffect(() => {
    const onChange = (e: Event) => setValue((e as CustomEvent<T>).detail);
    window.addEventListener(event, onChange);
    return () => window.removeEventListener(event, onChange);
  }, [event]);
  const set = useCallback(
    (v: T) => { if (valid(v)) window.dispatchEvent(new CustomEvent(event, { detail: v })); },
    [event, valid],
  );
  return [value, set];
}

const isPalette = (v: string) => PALETTE_VALUES.includes(v);

/** The colour palette: the `theme-<value>` class on <html>, stored for every app. */
export function usePalette(): [string, (v: string) => void] {
  const [palette, setPalette] = useBroadcastState("trf:palette-changed", readPalette, isPalette);
  useEffect(() => {
    applyPalette(palette);
    persistPalette(palette);
  }, [palette]);
  return [palette, setPalette];
}

// Light, dark or follow the OS: the `.dark` class on <html>. Stored like the palette,
// as a cookie on the apex domain, so AI → Purchase keeps it. Picked under Settings ›
// User settings › Appearance (frontlogin).
export type ColorMode = "light" | "dark" | "system";
export const COLOR_MODES: ColorMode[] = ["light", "dark", "system"];
const isColorMode = (v: string): v is ColorMode => (COLOR_MODES as string[]).includes(v);

function readColorMode(): ColorMode {
  const m = document.cookie.match(/(?:^|; )trf-theme=([^;]*)/);
  const v = m ? decodeURIComponent(m[1]) : localStorage.getItem("trf-theme");
  return v && isColorMode(v) ? v : "light";
}

const systemPrefersDark = () => window.matchMedia("(prefers-color-scheme: dark)").matches;

/** Light, dark or system: applied as `.dark` on <html> (live with the OS in "system"). */
export function useColorMode(): [ColorMode, (v: ColorMode) => void] {
  const [mode, setMode] = useBroadcastState<ColorMode>("trf:color-mode-changed", readColorMode, isColorMode);
  useEffect(() => {
    const apply = () =>
      document.documentElement.classList.toggle("dark", mode === "system" ? systemPrefersDark() : mode === "dark");
    apply();
    document.cookie = `trf-theme=${mode}${cookieAttrs()}`;
    localStorage.setItem("trf-theme", mode);
    if (mode !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [mode]);
  return [mode, setMode];
}
