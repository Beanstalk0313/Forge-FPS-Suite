/**
 * ui.css is plain CSS the author edits by hand, so a style template has to
 * replace exactly its own rule. Braces inside template CSS (media queries,
 * nested rules) make a regular expression unsafe here: this scans for the
 * matching closing brace instead.
 */

/** Remove the rule that follows `marker`, if the stylesheet has one. */
export function removeRule(css, marker) {
  const at = css.indexOf(marker);
  if (at < 0) return css;
  const start = css.indexOf('{', at);
  // A marker without a body is malformed input; drop the comment and keep going.
  if (start < 0) return css.slice(0, at) + css.slice(at + marker.length);
  let depth = 0;
  for (let i = start; i < css.length; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}' && --depth === 0) return (css.slice(0, at) + css.slice(i + 1)).replace(/\n{2,}/g, '\n');
  }
  return css.slice(0, at); // unterminated rule: everything after the marker is unusable
}

/** Insert or replace one marked rule, leaving the rest of the sheet untouched. */
export function upsertRule(css, marker, selector, body) {
  return `${removeRule(String(css || ''), marker).trim()}\n${marker}${selector}{${body}}\n`.trim() + '\n';
}
