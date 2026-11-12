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

// Footer Liquid Silk: a small WebGL shader folds the Puandum red, gold and green, plus an indigo,
// into each other like ink in water (domain-warped noise), slowly and without repeating.
// The canvas is stretched to the viewport's client width and down to the page end, so it never
// adds sideways scroll. It renders at half resolution (it is all soft colour anyway), only animates
// while the band is on screen, and holds one still frame for people who ask for reduced motion.
// Without WebGL the canvas gets a plain gradient instead.
(() => {
  const c = document.querySelector(".foot .silk");
  if (!c) return;
  const band = c.parentNode, still = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const gl = c.getContext && c.getContext("webgl", { alpha: false, antialias: false, powerPreference: "low-power" });
  const place = () => {
    // Measured against the body box, which the absolutely placed canvas cannot stretch.
    const b = band.getBoundingClientRect(), root = document.documentElement;
    const below = Math.max(0, document.body.getBoundingClientRect().bottom - b.bottom);
    c.style.left = -b.left + "px"; c.style.width = root.clientWidth + "px"; c.style.height = b.height + below + "px";
    return c.getBoundingClientRect();
  };
  if (!gl) {
    place();
    c.style.background = "radial-gradient(120% 70% at 30% 100%, #6e1016, transparent 70%), radial-gradient(90% 60% at 85% 100%, #1d1a6b, transparent 70%), #07080a";
    return;
  }
  const VS = "attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}";
  const FS = `precision mediump float;uniform vec2 r;uniform float t;
    float h(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
    float n(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
      return mix(mix(h(i),h(i+vec2(1,0)),f.x),mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x),f.y);}
    float fbm(vec2 p){float v=0.,a=.5;for(int i=0;i<5;i++){v+=a*n(p);p=p*2.02+vec2(1.7,9.2);a*=.5;}return v;}
    void main(){vec2 uv=gl_FragCoord.xy/r;vec2 p=uv*vec2(r.x/r.y,1.)*1.6;float s=t*.035;
      vec2 q=vec2(fbm(p+s),fbm(p+vec2(5.2,1.3)-s));
      vec2 w=vec2(fbm(p+3.*q+vec2(1.7,9.2)+s*.8),fbm(p+3.*q+vec2(8.3,2.8)-s*.6));
      float f=fbm(p+3.5*w);
      vec3 red=vec3(.84,.10,.13),gold=vec3(.95,.70,.05),green=vec3(0.,.62,.32),ind=vec3(.20,.14,.78),ink=vec3(.03,.03,.04);
      vec3 col=mix(ink,red,smoothstep(.2,.75,f));
      col=mix(col,gold,smoothstep(.45,1.,length(q))*.75);
      col=mix(col,green,smoothstep(.5,1.,w.y)*.8);
      col=mix(col,ind,smoothstep(.55,1.,w.x)*.7);
      col*=.35+.85*f;
      col=mix(ink,col,smoothstep(1.05,.25,uv.y+.15));
      col=mix(col,ink,.5*(1.-smoothstep(0.,1.,length((uv-vec2(.5,.62))/vec2(.55,.4)))));
      col+=(h(gl_FragCoord.xy)-.5)*.035;
      gl_FragColor=vec4(col,1.);}`;
  const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s; };
  const pr = gl.createProgram();
  gl.attachShader(pr, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(pr); gl.useProgram(pr);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const at = gl.getAttribLocation(pr, "p"); gl.enableVertexAttribArray(at); gl.vertexAttribPointer(at, 2, gl.FLOAT, false, 0, 0);
  const ur = gl.getUniformLocation(pr, "r"), ut = gl.getUniformLocation(pr, "t");
  // Each visit starts somewhere else in the flow.
  const seed = 20 + Math.random() * 200;
  let raf = 0, shown = false;
  const size = () => {
    const b = place(), d = Math.min(devicePixelRatio || 1, 2) * .5;
    c.width = Math.max(1, Math.round(b.width * d)); c.height = Math.max(1, Math.round(b.height * d));
    gl.viewport(0, 0, c.width, c.height);
  };
  const draw = (ms) => { gl.uniform2f(ur, c.width, c.height); gl.uniform1f(ut, ms / 1000 + seed); gl.drawArrays(gl.TRIANGLES, 0, 3); };
  const loop = (ms) => { draw(ms); raf = shown ? requestAnimationFrame(loop) : 0; };
  size();
  draw(0);
  // Watch the page box, not the window: phones rotate and zoom without a resize event.
  const redo = () => { size(); draw(performance.now()); };
  if ("ResizeObserver" in window) new ResizeObserver(redo).observe(document.documentElement);
  else addEventListener("resize", redo);
  if (still || !("IntersectionObserver" in window)) return;
  new IntersectionObserver(([e]) => {
    shown = e.isIntersecting;
    if (shown && !raf) raf = requestAnimationFrame(loop);
  }).observe(band);
})();
