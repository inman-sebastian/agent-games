// soft-canvas.ts — TEST-ONLY. A tiny deterministic software canvas: just the 2D calls the rock
// renderer makes, so the chunk invariants run in `pnpm test` (Node/happy-dom have no 2D canvas).
//
// It is not a faithful browser canvas and doesn't need to be. The gate compares a chunk with the same
// chunk baked with more context THROUGH THIS SAME implementation, so what it proves is that the bake
// was given enough context — the property seams depend on — not that the blending matches Chrome.
// (labs/patch-lab runs the identical check through Chrome's canvas, and agrees.) Supported: hex/rgb
// fills, `globalAlpha`, `fillRect`, `clearRect`, `createImageData`/`getImageData`/`putImageData`, and
// `drawImage` at 1:1 with source-over. An unsupported colour or `drawImage` form throws, and a method
// that doesn't exist here fails as undefined, so a renderer change that starts relying on more can't
// pass by accident. (A property it doesn't model, like a composite mode, would be silently ignored.)

export class SoftCanvas {
  readonly data: Uint8ClampedArray;
  private readonly context: SoftContext2D;

  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    this.data = new Uint8ClampedArray(width * height * 4);
    this.context = new SoftContext2D(this);
  }

  getContext(kind: string): SoftContext2D {
    if (kind !== '2d') throw new Error(`soft-canvas: no ${kind} context`);
    return this.context;
  }
}

function parseColor(style: string): [number, number, number, number] {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(style);
  if (hex) {
    const h = hex[1].length === 3 ? [...hex[1]].map((c) => c + c).join('') : hex[1];
    return [
      parseInt(h.slice(0, 2), 16),
      parseInt(h.slice(2, 4), 16),
      parseInt(h.slice(4, 6), 16),
      255,
    ];
  }
  const rgb = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/.exec(
    style,
  );
  if (rgb) return [+rgb[1], +rgb[2], +rgb[3], rgb[4] === undefined ? 255 : +rgb[4] * 255];
  throw new Error(`soft-canvas: unsupported fillStyle ${style}`);
}

export class SoftContext2D {
  fillStyle = '#000000';
  globalAlpha = 1;
  imageSmoothingEnabled = true;

  constructor(readonly canvas: SoftCanvas) {}

  /** Source-over one pixel. Integer maths so a render is bit-for-bit repeatable. */
  private blend(x: number, y: number, r: number, g: number, b: number, a: number): void {
    if (x < 0 || y < 0 || x >= this.canvas.width || y >= this.canvas.height || a <= 0) return;
    const d = this.canvas.data;
    const i = (y * this.canvas.width + x) * 4;
    if (a >= 255) {
      d[i] = r;
      d[i + 1] = g;
      d[i + 2] = b;
      d[i + 3] = 255;
      return;
    }
    const inv = 255 - a;
    d[i] = (r * a + d[i] * inv) / 255;
    d[i + 1] = (g * a + d[i + 1] * inv) / 255;
    d[i + 2] = (b * a + d[i + 2] * inv) / 255;
    d[i + 3] = a + (d[i + 3] * inv) / 255;
  }

  fillRect(x: number, y: number, w: number, h: number): void {
    const [r, g, b, a] = parseColor(this.fillStyle);
    const alpha = Math.round(a * this.globalAlpha);
    const x0 = Math.round(x);
    const y0 = Math.round(y);
    for (let py = y0; py < y0 + Math.round(h); py++)
      for (let px = x0; px < x0 + Math.round(w); px++) this.blend(px, py, r, g, b, alpha);
  }

  clearRect(x: number, y: number, w: number, h: number): void {
    const { width, height, data } = this.canvas;
    for (let py = Math.max(0, y); py < Math.min(height, y + h); py++)
      data.fill(0, (py * width + Math.max(0, x)) * 4, (py * width + Math.min(width, x + w)) * 4);
  }

  createImageData(width: number, height: number): ImageData {
    return { width, height, data: new Uint8ClampedArray(width * height * 4) } as ImageData;
  }

  getImageData(x: number, y: number, w: number, h: number): ImageData {
    const image = this.createImageData(w, h);
    const { width, data } = this.canvas;
    for (let py = 0; py < h; py++) {
      const from = ((y + py) * width + x) * 4;
      image.data.set(data.subarray(from, from + w * 4), py * w * 4);
    }
    return image;
  }

  putImageData(image: ImageData, dx: number, dy: number): void {
    const { width, data } = this.canvas;
    for (let py = 0; py < image.height; py++) {
      const row = image.data.subarray(py * image.width * 4, (py + 1) * image.width * 4);
      data.set(row, ((dy + py) * width + dx) * 4);
    }
  }

  drawImage(source: SoftCanvas, ...args: number[]): void {
    let sx = 0;
    let sy = 0;
    let sw = source.width;
    let sh = source.height;
    let dx: number;
    let dy: number;
    if (args.length === 2) [dx, dy] = args;
    else if (args.length === 8) {
      let dw: number;
      let dh: number;
      [sx, sy, sw, sh, dx, dy, dw, dh] = args;
      if (dw !== sw || dh !== sh) throw new Error('soft-canvas: scaled drawImage is not supported');
    } else throw new Error(`soft-canvas: drawImage with ${args.length} numbers is not supported`);
    const s = source.data;
    for (let py = 0; py < sh; py++) {
      for (let px = 0; px < sw; px++) {
        const i = ((sy + py) * source.width + (sx + px)) * 4;
        this.blend(dx + px, dy + py, s[i], s[i + 1], s[i + 2], s[i + 3]);
      }
    }
  }
}
