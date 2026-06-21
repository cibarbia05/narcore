"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

/**
 * Hero headline with a typewriter effect: "Put [word] one step ahead." where
 * [word] cycles through the list — typed, held, deleted, repeat. The rotating
 * word carries the azure accent. The word is sized to its own content so the
 * trailing text always hugs it (no reserved gap), which also keeps any future
 * words of differing length looking right.
 */
const WORDS = ["justice", "law", "media"] as const;

const TYPE_MS = 90;
const DELETE_MS = 45;
const HOLD_MS = 1600;
const GAP_MS = 450;

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

function usePrefersReducedMotion() {
  return useSyncExternalStore(
    (onChange) => {
      const mq = window.matchMedia(REDUCED_MOTION_QUERY);
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    },
    () => window.matchMedia(REDUCED_MOTION_QUERY).matches,
    () => false, // server snapshot: assume motion is allowed
  );
}

export function TypingHeadline() {
  const reduce = usePrefersReducedMotion();
  const [text, setText] = useState("");
  const [wordIndex, setWordIndex] = useState(0);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    // Reduced motion: swap whole words on a calm interval, no typing.
    if (reduce) {
      const t = setTimeout(
        () => setWordIndex((i) => (i + 1) % WORDS.length),
        2200,
      );
      return () => clearTimeout(t);
    }

    const word = WORDS[wordIndex];
    let delay: number;
    if (!deleting) delay = text.length < word.length ? TYPE_MS : HOLD_MS;
    else delay = text.length > 0 ? DELETE_MS : GAP_MS;

    const t = setTimeout(() => {
      if (!deleting) {
        if (text.length < word.length) setText(word.slice(0, text.length + 1));
        else setDeleting(true);
      } else if (text.length > 0) {
        setText(word.slice(0, text.length - 1));
      } else {
        setDeleting(false);
        setWordIndex((i) => (i + 1) % WORDS.length);
      }
    }, delay);
    return () => clearTimeout(t);
  }, [text, deleting, wordIndex, reduce]);

  // Under reduced motion the word is shown whole; otherwise it is typed out.
  const shown = reduce ? WORDS[wordIndex] : text;

  return (
    <h1
      className="mt-8 text-4xl font-semibold tracking-tight text-balance sm:text-5xl"
      aria-label="Put justice, law, and media one step ahead."
    >
      <span aria-hidden="true">
        Put{" "}
        <span className="whitespace-nowrap text-primary">
          {shown}
          {/* Thin bar caret — no glyph side-bearings, so it hugs the word and
              leaves just one normal space before the trailing text. */}
          <span
            aria-hidden="true"
            className="narcore-caret ml-[0.05em] inline-block h-[0.78em] w-[0.055em] translate-y-[0.06em] bg-primary"
          />
        </span>{" "}
        one step ahead.
      </span>
    </h1>
  );
}
