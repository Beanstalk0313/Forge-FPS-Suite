/**
 * Plain structural checks for authored UI CSS. Pure functions with no DOM:
 * the CSS code editor runs them on every keystroke, and unit tests cover the
 * rules. Authored CSS never executes code, so the checks also refuse script
 * URLs and imports rather than trusting the runtime's own refusal.
 */

/** At-rules the shadow DOM renderer understands; anything else is a typo. */
const KNOWN_AT_RULES = new Set(['font-face', 'keyframes', '-webkit-keyframes', 'media', 'supports']);

/** Replace comments and string literals so structure checks see only code. */
function stripNoise(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"/g, '');
}

/**
 * Validate authored UI CSS. Returns a list of problems, most severe first:
 * { level: 'error' | 'warn', message }. An empty list means the stylesheet is
 * structurally sound and safe; stylistic advice is not this tool's job.
 */
export function validateUICSS(text = '', { assets = [] } = {}) {
  const source = String(text ?? '');
  const problems = [];
  if (/@import\b/i.test(source)) problems.push({ level: 'error', message: '@import is not supported: bundle the styles in the project CSS.' });
  if (/javascript\s*:/i.test(source)) problems.push({ level: 'error', message: 'Script URLs are not allowed in UI CSS.' });
  if (/expression\s*\(/i.test(source)) problems.push({ level: 'error', message: 'expression() is not allowed: it is script in disguise.' });
  if (/\/\*/.test(stripNoise(source))) problems.push({ level: 'error', message: 'A comment is never closed: every /* needs its */.' });

  const clean = stripNoise(source);
  let depth = 0, parens = 0, brokenBrace = false, brokenParen = false;
  for (const ch of clean) {
    if (ch === '{') depth += 1;
    else if (ch === '}') { depth -= 1; if (depth < 0) brokenBrace = true; }
    else if (ch === '(') parens += 1;
    else if (ch === ')') { parens -= 1; if (parens < 0) brokenParen = true; }
  }
  if (brokenBrace || depth > 0) problems.push({ level: 'error', message: depth > 0 ? 'A { block is never closed: count your braces.' : 'A } appears without a matching {.' });
  if (brokenParen || parens > 0) problems.push({ level: 'error', message: 'Round brackets are unbalanced.' });

  for (const match of clean.matchAll(/@([a-zA-Z-]+)/g)) {
    if (!KNOWN_AT_RULES.has(match[1].toLowerCase())) problems.push({ level: 'warn', message: `@${match[1]} is not a known at-rule here: expected @font-face, @keyframes, @media or @supports.` });
  }
  for (const match of source.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^\s)]+))\s*\)/gi)) {
    const target = match[1] ?? match[2] ?? match[3] ?? '';
    if (/^(data:|https?:)/i.test(target) || target.startsWith('#')) continue;
    const tail = target.replace(/^\.?\//, '').split('?')[0].toLowerCase();
    const known = assets.some(asset => asset.toLowerCase().endsWith(tail)) || tail === '';
    if (!known) problems.push({ level: 'warn', message: `url(${target}) is not a project asset or inline data: add the file to the project assets.` });
  }
  return problems;
}
