/**
 * Word matching for Ukrainian and Russian text (and English, which needs
 * none of this but survives it). The same pipeline as the built-in skill
 * cyrillic-text-matching, ported once for the engine: apostrophe variants,
 * NFC, stop words, a light suffix strip, and whole-word comparison so that
 * "кіт" never hits "кітель".
 */
const APOS = /['’ʼ‘`´ʹ′]/g;

const STOP = new Set(
  (
    "і й та а але або що це як так не ні ж же би б бо в у на до з із зі за від для по про при під над між через щоб " +
    "коли де там тут вже ще теж також лише тільки дуже його її їх їй йому він вона воно вони ми ви я ти мене тебе себе " +
    "мій моя моє мої твій твоя свій своя цей ця ці той те був була було були є буде бути може треба " +
    "и во что он она оно они с со как то все так его ее но да к вы бы только мне вот от меня еще нет о из ему когда даже " +
    "ну ли если уже или ни быть был него вас ведь потом себя ничего ей тут где есть надо ней мы тебя чем сам без " +
    "чего раз тоже под кто этот того потому этого какой здесь этом мой тем чтобы сейчас " +
    "the a an and or of to in on at for is are was were be it this that with as by from"
  ).split(" "),
);

export function norm(s: string): string {
  return String(s).normalize("NFD").replace(/́/g, "").normalize("NFC").toLowerCase().replace(APOS, "'").replace(/ё/g, "е");
}

export function tokens(s: string): string[] {
  return norm(s)
    .split(/[^\p{L}\p{N}']+/u)
    .map((t) => t.replace(/^'+|'+$/g, ""))
    .filter((t) => t && !STOP.has(t));
}

const SUFFIX = /(ами|ями|ові|еві|ого|ому|ими|ему|ій|ої|ою|ею|ях|ах|ів|ям|ам|ом|ем|им|их|ий|ый|ая|яя|ое|ее|ую|юю|ов|ев|ей|ы|и|і|а|я|у|ю|о|е|ь|й)$/;

export function stem(t: string): string {
  if (t.length <= 3) return t;
  const s = t.replace(SUFFIX, "");
  return s.length >= 3 ? s : t;
}

/** Two tokens are the same word: short ones exactly, longer ones by stem. */
export function sameWord(a: string, b: string): boolean {
  if (a.length <= 3 || b.length <= 3) return a === b;
  const x = stem(a);
  const y = stem(b);
  if (x === y) return true;
  const [s, l] = x.length <= y.length ? [x, y] : [y, x];
  return s.length >= 4 && l.startsWith(s) && l.length - s.length <= 2;
}

/** Every word of the key appears in the text, in any order. */
export function matches(key: string, text: string): boolean {
  const k = tokens(key);
  const t = tokens(text);
  return k.length > 0 && k.every((kw) => t.some((tw) => sameWord(kw, tw)));
}

/** How many distinct words of the query the text contains. */
export function matchCount(queryTokens: readonly string[], text: string): number {
  const t = tokens(text);
  let n = 0;
  for (const q of new Set(queryTokens)) if (t.some((tw) => sameWord(q, tw))) n++;
  return n;
}
