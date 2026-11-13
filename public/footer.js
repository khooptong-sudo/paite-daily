// Footer coffee button: phones follow the UPI link; desktop opens the QR panel instead.
(() => {
  const a = document.getElementById("coffee"), p = document.getElementById("upi");
  if (!a || !p) return;
  a.addEventListener("click", (e) => {
    if (matchMedia("(pointer: coarse), (max-width: 640px)").matches) return;
    e.preventDefault();
    p.hidden = !p.hidden;
    a.setAttribute("aria-expanded", String(!p.hidden));
  });
  document.getElementById("upi-copy").addEventListener("click", async () => {
    const id = document.getElementById("upi-id");
    try { await navigator.clipboard.writeText(id.textContent); } catch {
      const r = document.createRange(); r.selectNodeContents(id);
      const s = getSelection(); s.removeAllRanges(); s.addRange(r);
    }
  });
})();

// Footer Paper Silk: a small WebGL shader folds the Puandum red, gold and green, plus an indigo,
// into warm paper as soft dye washes (domain-warped noise), slowly and without repeating.
// The middle stays near plain paper, so the ink type over it reads.
// The canvas is stretched to the viewport's client width and down to the page end, so it never
// adds sideways scroll. It renders at half resolution (it is all soft colour anyway), only animates
// while the band is on screen, and holds one still frame for people who ask for reduced motion.
// Without WebGL the canvas gets a plain gradient instead.
// It answers touch too: the pointer (or a finger dragging) stirs the colour around it and lights
// it a little, and each tap or click drops a ring that spreads through the silk and fades.
(() => {
  let c = document.querySelector(".foot .silk");
  if (!c) return;
  const band = c.parentNode, still = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let gl = c.getContext && c.getContext("webgl", { alpha: false, antialias: false, powerPreference: "low-power" });
  const place = () => {
    // Measured against the body box, which the absolutely placed canvas cannot stretch.
    const b = band.getBoundingClientRect(), root = document.documentElement;
    const below = Math.max(0, document.body.getBoundingClientRect().bottom - b.bottom);
    c.style.left = -b.left + "px"; c.style.width = root.clientWidth + "px"; c.style.height = b.height + below + "px";
    return c.getBoundingClientRect();
  };
  const flat = () => {
    place();
    c.style.background = "radial-gradient(120% 70% at 20% 100%, #f0c7b8, transparent 70%), radial-gradient(90% 60% at 85% 100%, #cfd6ea, transparent 70%), #f3efe6";
  };
  if (!gl) { flat(); return; }
  // Phones run mediump as 16-bit floats, where a sin()-based hash and large noise coordinates
  // collapse to one value and the silk comes out as plain paper. So: highp wherever the GPU has it,
  // and a hash without sin() that holds up when it does not.
  const VS = "attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}";
  const FS = `#ifdef GL_FRAGMENT_PRECISION_HIGH
    precision highp float;
    #else
    precision mediump float;
    #endif
    uniform vec2 r;uniform float t;uniform vec3 m;uniform vec2 v;uniform vec4 k[4];
    float h(vec2 p){vec3 q=fract(vec3(p.xyx)*.1031);q+=dot(q,q.yzx+33.33);return fract((q.x+q.y)*q.z);}
    float n(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
      return mix(mix(h(i),h(i+vec2(1,0)),f.x),mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x),f.y);}
    float fbm(vec2 p){float v=0.,a=.5;for(int i=0;i<5;i++){v+=a*n(p);p=p*2.02+vec2(1.7,9.2);a*=.5;}return v;}
    void main(){vec2 uv=gl_FragCoord.xy/r,asp=vec2(r.x/r.y,1.);vec2 p=uv*asp*1.6;float s=t*.035;
      vec2 a=(uv-m.xy)*asp;float fall=exp(-dot(a,a)*5.);
      p+=(vec2(-a.y,a.x)*1.3+a*.35)*fall*m.z-v*asp*1.2*fall;
      float glow=fall*m.z,ring=0.;
      for(int i=0;i<4;i++){vec2 b=(uv-k[i].xy)*asp;float rd=length(b),ag=k[i].z;
        float wv=sin(rd*26.-ag*8.)*exp(-ag*1.3)*exp(-pow(rd-ag*.32,2.)*28.)*k[i].w;
        p+=b/(rd+.001)*wv*.5;ring+=wv;}
      vec2 q=vec2(fbm(p+s),fbm(p+vec2(5.2,1.3)-s));
      vec2 w=vec2(fbm(p+3.*q+vec2(1.7,9.2)+s*.8),fbm(p+3.*q+vec2(8.3,2.8)-s*.6));
      float f=fbm(p+3.5*w);
      vec3 paper=vec3(.955,.937,.902),col=paper;
      col=mix(col,vec3(.90,.42,.40),smoothstep(.45,.9,f)*.55);
      col=mix(col,vec3(.96,.80,.42),smoothstep(.55,1.,length(q))*.55);
      col=mix(col,vec3(.50,.76,.58),smoothstep(.55,1.,w.y)*.5);
      col=mix(col,vec3(.62,.60,.90),smoothstep(.6,1.,w.x)*.45);
      col=mix(col,paper,.55*(1.-smoothstep(0.,1.,length((uv-vec2(.5,.62))/vec2(.55,.4)))));
      col+=vec3(-.05,-.035,-.015)*glow+vec3(.6,.5,.3)*max(ring,0.)*.08;
      col+=(h(gl_FragCoord.xy)-.5)*.035;
      gl_FragColor=vec4(col,1.);}`;
  const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s; };
  const pr = gl.createProgram();
  gl.attachShader(pr, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(pr);
  // A GPU that will not build the shader would leave a black box; give it the gradient instead.
  // (An opaque WebGL canvas would paint black over it, so swap in a fresh canvas first.)
  if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) { const n = c.cloneNode(); c.replaceWith(n); c = n; gl = null; flat(); return; }
  gl.useProgram(pr);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const at = gl.getAttribLocation(pr, "p"); gl.enableVertexAttribArray(at); gl.vertexAttribPointer(at, 2, gl.FLOAT, false, 0, 0);
  const ur = gl.getUniformLocation(pr, "r"), ut = gl.getUniformLocation(pr, "t");
  const um = gl.getUniformLocation(pr, "m"), uv = gl.getUniformLocation(pr, "v"), uk = gl.getUniformLocation(pr, "k");
  // Touch state: where the pointer is (in the canvas's 0..1 space, y up), how present it is
  // (eases in and out), how fast it moves (smoothed), and up to four spreading rings.
  const pt = { x: .5, y: .5, z: 0, on: 0, vx: 0, vy: 0, tx: .5, ty: .5 }, rings = new Float32Array(16);
  let ri = 0, lastMs = 0;
  // Each visit starts somewhere else in the flow.
  const seed = 20 + Math.random() * 200;
  let raf = 0, shown = false;
  const size = () => {
    const b = place(), d = Math.min(devicePixelRatio || 1, 2) * .5;
    c.width = Math.max(1, Math.round(b.width * d)); c.height = Math.max(1, Math.round(b.height * d));
    gl.viewport(0, 0, c.width, c.height);
  };
  const draw = (ms) => {
    const dt = Math.min(.05, lastMs ? (ms - lastMs) / 1000 : 0); lastMs = ms;
    const nx = pt.x + (pt.tx - pt.x) * Math.min(1, dt * 10), ny = pt.y + (pt.ty - pt.y) * Math.min(1, dt * 10);
    if (dt) { pt.vx += ((nx - pt.x) / dt - pt.vx) * Math.min(1, dt * 6); pt.vy += ((ny - pt.y) / dt - pt.vy) * Math.min(1, dt * 6); }
    pt.x = nx; pt.y = ny; pt.z += (pt.on - pt.z) * Math.min(1, dt * 3);
    for (let i = 0; i < 4; i++) rings[i * 4 + 2] += dt;
    gl.uniform2f(ur, c.width, c.height); gl.uniform1f(ut, ms / 1000 + seed);
    gl.uniform3f(um, pt.x, pt.y, pt.z); gl.uniform2f(uv, Math.max(-2, Math.min(2, pt.vx)) * .12, Math.max(-2, Math.min(2, pt.vy)) * .12); gl.uniform4fv(uk, rings);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };
  const loop = (ms) => { draw(ms); raf = shown ? requestAnimationFrame(loop) : 0; };
  size();
  draw(0);
  // Watch the page box, not the window: phones rotate and zoom without a resize event.
  const redo = () => { size(); draw(performance.now()); };
  // The band too: the Loom, fonts and the UPI panel change its height without always resizing the page box.
  if ("ResizeObserver" in window) { const ro = new ResizeObserver(redo); ro.observe(document.documentElement); ro.observe(band); }
  else addEventListener("resize", redo);
  addEventListener("load", redo);
  if (still || !("IntersectionObserver" in window)) return;
  const at01 = (e) => { const b = c.getBoundingClientRect(); return [(e.clientX - b.left) / b.width, 1 - (e.clientY - b.top) / b.height]; };
  band.addEventListener("pointermove", (e) => { const [x, y] = at01(e); if (!pt.on) { pt.x = x; pt.y = y; } pt.tx = x; pt.ty = y; pt.on = 1; });
  band.addEventListener("pointerdown", (e) => {
    const [x, y] = at01(e); pt.tx = x; pt.ty = y; pt.on = 1;
    rings.set([x, y, 0, 1], ri * 4); ri = (ri + 1) % 4;
  });
  const leave = () => { pt.on = 0; };
  band.addEventListener("pointerleave", leave); band.addEventListener("pointercancel", leave);
  band.addEventListener("pointerup", (e) => { if (e.pointerType !== "mouse") leave(); });
  new IntersectionObserver(([e]) => {
    shown = e.isIntersecting;
    if (shown && !raf) raf = requestAnimationFrame(loop);
  }).observe(band);
})();

// Footer Loom: the page opens under a liangbat and ends by weaving one, live. A shuttle crosses the
// bare warp row by row (changing direction each row), laying a 3/1 twill in the shawl's own thread
// order. Once woven, each weft row is a damped spring tied to its neighbours, so sweeping across the
// cloth sends a ripple through it. The canvas is transparent outside the cloth, so the silk shows
// through the bare warp and the fringe. It weaves once, the first time it scrolls into view, and
// people who ask for reduced motion get the finished cloth, still.
(() => {
  const band = document.querySelector(".foot .reach"), silk = band && band.querySelector(".silk");
  if (!band) return;
  const cv = document.createElement("canvas");
  cv.className = "loom"; cv.setAttribute("aria-hidden", "true");
  silk ? silk.after(cv) : band.prepend(cv);
  const ctx = cv.getContext("2d");
  if (!ctx) { cv.remove(); return; }
  const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const CELL = 4, PAD = 28;
  const C = { k: "#0b0a09", g: "#00a651", y: "#f6e600", r: "#d71920", w: "#f4f1ea", o: "#f29a00", d: "#6e0f14", p: "#e8478b", s: "#8d939a" };
  const seq = (a) => a.flatMap(([c, n]) => Array(n).fill(c));
  const WEFT = seq([["k", 5], ["g", 1], ["y", 1], ["r", 8], ["y", 1], ["g", 1], ["k", 5], ["w", 1]]);
  const WARP = seq([["k", 86], ["y", 2], ["o", 1], ["d", 3], ["k", 2], ["d", 3], ["o", 1], ["y", 2]]);
  const ROWS = WEFT.length * 2;
  const off = new Float32Array(ROWS), vel = new Float32Array(ROWS);
  let W = 0, H = 0, cols = 0, dpr = 1, cloth = null, cc = null, bare = null, woven = 0, shuttle = 0, started = false, vis = false, raf = 0, last = 0;

  const warpAt = (i) => WARP[(i + 40) % WARP.length];
  const cell = (i, j) => {
    const wf = WEFT[j % WEFT.length], wp = warpAt(i);
    let weft = wf;
    if (wf === "w") { const m = i % 44; weft = m >= 4 && m < 10 ? "g" : m >= 10 && m < 16 ? "p" : m >= 16 && m < 22 ? "s" : "w"; if (weft !== "w" && (i + j) % 2) weft = "w"; }
    return (i + j) % 4 === 0 || (wp !== "k" && (i + j) % 2 === 0) ? wp : weft;
  };
  const paintRow = (j) => {
    const y = j * CELL;
    for (let i = 0; i < cols; i++) {
      cc.fillStyle = C[cell(i, j)]; cc.fillRect(i * CELL, y, CELL, CELL);
      if ((i + j) % 4 === 0) { cc.fillStyle = "rgba(0,0,0,.28)"; cc.fillRect(i * CELL + CELL - 1, y, 1, CELL); }
    }
    cc.fillStyle = "rgba(255,255,255,.08)"; cc.fillRect(0, y, cols * CELL, 1);
    cc.fillStyle = "rgba(0,0,0,.25)"; cc.fillRect(0, y + CELL - 1, cols * CELL, 1);
  };
  const row = (j, x0, x1) => {
    if (x1 - x0 < 1) return;
    ctx.drawImage(cloth, (x0 + PAD - off[j]) * dpr, j * CELL * dpr, (x1 - x0) * dpr, CELL * dpr, x0, j * CELL, x1 - x0, CELL);
  };
  const draw = () => {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
    const top = woven * CELL, clothH = ROWS * CELL;
    if (woven < ROWS) ctx.drawImage(bare, PAD * dpr, top * dpr, W * dpr, (clothH - top) * dpr, 0, top, W, clothH - top);
    for (let j = 0; j < woven; j++) row(j, 0, W);
    if (woven < ROWS) {
      const ltr = woven % 2 === 0, x = shuttle * W;
      ltr ? row(woven, 0, x) : row(woven, W - x, W);
      const sx = ltr ? x : W - x, sy = top + CELL / 2;
      const g = ctx.createLinearGradient(sx - 30, 0, sx + 30, 0);
      g.addColorStop(0, "#5a3a10"); g.addColorStop(.5, "#f3c25a"); g.addColorStop(1, "#5a3a10");
      ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(sx, sy, 30, 4.5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "rgba(255,240,190,.9)"; ctx.fillRect(sx - 8, sy - 1, 16, 1.2);
    }
    // the fringe: loose warp ends that follow the last row
    const lastOff = off[ROWS - 1], flen = H - clothH - 4;
    ctx.lineWidth = 1.3; ctx.lineCap = "round";
    for (let i = 0; i * CELL * 2 < W + 8; i++) {
      const x = i * CELL * 2 + 2, wp = warpAt(Math.round((x + PAD) / CELL));
      const len = flen - (i % 3) * 7, sway = lastOff * 1.7 + Math.sin(i * 1.7) * 1.5;
      ctx.strokeStyle = wp === "k" ? "rgba(150,138,120,.55)" : C[wp];
      ctx.beginPath(); ctx.moveTo(x + lastOff, clothH); ctx.quadraticCurveTo(x + lastOff * 1.2, clothH + len * .55, x + sway, clothH + len); ctx.stroke();
    }
  };
  const size = () => {
    // Edge to edge across the viewport, measured from the band like the silk.
    const root = document.documentElement, b = band.getBoundingClientRect();
    // The right margin cancels the overhang, so the grid track (and the page) never widens.
    cv.style.marginLeft = -b.left + "px"; cv.style.width = root.clientWidth + "px";
    cv.style.marginRight = b.width - root.clientWidth + b.left + "px";
    dpr = Math.min(2, devicePixelRatio || 1); W = root.clientWidth; H = cv.clientHeight;
    const need = Math.ceil((W + PAD * 2) / CELL);
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    if (need !== cols || !cloth) {
      cols = need;
      cloth = document.createElement("canvas"); cloth.width = cols * CELL * dpr; cloth.height = ROWS * CELL * dpr;
      cc = cloth.getContext("2d"); cc.setTransform(dpr, 0, 0, dpr, 0, 0);
      bare = document.createElement("canvas"); bare.width = cloth.width; bare.height = cloth.height;
      const bc = bare.getContext("2d"); bc.setTransform(dpr, 0, 0, dpr, 0, 0);
      for (let i = 0; i < cols; i++) { const wp = warpAt(i); bc.globalAlpha = wp === "k" ? 1 : .55; bc.fillStyle = wp === "k" ? "rgba(120,110,95,.32)" : C[wp]; bc.fillRect(i * CELL + 1.2, 0, 1.4, ROWS * CELL); }
      for (let j = 0; j < Math.min(woven + 1, ROWS); j++) paintRow(j);
    }
    draw();
  };
  const tick = (now) => {
    const dt = Math.min(2.5, last ? (now - last) / 16.67 : 1); last = now;
    if (woven < ROWS) {
      shuttle += 0.24 * dt;
      if (shuttle >= 1) { vel[woven] += (woven % 2 ? -1 : 1) * 2.2; woven++; shuttle = 0; if (woven < ROWS) paintRow(woven); }
    }
    let energy = 0;
    for (let j = 0; j < ROWS; j++) {
      const lap = (j ? off[j - 1] : off[j]) + (j < ROWS - 1 ? off[j + 1] : off[j]) - 2 * off[j];
      vel[j] += (-0.03 * off[j] + 0.24 * lap) * dt; vel[j] *= Math.pow(0.952, dt);
    }
    for (let j = 0; j < ROWS; j++) { off[j] = Math.max(2 - PAD, Math.min(PAD - 2, off[j] + vel[j] * dt)); energy += Math.abs(vel[j]) + Math.abs(off[j]); }
    draw();
    raf = vis && (woven < ROWS || energy > 0.05) ? requestAnimationFrame(tick) : 0;
  };
  const wake = () => { if (!raf && vis && started) { last = 0; raf = requestAnimationFrame(tick); } };

  let px = null;
  cv.addEventListener("pointermove", (e) => {
    const r = cv.getBoundingClientRect(), x = e.clientX - r.left, j = Math.floor((e.clientY - r.top) / CELL);
    if (px !== null && j >= 0 && j < woven) {
      const dx = x - px;
      for (let k = -3; k <= 3; k++) { const q = j + k; if (q >= 0 && q < woven) vel[q] += dx * 0.16 * (1 - Math.abs(k) / 4); }
      wake();
    }
    px = x;
  });
  cv.addEventListener("pointerleave", () => { px = null; });
  cv.addEventListener("pointerdown", (e) => {
    const r = cv.getBoundingClientRect(), j = Math.floor((e.clientY - r.top) / CELL);
    for (let k = -6; k <= 6; k++) { const q = j + k; if (q >= 0 && q < woven) vel[q] += 7 * (1 - Math.abs(k) / 7) * (Math.random() < .5 ? -1 : 1); }
    wake();
  });

  size();
  if (still || !("IntersectionObserver" in window)) {
    for (let j = 0; j < ROWS; j++) paintRow(j);
    woven = ROWS; started = vis = !still; draw();
  } else {
    new IntersectionObserver(([e]) => { vis = e.isIntersecting; if (vis) { started = true; wake(); } }, { threshold: .35 }).observe(cv);
  }
  if ("ResizeObserver" in window) new ResizeObserver(() => size()).observe(document.documentElement);
  else addEventListener("resize", size);
})();
