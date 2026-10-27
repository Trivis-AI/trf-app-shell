import { useEffect, useState } from "react";

/** A language the shell's menu offers. */
export interface ShellLanguage {
  code: string;
  label: string;
  /** Machine-translated and not yet reviewed (services marks it so). */
  beta: boolean;
}

interface LanguageLists {
  languages: string[];
  beta: string[];
}

/** Shown until services answers, and when it cannot: what the menu listed before. */
const FALLBACK: LanguageLists = { languages: ["en", "ee", "lv", "lt"], beta: ["lv", "lt"] };

// Each language is listed in its own name. Which ones show, and which are beta, comes from
// services (GET /v1/translations/languages), so switching a language on needs no shell release.
const NAMES: Record<string, string> = {
  en: "English",
  ee: "Eesti",
  lv: "Latviešu",
  lt: "Lietuvių",
  es: "Español",
  sv: "Svenska",
  nb: "Norsk bokmål",
  da: "Dansk",
  fi: "Suomi",
  it: "Italiano",
  fr: "Français",
  de: "Deutsch",
  pl: "Polski",
};

// Base URL of trfservices, derived from the hostname the way @trf/ui's config does it.
// Off-apex hosts (localhost) go through the app's /proxy/services-api dev proxy.
function servicesApiBase(): string {
  const parts = window.location.hostname.split(".");
  if (parts.length < 2) return "/proxy/services-api";
  return `https://services-api.${parts.slice(-2).join(".")}`;
}

let request: Promise<LanguageLists> | null = null;

function loadLanguages(): Promise<LanguageLists> {
  if (!request) {
    request = fetch(`${servicesApiBase()}/v1/translations/languages`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) =>
        d && Array.isArray(d.languages) && d.languages.length > 0
          ? { languages: d.languages, beta: Array.isArray(d.beta) ? d.beta : [] }
          : FALLBACK,
      )
      .catch(() => FALLBACK);
  }
  return request;
}

/** The languages the shell's menu offers, in services' order, beta ones marked. */
export function useLanguages(): ShellLanguage[] {
  const [lists, setLists] = useState<LanguageLists>(FALLBACK);
  useEffect(() => {
    let live = true;
    void loadLanguages().then((l) => {
      if (live) setLists(l);
    });
    return () => {
      live = false;
    };
  }, []);
  return lists.languages.map((code) => ({
    code,
    label: NAMES[code] ?? code.toUpperCase(),
    beta: lists.beta.includes(code),
  }));
}
