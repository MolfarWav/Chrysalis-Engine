---
name: cyrillic-text-matching
description: Use when code matches, searches, recalls or triggers on Ukrainian or Russian text: memory recall, lorebook keywords, search, dedupe. Triggers: "не знаходить спогади", "ключові слова не спрацьовують", "пошук українською", "апостроф", "відмінки", "recall misses".
---

# Matching Ukrainian and Russian text

`text.toLowerCase().includes(key)` fails in ways that look random. Fix the pipeline once; do not patch individual keywords.

## Symptom → cause
| Symptom | Cause |
|---|---|
| `пам'ять` misses `пам’ять` | Apostrophe variants: `'` `’` `ʼ` `‘` `` ` `` are different characters |
| `Олена` misses `Оленою`, `Олени` | Inflection: exact match ignores case endings |
| `кіт` hits `кітель` | Substring match inside another word |
| `/\bкіт\b/` never matches | JS `\b` is ASCII-only, even with the `u` flag |
| Almost everything matches | Stop words (`що`, `це`, `и`, `не`) counted as keywords |
| Pasted `й`/`ї` fails equality | Decomposed Unicode (`и` + U+0306); fix with NFC |
| `ёлка` misses `елка` | Russian `ё`/`е` |

## The pipeline (tested in the plugin runtime, QuickJS)
Apply the same `norm` to both sides: the stored key and the text.

```js
const APOS = /['’ʼ‘`´ʹ′]/g;
const STOP = new Set((
  "і й та а але або що це як так не ні ж же би б бо в у на до з із зі за від для по про при під над між через щоб " +
  "коли де там тут вже ще теж також лише тільки дуже його її їх їй йому він вона воно вони ми ви я ти мене тебе себе " +
  "мій моя моє мої твій твоя свій своя цей ця ці той те був була було були є буде бути може треба " +
  "и во что он она оно они с со как то все так его ее но да к вы бы только мне вот от меня еще нет о из ему когда даже " +
  "ну ли если уже или ни быть был него вас ведь потом себя ничего ей тут где есть надо ней мы тебя чем сам без " +
  "чего раз тоже под кто этот того потому этого какой здесь этом мой тем чтобы сейчас"
).split(" "));

export function norm(s) {
  return String(s).normalize("NFD").replace(/́/g, "").normalize("NFC")
    .toLowerCase().replace(APOS, "'").replace(/ё/g, "е");
}

export function tokens(s) {
  return norm(s).split(/[^\p{L}\p{N}']+/u)
    .map((t) => t.replace(/^'+|'+$/g, ""))
    .filter((t) => t && !STOP.has(t));
}

const SUFFIX = /(ами|ями|ові|еві|ого|ому|ими|ему|ій|ої|ою|ею|ях|ах|ів|ям|ам|ом|ем|им|их|ий|ый|ая|яя|ое|ее|ую|юю|ов|ев|ей|ы|и|і|а|я|у|ю|о|е|ь|й)$/;

export function stem(t) {
  if (t.length <= 3) return t;
  const s = t.replace(SUFFIX, "");
  return s.length >= 3 ? s : t;
}

/** Two tokens are the same word: short ones exactly, longer ones by stem. */
export function sameWord(a, b) {
  if (a.length <= 3 || b.length <= 3) return a === b;
  const x = stem(a), y = stem(b);
  if (x === y) return true;
  const [s, l] = x.length <= y.length ? [x, y] : [y, x];
  return s.length >= 4 && l.startsWith(s) && l.length - s.length <= 2;
}

/** Every word of the key appears in the text, in any order. */
export function matches(key, text) {
  const k = tokens(key), t = tokens(text);
  return k.length > 0 && k.every((kw) => t.some((tw) => sameWord(kw, tw)));
}
```

Plugins cannot import npm packages, so a real stemmer is not an option: the light suffix strip above is the tool. For many texts, tokenize the text once and reuse the tokens.

## Rules
- Do not fold `і→и`, `є→е`, `ї→і` or `ґ→г` in stored data. They are different letters, and `і↔и` merges Ukrainian and Russian words. Folding `ґ→г` on search input alone is fine: people type `г`.
- A key that is only stop words (`що`, `це`) matches nothing. Reject it when saved, with a message; do not match it silently.
- Keys of 3 characters or less match whole tokens only (`кіт`, `сон`, `ліс`).
- To rank recall results, count distinct key words matched and weight rare words (names) higher. Do not rank by substring hit count.

## Known limits: fix with aliases, not code
Consonant and vowel alternations defeat a suffix strip: `друг/друзі`, `ніч/ночі`, `Київ/Києві`, `замок/замком`, `рука/руці`. When a key must catch those forms, store the extra forms as aliases on the key (e.g. `keys: ["Київ", "Києві", "Києва"]`). Do not loosen `sameWord`: looser prefixes bring back `кіт → кітель`.

## Verify before calling it done
You cannot run JS in the shell (no node). Add a temporary self-test that runs inside the plugin and writes `data/_debug/match-test.json`, or logs to an open page through `app_console`. Every row must pass:

| key | text | expect |
|---|---|---|
| пам'ять | Його пам’ять згасала | true |
| Олена | Він говорив з Оленою | true |
| Червона вежа | біля Червоної вежі | true |
| Мирослав | Мирославові сказали | true |
| рука | его руки дрожали | true |
| ёлка | елка стояла | true |
| кіт | Сірий кітель висів | false |
| сон | сонце сідало | false |
| що | що це було | false |

Remove the self-test and its file after the run, then commit with the git tool.
