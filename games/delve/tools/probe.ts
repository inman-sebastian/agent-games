// probe.ts — run a page in headless Chrome, drive it, and print what you asked for AS TEXT.
//
// The rung between `shot.sh` (pixels) and Playwright/MCP (a whole browser session in the
// conversation). It exists because that gap is what made "Playwright is a last resort" unenforceable:
// the moment a question needed a NUMBER from the live game — frame time, net status, where the player
// is after holding a key, a lab's PASS/FAIL — the only tool that returned text was Playwright.
//
// Talks to Chrome over the DevTools protocol directly (no MCP, no Playwright dependency). Input goes
// through `Input.dispatch*Event`, so it is TRUSTED: synthetic `dispatchEvent(new KeyboardEvent(...))`
// does not move the player, and a probe built on it silently tests nothing.
//
//   pnpm probe index.html --play --wait 3000 --overlay
//   pnpm probe index.html --play --do "key:ArrowRight:1200 wait:400" --overlay
//   pnpm probe labs/patch-lab.html --wait 5000 --eval "document.title"
//   pnpm probe index.html --size 3400x1900 --play --wait 4000 --grep "fps|phase|light field"
//
// Needs `pnpm dev` running (PROBE_BASE, default http://localhost:5173). Prints JSON on stdout.
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';

const USAGE = `probe <page> [--play] [--debug] [--size WxH] [--wait ms] [--do "steps"] [--overlay] [--grep regex] [--eval js] [--shot out.png]

  <page>       path under the Vite root, e.g. index.html, labs/patch-lab.html
  --play       skip the title screen (adds ?play=1)
  --debug      open the debug panel (adds ?debug; implied by --overlay/--grep)
  --size WxH   viewport in CSS px (default 1280x800)
  --wait ms    settle time after load, before any steps (default 2500)
  --do steps   space-separated: key:<code>:<holdMs>  tap:<code>  click:<css selector>
               mouse:<x>,<y>:<holdMs> (CSS px in the viewport)  wait:<ms>
               aim:<dc>,<dr>:<holdMs>  press the pointer on the cell <dc>,<dr> from the player's
               cell, e.g. aim:0,2:300 mines under the feet (needs the debug panel; implies --debug)
  --overlay    print the debug overlay's text lines
  --grep re    print only overlay lines matching the regex
  --eval js    an expression evaluated in the page; its JSON value is printed
  --shot file  write a PNG of the viewport after everything else — the capture route for WebGPU
               pages, which shot.sh can't take (it launches Chrome with --disable-gpu)`;

interface Options {
  page: string;
  play: boolean;
  debug: boolean;
  width: number;
  height: number;
  wait: number;
  steps: string[];
  overlay: boolean;
  grep: RegExp | null;
  evals: string[];
  shot: string | null;
}

function parseArgs(argv: string[]): Options {
  if (argv.length === 0 || argv.includes('--help')) {
    console.log(USAGE);
    process.exit(argv.length === 0 ? 1 : 0);
  }
  const options: Options = {
    page: argv[0],
    play: false,
    debug: false,
    width: 1280,
    height: 800,
    wait: 2500,
    steps: [],
    overlay: false,
    grep: null,
    evals: [],
    shot: null,
  };
  for (let i = 1; i < argv.length; i++) {
    const flag = argv[i];
    const value = (): string => {
      const next = argv[++i];
      if (next === undefined) throw new Error(`${flag} needs a value`);
      return next;
    };
    if (flag === '--play') options.play = true;
    else if (flag === '--debug') options.debug = true;
    else if (flag === '--overlay') options.overlay = true;
    else if (flag === '--grep') options.grep = new RegExp(value());
    else if (flag === '--wait') options.wait = Number(value());
    else if (flag === '--do') options.steps.push(...value().trim().split(/\s+/));
    else if (flag === '--eval') options.evals.push(value());
    else if (flag === '--shot') options.shot = value();
    else if (flag === '--size') {
      const [w, h] = value().split('x').map(Number);
      options.width = w;
      options.height = h;
    } else throw new Error(`unknown flag ${flag}\n\n${USAGE}`);
  }
  if (options.overlay || options.grep || options.steps.some((step) => step.startsWith('aim:')))
    options.debug = true;
  return options;
}

function chromePath(): string {
  const candidates = [
    process.env.CHROME,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
  ].filter((path): path is string => !!path);
  const found = candidates.find((path) => existsSync(path));
  if (!found) throw new Error('no Chrome found — set CHROME to the browser binary');
  return found;
}

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** A minimal DevTools-protocol session: send a method, await its result. */
class Session {
  private nextId = 1;
  private readonly waiting = new Map<
    number,
    (result: { result?: unknown; error?: unknown }) => void
  >();
  private constructor(private readonly socket: WebSocket) {
    socket.on('message', (raw) => {
      const message = JSON.parse(raw.toString()) as {
        id?: number;
        result?: unknown;
        error?: unknown;
      };
      if (message.id !== undefined) this.waiting.get(message.id)?.(message);
    });
  }
  static open(url: string): Promise<Session> {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(url);
      socket.on('open', () => resolve(new Session(socket)));
      socket.on('error', reject);
    });
  }
  send<T = unknown>(method: string, params: object = {}): Promise<T> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.waiting.set(id, (message) => {
        this.waiting.delete(id);
        if (message.error) reject(new Error(`${method}: ${JSON.stringify(message.error)}`));
        else resolve(message.result as T);
      });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }
  close(): void {
    this.socket.close();
  }
}

async function evaluate(session: Session, expression: string): Promise<unknown> {
  const reply = await session.send<{
    result: { value?: unknown };
    exceptionDetails?: { text: string; exception?: { description?: string } };
  }>('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (reply.exceptionDetails) {
    throw new Error(
      `page threw: ${reply.exceptionDetails.exception?.description ?? reply.exceptionDetails.text}`,
    );
  }
  return reply.result.value;
}

/** DOM `KeyboardEvent.code` → the virtual key code Chrome wants alongside it. */
function keyCodeOf(code: string): number {
  const named: Record<string, number> = {
    ArrowLeft: 37,
    ArrowUp: 38,
    ArrowRight: 39,
    ArrowDown: 40,
    Space: 32,
    Escape: 27,
    Enter: 13,
    F3: 114,
  };
  if (named[code] !== undefined) return named[code];
  const letter = /^Key([A-Z])$/.exec(code);
  if (letter) return letter[1].charCodeAt(0);
  const digit = /^Digit(\d)$/.exec(code);
  if (digit) return 48 + Number(digit[1]);
  throw new Error(`key: unsupported code ${code}`);
}

async function key(session: Session, code: string, type: 'keyDown' | 'keyUp'): Promise<void> {
  const keyName = code.startsWith('Key')
    ? code.slice(3).toLowerCase()
    : code === 'Space'
      ? ' '
      : code;
  await session.send('Input.dispatchKeyEvent', {
    type,
    code,
    key: keyName,
    windowsVirtualKeyCode: keyCodeOf(code),
  });
}

async function runStep(session: Session, step: string): Promise<void> {
  const [kind, ...rest] = step.split(':');
  if (kind === 'wait') return delay(Number(rest[0]));
  if (kind === 'tap') {
    await key(session, rest[0], 'keyDown');
    await key(session, rest[0], 'keyUp');
    return;
  }
  if (kind === 'key') {
    await key(session, rest[0], 'keyDown');
    await delay(Number(rest[1] ?? 100));
    await key(session, rest[0], 'keyUp');
    return;
  }
  if (kind === 'click') {
    const selector = rest.join(':');
    const box = (await evaluate(
      session,
      `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return null;
        const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`,
    )) as { x: number; y: number } | null;
    if (!box) throw new Error(`click: no element matches ${selector}`);
    return mouse(session, box.x, box.y, 60);
  }
  if (kind === 'aim') {
    // World cell → CSS pixel, from the debug panel's pos/cam lines and the canvas's on-screen box.
    // Worked out by hand four times in one session before this step existed.
    const [dc, dr] = rest[0].split(',').map(Number);
    const point = (await evaluate(
      session,
      `(() => {
        const text = document.getElementById('dbgtext')?.textContent ?? '';
        const pos = /pos\\s+(-?[\\d.]+),(-?[\\d.]+)/.exec(text);
        const cam = /cam\\s+(-?[\\d.]+),(-?[\\d.]+)/.exec(text);
        const canvas = document.querySelector('canvas');
        if (!pos || !cam || !canvas) return null;
        const T = 8, box = canvas.getBoundingClientRect();
        const column = Math.floor(+pos[1]) + ${dc}, row = Math.floor(+pos[2]) + ${dr};
        return {
          x: box.left + ((column * T + T / 2 - +cam[1]) / canvas.width) * box.width,
          y: box.top + ((row * T + T / 2 - +cam[2]) / canvas.height) * box.height,
        };
      })()`,
    )) as { x: number; y: number } | null;
    if (!point) throw new Error('aim: needs the game with its debug panel (pos/cam lines)');
    return mouse(session, point.x, point.y, Number(rest[1] ?? 300));
  }
  if (kind === 'mouse') {
    const [x, y] = rest[0].split(',').map(Number);
    return mouse(session, x, y, Number(rest[1] ?? 60));
  }
  throw new Error(`unknown step "${step}"`);
}

async function mouse(session: Session, x: number, y: number, holdMs: number): Promise<void> {
  const base = { x, y, button: 'left', clickCount: 1 };
  await session.send('Input.dispatchMouseEvent', { ...base, type: 'mouseMoved' });
  await session.send('Input.dispatchMouseEvent', { ...base, type: 'mousePressed' });
  await delay(holdMs);
  await session.send('Input.dispatchMouseEvent', { ...base, type: 'mouseReleased' });
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const base = process.env.PROBE_BASE ?? 'http://localhost:5173';
  const query = [options.play ? 'play=1' : '', options.debug ? 'debug' : '']
    .filter(Boolean)
    .join('&');
  const url = `${base}/${options.page}${query ? (options.page.includes('?') ? '&' : '?') + query : ''}`;

  try {
    await fetch(base);
  } catch {
    throw new Error(`no dev server at ${base} — start \`pnpm dev\` (or set PROBE_BASE)`);
  }

  const profile = mkdtempSync(join(tmpdir(), 'delve-probe-'));
  const chrome = spawn(
    chromePath(),
    [
      '--headless=new',
      '--remote-debugging-port=0',
      `--user-data-dir=${profile}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--autoplay-policy=no-user-gesture-required',
      `--window-size=${options.width},${options.height}`,
      'about:blank',
    ],
    { stdio: ['ignore', 'ignore', 'pipe'] },
  );
  const cleanup = (): void => {
    chrome.kill('SIGKILL');
    rmSync(profile, { recursive: true, force: true });
  };

  try {
    const browserUrl = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('Chrome did not start (set CHROME to its path)')),
        15000,
      );
      let buffered = '';
      chrome.stderr!.on('data', (chunk: Buffer) => {
        buffered += chunk.toString();
        const match = /DevTools listening on (ws:\/\/\S+)/.exec(buffered);
        if (match) {
          clearTimeout(timer);
          resolve(match[1]);
        }
      });
      chrome.on('exit', () => reject(new Error('Chrome exited before it was ready')));
    });
    const port = new URL(browserUrl).port;
    const target = (await (
      await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })
    ).json()) as {
      webSocketDebuggerUrl: string;
    };
    const session = await Session.open(target.webSocketDebuggerUrl);
    await session.send('Emulation.setDeviceMetricsOverride', {
      width: options.width,
      height: options.height,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await session.send('Runtime.enable');
    const errors: string[] = [];
    await session.send('Page.enable');
    await session.send('Page.navigate', { url });
    for (let waited = 0; waited < 15000; waited += 100) {
      if ((await evaluate(session, 'document.readyState')) === 'complete') break;
      await delay(100);
    }
    // Page errors are worth knowing about even when nobody asked for them.
    await evaluate(
      session,
      `window.__probeErrors = []; addEventListener('error', (e) => window.__probeErrors.push(String(e.message)));`,
    );
    await delay(options.wait);
    for (const step of options.steps) await runStep(session, step);

    const output: Record<string, unknown> = { url };
    if (options.overlay || options.grep) {
      const text = (await evaluate(
        session,
        `document.getElementById('dbgtext')?.textContent ?? null`,
      )) as string | null;
      if (text === null) throw new Error('no debug overlay on this page (#dbgtext)');
      const lines = text.split('\n');
      output.overlay = options.grep ? lines.filter((line) => options.grep!.test(line)) : lines;
    }
    for (const [index, expression] of options.evals.entries()) {
      output[options.evals.length === 1 ? 'eval' : `eval${index + 1}`] = await evaluate(
        session,
        expression,
      );
    }
    if (options.shot) {
      const { data } = (await session.send('Page.captureScreenshot', { format: 'png' })) as {
        data: string;
      };
      writeFileSync(options.shot, Buffer.from(data, 'base64'));
      output.shot = options.shot;
    }
    errors.push(...((await evaluate(session, 'window.__probeErrors ?? []')) as string[]));
    if (errors.length) output.pageErrors = errors;
    console.log(JSON.stringify(output, null, 2));
    session.close();
  } finally {
    cleanup();
  }
}

main().catch((error: Error) => {
  console.error(`probe: ${error.message}`);
  process.exit(1);
});
