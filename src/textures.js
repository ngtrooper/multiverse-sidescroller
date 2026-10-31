// Procedural 16-bit style textures (no external art needed for the test stage).
window.Tex = (() => {
  function rng(seed) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  const hex = (c) => '#' + c.map(v => Math.max(0, Math.min(255, v | 0)).toString(16).padStart(2, '0')).join('');
  const lerp = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
  function canvas(scene, key, w, h) { if (scene.textures.exists(key)) scene.textures.remove(key); const t = scene.textures.createCanvas(key, w, h); return [t, t.getContext()]; }
  const BAYER = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]];

  // vertical banded gradient with 4x4 ordered dither between bands (SNES-ish)
  function ditherGradient(ctx, x0, y0, w, h, stops, bands) {
    for (let y = 0; y < h; y++) {
      const f = y / (h - 1) * (bands - 1); const b = Math.floor(f), fr = f - b;
      for (let x = 0; x < w; x++) {
        const use = fr * 16 > BAYER[y & 3][x & 3] ? b + 1 : b;
        const t = Math.min(1, use / (bands - 1));
        const seg = t * (stops.length - 1), si = Math.min(stops.length - 2, Math.floor(seg));
        ctx.fillStyle = hex(lerp(stops[si], stops[si + 1], seg - si)); ctx.fillRect(x0 + x, y0 + y, 1, 1);
      }
    }
  }

  function sky(scene, W, H) {
    const [t, c] = canvas(scene, 'bg_sky', W, H);
    ditherGradient(c, 0, 0, W, H, [[10, 10, 34], [30, 22, 74], [74, 40, 104], [176, 96, 124], [222, 150, 140]], 14);
    const r = rng(3);
    for (let i = 0; i < 90; i++) { const x = r() * W | 0, y = r() * H * 0.5 | 0; c.fillStyle = r() < 0.2 ? '#bfe8ff' : '#7a74b8'; c.fillRect(x, y, 1, 1); }
    // the multiverse rift: a jagged glowing crack across the sky
    let x = W * 0.18, y = 40; const pts = [];
    while (x < W * 0.86) { pts.push([x, y]); x += 10 + r() * 18; y = 40 + Math.sin(x / 40) * 14 + (r() - 0.5) * 16; }
    const draw = (wd, col) => { c.strokeStyle = col; c.lineWidth = wd; c.beginPath(); pts.forEach(([a, b], i) => i ? c.lineTo(a | 0, b | 0) : c.moveTo(a | 0, b | 0)); c.stroke(); };
    draw(9, '#3a1d6e'); draw(5, '#8d3bd1'); draw(3, '#44d8ff'); draw(1, '#ffffff');
    // twin moons from two universes
    c.fillStyle = '#e9d7b8'; c.beginPath(); c.arc(W * 0.8 | 0, 70, 16, 0, 7); c.fill(); c.fillStyle = '#c4ae8e'; c.fillRect(W * 0.8 + 3 | 0, 64, 5, 4);
    c.fillStyle = '#9ad8ff'; c.beginPath(); c.arc(W * 0.12 | 0, 92, 7, 0, 7); c.fill();
    t.refresh();
  }

  // seamless skyline strip
  function skyline(scene, key, W, H, opt) {
    const [t, c] = canvas(scene, key, W, H); const r = rng(opt.seed);
    let x = 0;
    while (x < W) {
      const bw = opt.minW + (r() * (opt.maxW - opt.minW) | 0), bh = opt.minH + (r() * (opt.maxH - opt.minH) | 0);
      const top = H - bh;
      c.fillStyle = opt.body; c.fillRect(x, top, bw, bh);
      c.fillStyle = opt.edge; c.fillRect(x, top, 1, bh); c.fillRect(x, top, bw, 1);
      if (r() < 0.35) { c.fillStyle = opt.body; c.fillRect(x + (bw >> 1) - 1, top - 8 - (r() * 10 | 0), 2, 18); }
      // windows
      for (let wy = top + 4; wy < H - 4; wy += opt.winStep) for (let wx = x + 3; wx < x + bw - 3; wx += opt.winStep) {
        if (r() < opt.winP) { c.fillStyle = r() < 0.15 ? opt.win2 : opt.win; c.fillRect(wx, wy, opt.winW, opt.winH); }
      }
      // neon sign
      if (opt.neon && r() < 0.45 && bh > 60) {
        const sx = x + 2 + (r() * Math.max(1, bw - 12) | 0), sy = top + 10 + (r() * 30 | 0), col = opt.neon[r() * opt.neon.length | 0];
        c.fillStyle = '#120a1c'; c.fillRect(sx - 1, sy - 1, 10, 32);
        c.fillStyle = col; c.fillRect(sx, sy, 8, 30);
        c.fillStyle = '#1a0f22'; for (let g = 0; g < 4; g++) { c.fillRect(sx + 2, sy + 2 + g * 7, 4, 1); c.fillRect(sx + 2 + (g & 1) * 3, sy + 3 + g * 7, 1, 3); }
      }
      x += bw + (r() * opt.gap | 0);
    }
    // haze at the bottom
    if (opt.haze) for (let y = 0; y < 30; y++) for (let xx = 0; xx < W; xx++) if (BAYER[y & 3][xx & 3] < (y / 30) * 12) { c.fillStyle = opt.haze; c.fillRect(xx, H - 30 + y, 1, 1); }
    t.refresh();
  }

  function tiles(scene) {
    // rooftop ground 16x16
    let [t, c] = canvas(scene, 'tile_ground', 16, 16);
    c.fillStyle = '#2b2440'; c.fillRect(0, 0, 16, 16);
    c.fillStyle = '#3c3358'; c.fillRect(0, 3, 16, 1); c.fillRect(0, 9, 16, 1);
    c.fillStyle = '#1b1630'; c.fillRect(7, 4, 1, 5); c.fillRect(13, 10, 1, 6); c.fillRect(3, 10, 1, 6);
    c.fillStyle = '#6a5c8e'; c.fillRect(0, 0, 16, 1); c.fillStyle = '#44d8ff'; c.fillRect(0, 1, 16, 1); c.fillStyle = '#1f6f8f'; c.fillRect(0, 2, 16, 1);
    t.refresh();
    // floating girder 16x10
    [t, c] = canvas(scene, 'tile_plat', 16, 10);
    c.fillStyle = '#4a3a6a'; c.fillRect(0, 0, 16, 10);
    c.fillStyle = '#8c7cc0'; c.fillRect(0, 0, 16, 1); c.fillStyle = '#e055b0'; c.fillRect(0, 1, 16, 1);
    c.fillStyle = '#2a2040'; c.fillRect(0, 9, 16, 1);
    c.fillStyle = '#2f2448'; for (let i = 0; i < 16; i += 4) { c.fillRect(i, 3, 1, 5); }
    c.fillStyle = '#a99be0'; c.fillRect(2, 5, 1, 1); c.fillRect(10, 5, 1, 1);
    t.refresh();
    // dirt fill under ground surface
    [t, c] = canvas(scene, 'tile_fill', 16, 16);
    c.fillStyle = '#1e1930'; c.fillRect(0, 0, 16, 16); c.fillStyle = '#251f3a'; c.fillRect(0, 7, 16, 1); c.fillRect(8, 0, 1, 7); c.fillRect(3, 8, 1, 8);
    t.refresh();
    [t, c] = canvas(scene, 'px', 2, 2); c.fillStyle = '#fff'; c.fillRect(0, 0, 2, 2); t.refresh();
  }

  // enemies: draw frames side by side, then register frame rects
  function addFrames(t, n, w, h) { for (let i = 0; i < n; i++) t.add(i, 0, i * w, 0, w, h); }
  function oni(scene) {
    const W = 30, H = 38, N = 3; const [t, c] = canvas(scene, 'oni', W * N, H);
    const P = (x, y, w, h, col) => { c.fillStyle = col; c.fillRect(x, y, w, h); };
    for (let f = 0; f < N; f++) {
      const o = f * W, step = f === 1 ? 1 : 0, hit = f === 2;
      const skin = hit ? '#ffffff' : '#8e2b3a', dark = hit ? '#d0d0d0' : '#5a1626', lite = hit ? '#fff' : '#c4485a';
      // legs
      P(o + 9, 28 - step, 5, 9 + step, dark); P(o + 17, 28 + step, 5, 9 - step, dark);
      P(o + 8, 36, 7, 2, '#20101a'); P(o + 16, 36, 7, 2, '#20101a');
      // loincloth
      P(o + 8, 25, 15, 5, hit ? '#eee' : '#2a2a5a'); P(o + 13, 29, 5, 4, hit ? '#eee' : '#3a3a7a');
      // torso
      P(o + 6, 12, 19, 14, skin); P(o + 7, 13, 6, 6, lite); P(o + 6, 24, 19, 2, dark);
      // head
      P(o + 9, 3, 13, 10, skin); P(o + 10, 4, 4, 3, lite);
      P(o + 9, 0, 2, 4, '#e8dcc0'); P(o + 20, 0, 2, 4, '#e8dcc0'); P(o + 8, 0, 1, 2, '#e8dcc0'); P(o + 22, 0, 1, 2, '#e8dcc0');
      P(o + 11, 7, 3, 2, '#ffe14a'); P(o + 17, 7, 3, 2, '#ffe14a'); P(o + 12, 10, 7, 1, '#2a0a10'); P(o + 13, 11, 1, 1, '#fff'); P(o + 17, 11, 1, 1, '#fff');
      // arms + club
      P(o + 3, 13, 4, 10, skin); P(o + 24, 13, 4, 9, skin);
      P(o + 25, 4 + step, 4, 14, hit ? '#ddd' : '#6b4a2a'); P(o + 26, 4 + step, 2, 1, hit ? '#fff' : '#9a7444'); P(o + 25, 7 + step, 1, 1, '#ccc'); P(o + 28, 10 + step, 1, 1, '#ccc');
      // outline (1px dark around opaque)
    }
    outline(c, W * N, H, '#140812'); t.refresh(); addFrames(t, N, W, H);
  }
  function drone(scene) {
    const W = 26, H = 22, N = 3; const [t, c] = canvas(scene, 'drone', W * N, H);
    const P = (x, y, w, h, col) => { c.fillStyle = col; c.fillRect(x, y, w, h); };
    for (let f = 0; f < N; f++) {
      const o = f * W, up = f === 1, hit = f === 2;
      // wings
      const wc = hit ? '#fff' : '#3fb8d8', wl = hit ? '#fff' : '#a8f0ff';
      if (up) { P(o + 1, 2, 7, 3, wc); P(o + 18, 2, 7, 3, wc); P(o + 2, 2, 5, 1, wl); P(o + 19, 2, 5, 1, wl); }
      else { P(o + 0, 9, 7, 3, wc); P(o + 19, 9, 7, 3, wc); P(o + 1, 9, 5, 1, wl); P(o + 20, 9, 5, 1, wl); }
      // body sphere
      c.fillStyle = hit ? '#fff' : '#5a2a8a'; c.beginPath(); c.arc(o + 13, 11, 8, 0, 7); c.fill();
      P(o + 9, 5, 5, 2, hit ? '#fff' : '#9a5ad0');
      // eye
      P(o + 9, 9, 8, 6, '#f0f0ff'); P(o + 12, 10, 4, 4, hit ? '#f0f' : '#e02060'); P(o + 13, 11, 1, 1, '#fff');
      P(o + 11, 19, 1, 3, '#44d8ff'); P(o + 15, 19, 1, 3, '#44d8ff');
    }
    outline(c, W * N, H, '#120a20'); t.refresh(); addFrames(t, N, W, H);
  }
  function portal(scene) {
    const W = 40, H = 72, N = 4; const [t, c] = canvas(scene, 'portal', W * N, H);
    for (let f = 0; f < N; f++) {
      const o = f * W;
      for (let i = 0; i < 6; i++) {
        const rx = 18 - i * 3, ry = 34 - i * 5; const cols = ['#3a1d6e', '#8d3bd1', '#e055b0', '#44d8ff', '#bff4ff', '#ffffff'];
        c.strokeStyle = cols[i]; c.lineWidth = 2; c.beginPath(); c.ellipse(o + 20, 36, rx, ry, 0, (f * 0.8 + i) % 6, (f * 0.8 + i) % 6 + 4.6); c.stroke();
      }
    }
    t.refresh(); addFrames(t, N, W, H);
  }
  function outline(c, w, h, col) {
    const d = c.getImageData(0, 0, w, h), a = d.data, out = [];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (a[(y * w + x) * 4 + 3]) continue;
      const n = (xx, yy) => xx >= 0 && yy >= 0 && xx < w && yy < h && a[(yy * w + xx) * 4 + 3] > 0;
      if (n(x - 1, y) || n(x + 1, y) || n(x, y - 1) || n(x, y + 1)) out.push([x, y]);
    }
    c.fillStyle = col; out.forEach(([x, y]) => c.fillRect(x, y, 1, 1));
  }
  function all(scene, W, H) {
    sky(scene, W, H);
    skyline(scene, 'bg_far', 512, H, { seed: 11, minW: 18, maxW: 40, minH: 90, maxH: 200, gap: 4, body: '#1d1840', edge: '#2a2458', win: '#4a3f7a', win2: '#ffb3c8', winStep: 5, winW: 2, winH: 2, winP: 0.25, haze: '#a0607a' });
    skyline(scene, 'bg_mid', 640, H, { seed: 23, minW: 34, maxW: 70, minH: 70, maxH: 190, gap: 18, body: '#14102a', edge: '#2c2350', win: '#f2a35a', win2: '#7ff0ff', winStep: 7, winW: 3, winH: 2, winP: 0.22, neon: ['#ff3a6e', '#ff4fb0', '#3fe0ff', '#ffd23f'], haze: '#5a3058' });
    skyline(scene, 'bg_near', 720, H, { seed: 41, minW: 60, maxW: 120, minH: 40, maxH: 110, gap: 60, body: '#0c0918', edge: '#1c1634', win: '#2a2244', win2: '#ff3a6e', winStep: 9, winW: 4, winH: 3, winP: 0.12 });
    tiles(scene); oni(scene); drone(scene); portal(scene);
  }
  return { all };
})();
