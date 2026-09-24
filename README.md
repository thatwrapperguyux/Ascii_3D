# ASCII 3D Studio

Turn any 3D model into live, animated ASCII art in the browser. Upload a `.glb`
(or `.gltf`, `.fbx`, `.obj`, `.stl`), tune the glyphs, color, lighting and
effects, then export a PNG, a video, an SVG or plain text, or embed it on your
website.

The render fills the window and two glass panels float over it. The left
panel covers what goes in and what comes out: **Your model**, **Look**,
**Download** and **Embed**. The right panel covers how it looks: **Glyphs**,
**Tone**, **Colour**, **Light**, **Motion** and **Effects**. The model is
framed in the clear space between the panels. The bar above the render switches
between light and dark mode and holds the full-screen, hide-panels and sound
buttons. A short tour runs on the first visit.

The look is inspired by the ASCII "scanning" visuals studios like Ozero have
built for brands such as Finic: raw symbols turned into data-driven, living
graphics. This is an original implementation built on [three.js](https://threejs.org).

## Features

- **Models:** GLB/glTF (including Draco, Meshopt and KTX2 compression), multi-file
  glTF (drop the `.gltf` with its `.bin` and textures), FBX, OBJ (+MTL) and STL.
  Drag and drop anywhere, use the upload button, or load from a URL. Animated
  models play their clips, and you can switch clips and speed.
- **Samples:** an animated fox, an organic "creature", knot, donut, crystal and cube.
- **Glyphs:** 7 character sets (standard, 70-level detailed, blocks, braille,
  binary, code, signal) or your own; cell size, character width, glyph scale,
  font (JetBrains Mono, IBM Plex Mono, Martian Mono, Space Mono, Courier Prime,
  VT323) and weight.
- **Tone:** exposure, brightness, contrast, gamma, cutoff, ordered dithering,
  invert, fill silhouette, and edge detection that outlines shapes with `| / - \`.
- **Color:** the model's own colors, a solid color or a 3-stop gradient;
  background color or transparent; an accent color for effects.
- **Shading:** original materials, clay, toon, normals, depth or wireframe, with a
  camera-relative key light, rim light, ambient and reflections.
- **Motion:** turntable spin, float, follow-the-cursor, field of view, orbit and
  zoom, and fixed frames (16:9, 4:3, 1:1, 4:5, 9:16).
- **Effects:** scan beam (5 directions), cursor lens, glow, flicker, background
  glyph field, cell grid, CRT lines, vignette, and a decode-in when a model loads.
- **Looks:** 10 built-in looks. **Mono** (the default) follows the light/dark
  switch: ink on white, or white on black. The others set their own ground:
  Scanner, Textured, Phosphor, Amber CRT, Chroma, Thermal, Braille, Blueprint
  and Newsprint. There is also a randomizer, and you can save and load your own
  looks as JSON.
- **Export:** everything is captured from the frame between the panels: PNG at
  1×, 2× or 4× (transparent if you like), video (MP4 or WebM, including a
  seamless one-turn loop), plain text (copy or `.txt`) and SVG with real text
  that you can edit in Figma or Illustrator.
- **Share and embed:** copy a link that reproduces the current model and look,
  or get an `<iframe>` for your website, including for models you uploaded (see
  [Embed an uploaded model](#embed-an-uploaded-model)).

Settings are remembered in your browser. Uploaded files never leave your device.

## Deploy to Vercel

**Easiest: drop a zip (no Git, no command line)**

1. Get `ascii-3d-studio-vercel.zip`: run `npm run package:vercel`, which builds
   the site and writes the zip to the project folder.
2. Open [vercel.com/drop](https://vercel.com/drop) and drag the zip onto the page.
3. Choose your team, name the project, and click **Deploy**.

The zip holds the finished site (with `index.html` at the top level) and a
`vercel.json` without build settings, so Vercel publishes it as-is. To update the
site later, make your changes, run `npm run package:vercel` again, and drop the
new zip. The same zip also works with the CLI: unzip it and run `npx vercel --prod`
inside the folder.

**From GitHub**

The repository is also ready to deploy straight from GitHub. `vercel.json` sets
the framework (Vite), the build command and the output directory, and no
environment variables are needed.

**From the Vercel dashboard**

1. Go to [vercel.com/new](https://vercel.com/new) and import this GitHub repository.
2. Keep the detected settings (Framework: Vite, Build: `npm run build`, Output: `dist`).
3. Click **Deploy**.

Vercel builds production from the repository's default branch. Merge this
branch into it (or pick the branch in the project settings) to deploy it to
production; other branches get preview deployments automatically.

**From the command line**

```bash
npm install -g vercel
vercel          # preview deployment
vercel --prod   # production deployment
```

Vercel needs Node 20.19 or newer, and its default Node 22 works.

## Run locally

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # typecheck + production build into dist/
npm run preview    # serve the production build
npm test           # unit tests
```

## Embed an uploaded model

A model you upload exists only in your browser, so another website can't load
it until it's online. The **Embed** section in the left panel packages it for
you in three steps:

1. **Download the embed.** Choose **.zip** (an `index.html` plus your
   `model.glb`) or **.html** (one file with the model inside it). The page
   contains the whole renderer, the model and the current look. It doesn't
   depend on this site, so it keeps working even if the studio moves.
2. **Put it online.** Drag the .zip onto [vercel.com/drop](https://vercel.com/drop),
   or upload the .html to any static host.
3. **Paste its link** back into the Embed section and click **Copy embed code**.

You get an iframe like this to paste into your page's HTML:

```html
<iframe src="https://your-embed.vercel.app/" title="Robot in ASCII"
  style="width:100%;aspect-ratio:16/9;border:0;display:block"
  loading="lazy" allowfullscreen></iframe>
```

Set **Shape** in the Embed section before copying to get 16:9, 4:3, 1:1, 4:5 or
9:16. Turn off **Drag to orbit** before downloading if the embed should not
respond to dragging and scrolling, e.g. for a page background. Draco- or
Basis-compressed files, multi-file glTF, FBX, OBJ and STL are rewritten as a
plain `.glb` for the embed. Other `.glb` files travel exactly as uploaded.

## Use it on your website

For a sample, or a model that is already online (loaded **From a link**), the
Embed section gives you the code in one click, pointing back at this site. To
host your own model with the studio, put it in `public/models/` (for example
`public/models/robot.glb`), deploy, open the site with
`?model=/models/robot.glb`, tune the look, and click **Copy embed code**:

```html
<iframe
  src="https://your-app.vercel.app/?model=/models/robot.glb&embed=1#s=eyJ..."
  title="robot in ASCII"
  style="width:100%;aspect-ratio:16/9;border:0;display:block"
  loading="lazy"
  allowfullscreen
></iframe>
```

URL options:

| Option | Example | What it does |
| --- | --- | --- |
| `model` | `?model=/models/robot.glb`, `?model=https://…/a.glb`, `?model=sample:knot` | Model to open |
| `preset` | `?preset=phosphor` | Start from a built-in look |
| `embed` | `?embed=1` | Hide the interface (for iframes) |
| `controls` | `?controls=0` | Turn off orbit and zoom, e.g. for page backgrounds |
| `clip` | `?clip=2` | Animation clip to play |
| `#s=` | `#s=eyJ...` | Settings from **Copy link** or **Copy embed code** |

Models loaded from another domain must allow cross-origin requests (CORS).
Files in `public/models/` are served with `Access-Control-Allow-Origin: *`
(see `vercel.json`), so other sites can load them too.

## Keyboard shortcuts

| Key | Action |
| --- | --- |
| `U` | Upload a model |
| `S` | Save PNG |
| `Space` | Pause or play motion |
| `R` | Reset view |
| `H` | Hide or show the interface |
| `F` | Full screen |
| `X` | Random look |
| `1`–`9`, `0` | Apply a built-in look |

Drag a slider row to change its value, or double-click it (or click the number)
to type an exact one.

## How it works

Each frame goes through three GPU passes (`src/ascii/`):

1. **Scene.** The model is rendered into a small offscreen target with about
   4×4 samples per character cell, so the cost doesn't grow with screen size.
2. **Cells.** A reduce shader averages each cell into one texel: color in the
   `rgb` channels, coverage (how much of the cell the model fills) in alpha.
3. **Glyphs.** A composite shader maps each cell's tone-mapped brightness to a
   character from the ramp (light → dense) and copies that glyph's pixels 1:1
   from a glyph atlas. The atlas is rasterized at exactly the cell size in device
   pixels, so text stays crisp. Edges, dithering, the scan beam, lens, field,
   grid, CRT lines and vignette are applied in the same pass; bloom runs after.

Text and SVG exports read the cell grid back and run the same character
mapping on the CPU (`src/ascii/mapping.ts`), so exports match the screen.

```
src/
  app.ts               wiring: renderer, layout, input, loading, exports, embeds
  ascii/               AsciiPass, shaders, glyph atlas, CPU mapping
  scene/               stage (camera, framing, lights, motion), loaders, shading, samples
  state/               settings schema, presets, theme-matched look, share links, store
  ui/                  the two panels, controls, dropdowns, colour picker, tour, sounds
  export/              file saving, SVG builder, video recorder, embed page, zip writer
tests/                 unit tests (vitest)
```

## Credits

- Fox sample: model by PixelMannen (CC0); rigging and animation by tomkranis
  (CC BY 4.0); glTF conversion by @AsoboStudio and @scurest (CC BY 4.0). From the
  [Khronos glTF Sample Assets](https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/Fox).
  See `public/models/CREDITS.md`.
- Rendering: [three.js](https://threejs.org) (MIT).
- Interface icons: [Iconoir](https://iconoir.com) (MIT), with a few drawn to match.
- Fonts: served by Google Fonts under the SIL Open Font License.
