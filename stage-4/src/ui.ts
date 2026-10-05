import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Ctx, Reply } from './http';

const DIST_DIR = __dirname;
const ASSETS_DIR = path.join(__dirname, '..', 'assets');

/** Screens that serve the page for every client; the rest share their path with the JSON API. */
const PAGES_FOR_ALL = new Set(['/', '/split', '/signup', '/login']);
const PAGES_FOR_BROWSERS = new Set(['/requests', '/authorizations']);

const SHELL = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<title>Pocketful</title>
<link rel="stylesheet" href="/assets/app.css">
<script type="module" src="/assets/main.js"></script>
</head>
<body>
<a class="skip-link" href="#main">Skip to content</a>
<div id="app"><p class="boot" role="status">Loading Pocketful…</p></div>
<noscript><p class="boot">Pocketful needs JavaScript to run.</p></noscript>
</body>
</html>
`;

const ASSET_FILES: Record<string, { file: string; type: string }> = {
  '/assets/app.css': { file: path.join(ASSETS_DIR, 'app.css'), type: 'text/css; charset=utf-8' },
};

function clientScript(name: string): { file: string; type: string } {
  return { file: path.join(DIST_DIR, 'public', name), type: 'text/javascript; charset=utf-8' };
}

function assetFor(urlPath: string): { file: string; type: string } | undefined {
  const fixed = ASSET_FILES[urlPath];
  if (fixed) return fixed;
  const script = /^\/assets\/((?:[a-z0-9-]+\/)?[a-z0-9-]+\.js)$/.exec(urlPath);
  return script ? clientScript(script[1]) : undefined;
}

function wantsHtml(ctx: Ctx): boolean {
  const accept = ctx.headers.accept;
  return typeof accept === 'string' && accept.toLowerCase().includes('text/html');
}

export function uiReply(ctx: Ctx): Reply | undefined {
  if (ctx.method !== 'GET') return undefined;
  const urlPath = ctx.path.length > 1 ? ctx.path.replace(/\/+$/, '') : ctx.path;
  if (PAGES_FOR_ALL.has(urlPath) || (PAGES_FOR_BROWSERS.has(urlPath) && wantsHtml(ctx))) {
    return { status: 200, raw: SHELL, contentType: 'text/html; charset=utf-8' };
  }
  const asset = assetFor(urlPath);
  if (!asset) return undefined;
  try {
    return { status: 200, raw: readFileSync(asset.file, 'utf8'), contentType: asset.type };
  } catch {
    return undefined;
  }
}
