/**
 * The classic spinning ASCII torus, as a small live picture for the places
 * the real render can't be: the phone card and the tour's cards.
 */

/** One frame of a torus rotated by `a` (about x) and `b` (about z), `cols` × `rows` characters. */
export function torusFrame(cols: number, rows: number, a: number, b: number, ramp: string): string {
  const chars = [...ramp];
  const out = new Array<string>(cols * rows).fill(chars[0] ?? ' ');
  const depth = new Float32Array(cols * rows);
  const cA = Math.cos(a);
  const sA = Math.sin(a);
  const cB = Math.cos(b);
  const sB = Math.sin(b);
  const tube = 1;
  const ring = 2;
  const distance = 5;
  // Fill the width; characters are about twice as tall as they are wide.
  const scale = (Math.min(cols, rows * 2) * distance * 0.42) / (tube + ring);
  const levels = chars.length - 1;

  for (let theta = 0; theta < Math.PI * 2; theta += 0.07) {
    const ct = Math.cos(theta);
    const st = Math.sin(theta);
    for (let phi = 0; phi < Math.PI * 2; phi += 0.02) {
      const cp = Math.cos(phi);
      const sp = Math.sin(phi);
      const cx = ring + tube * ct;
      const cy = tube * st;
      const x = cx * (cB * cp + sA * sB * sp) - cy * cA * sB;
      const y = cx * (sB * cp - sA * cB * sp) + cy * cA * cB;
      const z = distance + cA * cx * sp + cy * sA;
      const ooz = 1 / z;
      const col = Math.floor(cols / 2 + scale * ooz * x);
      const row = Math.floor(rows / 2 - scale * ooz * y * 0.5);
      if (col < 0 || col >= cols || row < 0 || row >= rows) continue;
      const i = col + row * cols;
      if (ooz <= depth[i]) continue;
      depth[i] = ooz;
      const light = cp * ct * sB - cA * ct * sp - sA * st + cB * (cA * st - ct * sA * sp);
      const level = light > 0 ? 1 + Math.min(levels - 1, Math.floor((light / Math.SQRT2) * levels)) : 1;
      out[i] = chars[Math.min(levels, level)];
    }
  }

  let text = '';
  for (let r = 0; r < rows; r++) text += out.slice(r * cols, (r + 1) * cols).join('') + (r < rows - 1 ? '\n' : '');
  return text;
}

/** Spins a torus in `pre` until the returned function is called. Skips frames while it isn't visible. */
export function spinTorus(pre: HTMLElement, cols: number, rows: number, ramp = ' .,-~:;=!*#$@'): () => void {
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let a = 0.9;
  let b = 0.3;
  let last = 0;
  let raf = 0;
  const draw = (time: number) => {
    raf = requestAnimationFrame(draw);
    if (time - last < 60 || !pre.isConnected || pre.offsetParent === null) return;
    const dt = last ? Math.min(0.1, (time - last) / 1000) : 0;
    last = time;
    a += dt * 0.9;
    b += dt * 0.45;
    pre.textContent = torusFrame(cols, rows, a, b, ramp);
  };
  pre.textContent = torusFrame(cols, rows, a, b, ramp);
  if (!still) raf = requestAnimationFrame(draw);
  return () => cancelAnimationFrame(raf);
}
