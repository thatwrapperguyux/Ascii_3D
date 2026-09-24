/**
 * GLSL for the two-pass ASCII effect.
 *
 * 1. reduce:    scene render → one texel per character cell
 *               (rgb = average color, sRGB-encoded; a = coverage).
 * 2. composite: cells → glyphs at full resolution, plus effects.
 *
 * Both are compiled by three's ShaderMaterial as GLSL ES 3.00, so texelFetch
 * is available and gl_FragColor is aliased to the output.
 */

export const fullscreenVertex = /* glsl */ `
  void main() {
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

export const reduceFragment = /* glsl */ `
  uniform sampler2D tScene;
  uniform vec2 uCell;
  uniform vec2 uOffset;
  uniform vec2 uViewport;
  uniform float uExposure;

  vec3 acesFilm(vec3 x) {
    return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
  }

  vec3 linearToSrgb(vec3 c) {
    return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), c));
  }

  void main() {
    vec2 cell = floor(gl_FragCoord.xy);
    vec4 sum = vec4(0.0);
    for (int y = 0; y < 4; y++) {
      for (int x = 0; x < 4; x++) {
        vec2 px = (cell + (vec2(float(x), float(y)) + 0.5) * 0.25) * uCell - uOffset;
        sum += texture2D(tScene, px / uViewport);
      }
    }
    sum *= 1.0 / 16.0;
    float coverage = clamp(sum.a, 0.0, 1.0);
    // The scene is cleared to transparent black, so the average is premultiplied.
    vec3 color = coverage > 0.0001 ? sum.rgb / coverage : vec3(0.0);
    color = acesFilm(max(color, 0.0) * uExposure);
    gl_FragColor = vec4(linearToSrgb(color), coverage);
  }
`;

export const compositeFragment = /* glsl */ `
  #define PI 3.14159265359

  uniform highp sampler2D tCells;
  uniform highp sampler2D tAtlas;
  uniform vec2 uGrid;
  uniform vec2 uCell;
  uniform vec2 uOffset;
  uniform vec2 uViewport;
  uniform float uTime;

  uniform float uAtlasColumns;
  uniform float uRampCount;
  uniform float uEdgeBase;
  uniform float uGlitchBase;
  uniform float uGlitchCount;

  uniform float uBrightness;
  uniform float uContrast;
  uniform float uGamma;
  uniform float uThreshold;
  uniform float uDither;
  uniform bool uInvert;
  uniform bool uFill;
  uniform bool uEdges;
  uniform float uEdgeThreshold;

  uniform int uColorMode;
  uniform vec3 uFg;
  uniform vec3 uGradA;
  uniform vec3 uGradB;
  uniform vec3 uGradC;
  uniform float uColorBoost;
  uniform float uSaturation;
  uniform vec3 uBg;
  uniform bool uTransparent;
  uniform vec3 uAccent;

  uniform bool uScan;
  uniform int uScanDir;
  uniform float uScanPos;
  uniform float uScanWidth;
  uniform float uScanFront;
  uniform float uScanGlitch;
  uniform float uLens;
  uniform vec2 uMouse;
  uniform float uLensRadius;
  uniform float uNoise;
  uniform float uField;
  uniform float uGridLines;
  uniform float uCrt;
  uniform float uVignette;
  uniform float uReveal;

  float hash12(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }

  float luma(vec3 c) {
    return dot(c, vec3(0.2126, 0.7152, 0.0722));
  }

  vec3 srgbToLinear(vec3 c) {
    return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), c));
  }

  vec4 cellData(ivec2 c) {
    return texelFetch(tCells, clamp(c, ivec2(0), ivec2(uGrid) - 1), 0);
  }

  float toneMap(float l) {
    l = pow(clamp(l, 0.0, 1.0), 1.0 / uGamma);
    l = (l - 0.5) * uContrast + 0.5 + uBrightness;
    return clamp(l, 0.0, 1.0);
  }

  float edgeSignal(ivec2 c) {
    vec4 d = cellData(c);
    return d.a * (0.4 + 0.6 * toneMap(luma(d.rgb)));
  }

  float bayer4(vec2 p) {
    int i = int(mod(p.x, 4.0)) + int(mod(p.y, 4.0)) * 4;
    float m[16] = float[16](0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0, 3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0);
    return (m[i] + 0.5) / 16.0;
  }

  float glitchGlyph(vec2 seed) {
    return uGlitchBase + floor(hash12(seed) * uGlitchCount);
  }

  void main() {
    vec2 frag = gl_FragCoord.xy;
    vec2 p = frag + uOffset;
    vec2 cellF = floor(p / uCell);
    ivec2 cell = ivec2(cellF);
    vec2 local = p - cellF * uCell;
    vec2 center = (cellF + 0.5) * uCell - uOffset;
    vec2 uv = center / uViewport;

    vec4 data = cellData(cell);
    float coverage = data.a;
    vec3 srgb = data.rgb;
    bool covered = coverage > 0.02;

    float level = toneMap(luma(srgb));
    if (uInvert) level = 1.0 - level;
    level *= smoothstep(0.0, 0.5, coverage);
    level += (bayer4(cellF) - 0.5) * uDither / uRampCount;
    level = clamp(level, 0.0, 1.0);

    float glyph = -1.0;
    if (covered && level > uThreshold) {
      glyph = clamp(floor(level * uRampCount), 0.0, uRampCount - 1.0);
    }
    if (covered && uFill) glyph = max(glyph, 1.0);

    if (uEdges && covered) {
      float tl = edgeSignal(cell + ivec2(-1, 1));
      float tc = edgeSignal(cell + ivec2(0, 1));
      float tr = edgeSignal(cell + ivec2(1, 1));
      float ml = edgeSignal(cell + ivec2(-1, 0));
      float mr = edgeSignal(cell + ivec2(1, 0));
      float bl = edgeSignal(cell + ivec2(-1, -1));
      float bc = edgeSignal(cell + ivec2(0, -1));
      float br = edgeSignal(cell + ivec2(1, -1));
      float gx = (tr + 2.0 * mr + br) - (tl + 2.0 * ml + bl);
      float gy = (tl + 2.0 * tc + tr) - (bl + 2.0 * bc + br);
      if (length(vec2(gx, gy)) > uEdgeThreshold) {
        // Correct for non-square cells so diagonals pick the right slash.
        float angle = mod(atan(gy / uCell.y, gx / uCell.x) + PI / 8.0, PI);
        glyph = uEdgeBase + min(floor(angle / (PI / 4.0)), 3.0);
      }
    }

    vec3 color;
    if (uColorMode == 0) {
      vec3 c = mix(vec3(luma(srgb)), srgb, uSaturation);
      float peak = max(max(c.r, c.g), max(c.b, 0.001));
      c = mix(c, c / peak, uColorBoost);
      color = srgbToLinear(clamp(c, 0.0, 1.0));
    } else if (uColorMode == 1) {
      color = uFg;
    } else {
      vec3 g = level < 0.5 ? mix(uGradA, uGradB, level * 2.0) : mix(uGradB, uGradC, level * 2.0 - 1.0);
      color = srgbToLinear(g);
    }

    float glyphAlpha = 1.0;

    // Decode-in after a model loads: cells resolve through scrambled glyphs.
    if (uReveal < 1.0 && glyph >= 0.0) {
      float h = hash12(cellF * 1.37 + 7.0);
      if (h > uReveal) {
        glyph = h > uReveal + 0.22 ? -1.0 : glitchGlyph(cellF + floor(uTime * 24.0));
        color = uAccent;
      }
    }

    // Random flicker.
    if (glyph >= 0.0 && uNoise > 0.0) {
      float tick = floor(uTime * 10.0);
      if (hash12(cellF + tick * 13.1) < uNoise * 0.3) glyph = glitchGlyph(cellF * 3.1 + tick);
    }

    // Scan beam: a bright front with a fading trail.
    if (uScan) {
      float coord;
      if (uScanDir == 0) coord = 1.0 - uv.y;
      else if (uScanDir == 1) coord = uv.y;
      else if (uScanDir == 2) coord = uv.x;
      else if (uScanDir == 3) coord = 1.0 - uv.x;
      else {
        vec2 aspect = vec2(uViewport.x / uViewport.y, 1.0);
        coord = length((uv - 0.5) * aspect) / (0.5 * length(aspect));
      }
      float d = uScanPos - coord;
      float trail = d >= 0.0 ? exp(-d / uScanWidth) : 0.0;
      float front = 1.0 - smoothstep(0.0, uScanFront, abs(d));
      if (max(trail, front) > 0.002) {
        float tick = floor(uTime * 18.0);
        float h = hash12(cellF + tick * 3.7);
        if (glyph >= 0.0) {
          if (h < uScanGlitch * (front * 0.9 + trail * 0.3)) glyph = glitchGlyph(cellF + tick);
          color = mix(color, uAccent, clamp(front + trail * 0.55, 0.0, 1.0));
        } else if (h < uScanGlitch * (front * 0.35 + trail * 0.07)) {
          glyph = glitchGlyph(cellF * 1.7 + tick);
          color = uAccent;
          glyphAlpha = 0.2 + 0.6 * front;
        }
      }
    }

    // Cursor lens: glyphs near the pointer decode and light up.
    if (uLens > 0.001) {
      float k = (1.0 - smoothstep(uLensRadius * 0.35, uLensRadius, length(center - uMouse))) * uLens;
      if (k > 0.001) {
        float tick = floor(uTime * 14.0);
        float h = hash12(cellF + tick * 5.3);
        if (glyph >= 0.0) {
          if (h < k * 0.45) glyph = glitchGlyph(cellF * 2.3 + tick);
          color = mix(color, uAccent, k * 0.7);
        } else if (h < k * 0.2) {
          glyph = glitchGlyph(cellF * 1.3 + tick);
          color = uAccent;
          glyphAlpha = 0.35 * k;
        }
      }
    }

    // Sparse, slowly changing field in the empty space around the model.
    if (glyph < 0.0 && uField > 0.0) {
      float h = hash12(cellF * 0.73 + 11.0);
      if (h < 0.22) {
        float tick = floor(uTime * (0.15 + h * 1.2) + h * 10.0);
        glyph = glitchGlyph(cellF + tick * 1.7);
        color = uAccent;
        glyphAlpha = uField * (0.2 + 0.8 * hash12(cellF + tick));
      }
    }

    float mask = 0.0;
    if (glyph >= 0.0) {
      float gx = mod(glyph, uAtlasColumns);
      float gy = floor(glyph / uAtlasColumns);
      ivec2 texel = ivec2(int(gx * uCell.x + local.x), int(gy * uCell.y + (uCell.y - 1.0 - floor(local.y))));
      mask = texelFetch(tAtlas, texel, 0).a * glyphAlpha;
    }

    float gridAlpha = (local.x < 1.0 || local.y < 1.0) ? uGridLines * 0.5 : 0.0;
    vec4 under = uTransparent ? vec4(0.0) : vec4(uBg, 1.0);
    under = vec4(mix(under.rgb, uAccent, gridAlpha), max(under.a, gridAlpha));
    vec3 outColor = mix(under.rgb, color, mask);
    float outAlpha = under.a + mask * (1.0 - under.a);

    float shade = 1.0;
    if (uCrt > 0.0) shade *= 1.0 - uCrt * 0.45 * step(mod(frag.y, 3.0), 1.0);
    if (uVignette > 0.0) {
      float v = length(frag / uViewport - 0.5) * 1.4142;
      shade *= 1.0 - uVignette * 0.85 * smoothstep(0.3, 1.0, v);
    }

    gl_FragColor = vec4(outColor * shade, outAlpha);
  }
`;
