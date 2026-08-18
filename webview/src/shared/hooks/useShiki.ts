import { useEffect, useState } from "react";
// Value imports MUST come from subpaths only. Importing values from the
// "shiki" main entry pulls in bundledLanguages/bundledThemes registries,
// which reference dynamic imports for ~200 languages/themes. Combined with
// `inlineDynamicImports: true` (CSP single-file constraint in vite.config.ts)
// that inflates main.js by ~8 MB. Import only the 2 themes + 6 langs we use.
import { createHighlighterCore, type HighlighterCore } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";
import javascript from "shiki/langs/javascript.mjs";
import typescript from "shiki/langs/typescript.mjs";
import json from "shiki/langs/json.mjs";
import css from "shiki/langs/css.mjs";
import html from "shiki/langs/html.mjs";
import markdown from "shiki/langs/markdown.mjs";
import githubLight from "shiki/themes/github-light.mjs";
import githubDark from "shiki/themes/github-dark.mjs";

// Global singleton to avoid re-initializing
let highlighterInstance: HighlighterCore | null = null;
let highlighterPromise: Promise<HighlighterCore> | null = null;

function ensureHighlighter(): Promise<HighlighterCore> {
  if (highlighterInstance) {
    return Promise.resolve(highlighterInstance);
  }

  if (!highlighterPromise) {
    highlighterPromise = createHighlighterCore({
      themes: [githubLight, githubDark],
      langs: [javascript, typescript, json, css, html, markdown],
      engine: createJavaScriptRegexEngine(),
    })
      .then((h: HighlighterCore) => {
        highlighterInstance = h;
        return h;
      })
      .catch((error) => {
        highlighterPromise = null;
        throw error;
      });
  }

  return highlighterPromise;
}

export function useShiki() {
  const [highlighter, setHighlighter] = useState<HighlighterCore | null>(
    highlighterInstance,
  );

  useEffect(() => {
    let disposed = false;
    ensureHighlighter()
      .then((h) => {
        if (!disposed) {
          setHighlighter(h);
        }
      })
      .catch(() => {
        // errors are logged in ensureHighlighter
      });

    return () => {
      disposed = true;
    };
  }, []);

  return highlighter;
}
