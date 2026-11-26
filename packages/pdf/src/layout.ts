import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage, type RGB } from 'pdf-lib';

// A small flowing-layout helper over pdf-lib: US Letter, one column, automatic page breaks.

export const PAGE = { width: 612, height: 792, margin: 48 };

export function hexColor(hex: string | null | undefined, fallback = '#1f4fd1'): RGB {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex ?? '') ?? /^#?([0-9a-f]{6})$/i.exec(fallback)!;
  const n = parseInt(m[1]!, 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

export const GRAY = rgb(0.42, 0.45, 0.5);
export const INK = rgb(0.1, 0.11, 0.13);
export const RULE = rgb(0.86, 0.87, 0.89);

/** pdf-lib's standard fonts only encode WinAnsi; replace anything else so drawing never throws. */
export function safe(text: string): string {
  return text
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/→/g, '->')
    .replace(/\u00a0/g, ' ')
    .replace(/[^\x20-\x7e\xa0-\xff]/g, '?');
}

export class Flow {
  page!: PDFPage;
  y = 0;
  private constructor(
    readonly doc: PDFDocument,
    readonly font: PDFFont,
    readonly bold: PDFFont,
    private readonly footer: string,
  ) {}

  static async create(footer: string) {
    const doc = await PDFDocument.create();
    const flow = new Flow(
      doc,
      await doc.embedFont(StandardFonts.Helvetica),
      await doc.embedFont(StandardFonts.HelveticaBold),
      footer,
    );
    flow.newPage();
    return flow;
  }

  newPage() {
    this.page = this.doc.addPage([PAGE.width, PAGE.height]);
    this.y = PAGE.height - PAGE.margin;
  }

  /** Starts a new page when fewer than `h` points are left. */
  need(h: number) {
    if (this.y - h < PAGE.margin + 24) this.newPage();
  }

  width(text: string, size: number, bold = false) {
    return (bold ? this.bold : this.font).widthOfTextAtSize(safe(text), size);
  }

  text(
    text: string,
    x: number,
    opts: { size?: number; bold?: boolean; color?: RGB; align?: 'left' | 'right'; y?: number } = {},
  ) {
    const size = opts.size ?? 9;
    const t = safe(text);
    const w = this.width(t, size, opts.bold);
    this.page.drawText(t, {
      x: opts.align === 'right' ? x - w : x,
      y: opts.y ?? this.y,
      size,
      font: opts.bold ? this.bold : this.font,
      color: opts.color ?? INK,
    });
  }

  /** Word-wraps to `maxWidth`; returns the lines. */
  wrap(text: string, size: number, maxWidth: number, bold = false): string[] {
    const out: string[] = [];
    for (const para of safe(text).split('\n')) {
      let line = '';
      for (const word of para.split(' ')) {
        const next = line ? `${line} ${word}` : word;
        if (this.width(next, size, bold) > maxWidth && line) {
          out.push(line);
          line = word;
        } else line = next;
      }
      out.push(line);
    }
    return out;
  }

  paragraph(
    text: string,
    x: number,
    maxWidth: number,
    opts: { size?: number; color?: RGB; bold?: boolean } = {},
  ) {
    const size = opts.size ?? 9;
    for (const line of this.wrap(text, size, maxWidth, opts.bold)) {
      this.need(size + 3);
      this.text(line, x, { ...opts, size });
      this.y -= size + 3;
    }
  }

  rule(color = RULE) {
    this.page.drawLine({
      start: { x: PAGE.margin, y: this.y },
      end: { x: PAGE.width - PAGE.margin, y: this.y },
      thickness: 0.6,
      color,
    });
  }

  band(height: number, color: RGB) {
    this.page.drawRectangle({ x: 0, y: PAGE.height - height, width: PAGE.width, height, color });
  }

  async save(): Promise<Uint8Array> {
    const pages = this.doc.getPages();
    pages.forEach((p, i) => {
      const label = safe(`${this.footer}  -  Page ${i + 1} of ${pages.length}`);
      p.drawText(label, {
        x: PAGE.margin,
        y: PAGE.margin - 20,
        size: 7.5,
        font: this.font,
        color: GRAY,
      });
    });
    this.doc.setProducer('ProtestOS');
    this.doc.setCreationDate(new Date(0));
    this.doc.setModificationDate(new Date(0));
    return this.doc.save();
  }
}

/** "1234.5" → "$1,234.50"; negatives as "-$25.00". */
export function usd(v: string | number): string {
  const n = Number(v);
  const s = Math.abs(n).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return n < 0 ? `-$${s}` : `$${s}`;
}

/** 2026-09-15 → Sep 15, 2026. */
export function day(iso: string | null | undefined): string {
  if (!iso) return '-';
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}
