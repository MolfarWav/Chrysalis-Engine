// No DOM here: test/model-name.test.ts imports this file under the engine's
// tsconfig, which has no browser types.

/** Display name for a model label or qualified ref: the segment after the
 *  last slash, without the "Vendor: " prefix aggregator catalogs put in front
 *  of the name. A slash inside brackets is part of the name — NanoGPT labels
 *  carry dates like "(01/2025)". Selection keys stay full — display only. */
export function shortModelName(id: string): string {
  let i = -1;
  let depth = 0;
  for (let k = 0; k < id.length; k++) {
    const c = id[k];
    if (c === "(" || c === "[") depth++;
    else if ((c === ")" || c === "]") && depth > 0) depth--;
    else if (c === "/" && depth === 0) i = k;
  }
  const name = i === -1 ? id : id.slice(i + 1);
  return name.replace(/^[^:]{1,40}:\s+(?=\S)/, "");
}
