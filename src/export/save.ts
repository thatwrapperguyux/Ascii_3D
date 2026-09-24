/**
 * Saving files. In a normal browser tab this is a plain download. Inside the
 * claude.ai Artifact viewer, page-initiated downloads are blocked, so the
 * platform's `downloads` capability asks the viewer to confirm the save.
 */

let downloads: Promise<ClaudeDownloads | null> | null = null;

/** Starts resolving the capability early; it arrives asynchronously after page load. */
export function prepareSaving(): void {
  if (__ARTIFACT__ && !downloads) {
    downloads = window.claude?.use ? window.claude.use('downloads').catch(() => null) : Promise.resolve(null);
  }
}

export type SaveOutcome = 'saved' | 'cancelled';

const MIME: Record<string, string> = {
  png: 'image/png',
  svg: 'image/svg+xml',
  txt: 'text/plain;charset=utf-8',
  json: 'application/json',
  webm: 'video/webm',
  mp4: 'video/mp4',
};

export async function saveFile(filename: string, data: Blob | string): Promise<SaveOutcome> {
  if (__ARTIFACT__) {
    prepareSaving();
    const capability = await downloads;
    if (!capability) throw new Error('Saving files is not available in this view.');
    try {
      await capability.save({ filename, data });
      return 'saved';
    } catch (error) {
      const code = (error as { code?: string })?.code;
      if (code === 'declined') return 'cancelled';
      if (code === 'rate_limited') throw new Error('Another save is waiting for confirmation. Finish that one first.');
      throw new Error((error as { message?: string })?.message || 'The file could not be saved.');
    }
  }

  const extension = filename.split('.').pop() ?? '';
  const blob = typeof data === 'string' ? new Blob([data], { type: MIME[extension] ?? 'application/octet-stream' }) : data;
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.rel = 'noopener';
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return 'saved';
}

/** Copies text; falls back to a hidden textarea when the async clipboard API is refused. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.append(area);
    area.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    area.remove();
    return ok;
  }
}

export function timestamp(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

export function slug(name: string): string {
  return (
    name
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^\w\s-]/g, '')
      .trim()
      .replace(/[\s_-]+/g, '-')
      .slice(0, 40) || 'model'
  );
}
