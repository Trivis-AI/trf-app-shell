/**
 * The shell's own UI text goes through the app's translation client, which every app
 * already passes in as `translation`. AppShellLayout points this at it on each render;
 * an app whose client has no translate gets the English fallbacks.
 */
type Translate = (key: string, fallback: string) => string;

const english: Translate = (_key, fallback) => fallback;

let translate: Translate = english;

export function setShellTranslate(fn: Translate | undefined): void {
  translate = fn ?? english;
}

/** A shell UI text: shellText("<trn-shell-sign-out>", "Sign out"). Call it while rendering. */
export function shellText(key: string, fallback: string): string {
  // i18n-ignore: passes the caller's key on.
  return translate(key, fallback);
}
