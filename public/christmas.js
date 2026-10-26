// Christmas, loaded by theme.js in December only. A big "Christmas Chibai!" with bells,
// a Santa hat on the title, stars twinkling in the dark sky, snow falling, strings of
// lights, holly and snow caps on the cards, a row of trees and presents above the footer,
// and Santa's sleigh drawn here (so the reindeer face the way they fly on every phone)
// crossing the top now and then. Reduced motion keeps everything still and drops the
// snow and the sleigh.
(() => {
  const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const make = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html) e.innerHTML = html; return e; };
  const hidden = (e) => { e.setAttribute("aria-hidden", "true"); return e; };

  // Santa and his sleigh on the left, three reindeer pulling to the right, Rudolph leading.
  const deer = (x, nose) => `<g transform="translate(${x} 0)">
    <path d="M30 26 L38 12 L43 14 L37 30 Z" fill="#7a4a24"/>
    <ellipse cx="20" cy="30" rx="15" ry="7.5" fill="#8b5a2b"/>
    <ellipse cx="43" cy="12" rx="6.5" ry="4" fill="#8b5a2b" transform="rotate(18 43 12)"/>
    <path d="M40 8 L36 0 M38 4 L33 3 M43 8 L46 0 M45 4 L50 2" stroke="#d9b98a" stroke-width="1.6" stroke-linecap="round" fill="none"/>
    <path d="M10 35 L3 46 M14 36 L18 47 M27 36 L23 47 M31 35 L40 44" stroke="#6b3e1f" stroke-width="2.6" stroke-linecap="round"/>
    <circle cx="6" cy="26" r="2.5" fill="#f3e3c8"/>
    ${nose ? '<circle cx="49.5" cy="14" r="2.8" fill="#ff2a2a"><animate attributeName="opacity" values="1;.4;1" dur="1s" repeatCount="indefinite"/></circle>' : '<circle cx="49" cy="14" r="1.6" fill="#3a2414"/>'}
  </g>`;
  const SLEIGH = `<svg viewBox="-2 -14 300 78" width="300" height="78">
    <path d="M104 40 C130 30 150 34 170 28 M104 40 C150 36 200 34 226 28" stroke="#f5d27a" stroke-width="1.2" fill="none"/>
    ${deer(120, false)}${deer(170, false)}${deer(222, true)}
    <path d="M0 56 Q0 62 8 62 L100 62 Q110 62 110 54" stroke="#f5d27a" stroke-width="3" fill="none" stroke-linecap="round"/>
    <path d="M14 54 L18 32 Q20 26 30 26 L72 26 L86 36 L98 36 L102 54 Z" fill="#c8102e" stroke="#f5d27a" stroke-width="2"/>
    <circle cx="62" cy="20" r="9" fill="#7a5230"/><path d="M57 13 Q62 9 67 13" stroke="#f5d27a" stroke-width="1.5" fill="none"/>
    <circle cx="40" cy="20" r="10" fill="#d4142f"/>
    <circle cx="40" cy="6" r="5.5" fill="#f2c6a0"/><path d="M34.5 8 Q40 18 45.5 8 Z" fill="#fff"/>
    <path d="M34 4 L46 4 L49 -8 Z" fill="#d4142f"/><circle cx="49" cy="-8" r="2.5" fill="#fff"/><rect x="33" y="2.5" width="14" height="3" rx="1.5" fill="#fff"/>
  </svg>`;
  const HAT = `<svg viewBox="0 0 64 48" width="64" height="48"><path d="M8 38 Q20 4 50 8 Q58 9 60 22 L54 24 Q50 16 44 18 Q34 26 30 38 Z" fill="#d4142f"/><circle cx="58" cy="25" r="5.5" fill="#fff"/><rect x="2" y="34" width="34" height="10" rx="5" fill="#fff" transform="rotate(-6 19 39)"/></svg>`;

  // Sleigh bells, made in the browser (no sound file): a quick run of bright, slightly
  // out-of-tune metal strikes. Phones only allow sound after a touch, so the page jingles
  // at the first touch anywhere, and again every time a bell is tapped.
  let audio = null;
  function jingle() {
    try {
      audio ??= new (window.AudioContext || window.webkitAudioContext)();
      if (audio.state === "suspended") audio.resume();
      const t0 = audio.currentTime, out = audio.createGain();
      out.gain.value = 0.18; out.connect(audio.destination);
      for (let k = 0; k < 9; k++) {
        const t = t0 + k * 0.07 + Math.random() * 0.03, base = 2200 + Math.random() * 1400;
        for (const ratio of [1, 1.51, 2.37]) {
          const o = audio.createOscillator(), g = audio.createGain();
          o.type = "sine"; o.frequency.value = base * ratio;
          g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.35 / ratio, t + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35 / ratio);
          o.connect(g); g.connect(out); o.start(t); o.stop(t + 0.4);
        }
      }
    } catch {}
  }
  function swing(bells) { bells.forEach((b) => { b.classList.remove("shake"); void b.offsetWidth; b.classList.add("shake"); }); }

  function greeting() {
    const g = make("p", "xmas-greet", '<button type="button" class="bell" aria-label="Ring the bells">🔔</button> Christmas Chibai! <button type="button" class="bell" tabindex="-1" aria-hidden="true">🔔</button>');
    const bells = [...g.querySelectorAll(".bell")];
    bells.forEach((b) => b.addEventListener("click", (e) => { e.stopPropagation(); jingle(); swing(bells); }));
    // The first touch anywhere on the page rings them once (a first tap on a bell rings on its own).
    let first = true;
    addEventListener("pointerdown", (e) => {
      if (!first) return;
      first = false;
      if (!e.target.closest?.(".bell")) { jingle(); swing(bells); }
    }, { capture: true });
    const cpTitle = document.querySelector("body.blue .hero h1");
    if (cpTitle) cpTitle.before(g);
    else document.querySelector("body.blue main")?.prepend(g);
  }

  function hat() {
    const h1 = document.querySelector("body.blue main > header h1, body.blue .hero h1");
    if (!h1) return;
    h1.classList.add("xmas-hatted");
    h1.prepend(hidden(make("span", "xmas-hat", HAT)));
  }

  function lightsRow(n) {
    const row = hidden(make("div", "xmas-lights"));
    for (let i = 0; i < n; i++) { const b = make("i"); b.style.setProperty("--d", `${(i * 0.37) % 1.6}s`); row.append(b); }
    return row;
  }

  function lights() {
    const band = document.querySelector("canvas.puan-ripple") || document.querySelector("img.puan");
    if (band) band.after(lightsRow(22));
    // A second string along the top of the footer band.
    document.querySelector(".foot .reach")?.prepend(lightsRow(26));
  }

  function stars() {
    const sky = hidden(make("div", "xmas-stars"));
    for (let i = 0; i < 26; i++) {
      const s = make("i");
      s.style.cssText = `left:${Math.random() * 100}%;top:${Math.random() * 100}%;--s:${4 + Math.random() * 7}px;--d:${Math.random() * 3}s`;
      sky.append(s);
    }
    document.body.prepend(sky);
  }

  function trees() {
    const row = hidden(make("div", "xmas-trees", "🎄🎁🎄⛄🎄🎁🎄"));
    const foot = document.querySelector(".foot");
    if (foot) foot.before(row);
  }

  function snow() {
    const cv = hidden(make("canvas", "xmas-snow"));
    document.body.append(cv);
    const ctx = cv.getContext("2d");
    let W = 0, H = 0, flakes = [];
    const size = () => {
      const dpr = Math.min(2, devicePixelRatio || 1);
      W = innerWidth; H = innerHeight; cv.width = W * dpr; cv.height = H * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const n = Math.round(Math.min(110, (W * H) / 7000));
      flakes = Array.from({ length: n }, () => ({ x: Math.random() * W, y: Math.random() * H, r: 1 + Math.random() * 2.8, v: 0.4 + Math.random() * 1.1, w: Math.random() * Math.PI * 2 }));
    };
    size(); addEventListener("resize", size);
    const frame = () => {
      if (!document.hidden) {
        ctx.clearRect(0, 0, W, H);
        ctx.fillStyle = "rgba(255, 255, 255, .9)"; ctx.shadowColor = "rgba(120, 140, 170, .6)"; ctx.shadowBlur = 2;
        for (const f of flakes) {
          f.y += f.v; f.w += 0.015; f.x += Math.sin(f.w) * 0.5;
          if (f.y > H + 4) { f.y = -4; f.x = Math.random() * W; }
          ctx.beginPath(); ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2); ctx.fill();
        }
      }
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  function sleigh() {
    const s = hidden(make("div", "xmas-sleigh", SLEIGH));
    document.body.append(s);
    const fly = () => { if (document.hidden) return; s.classList.remove("go"); void s.offsetWidth; s.classList.add("go"); };
    setTimeout(fly, 2000);
    setInterval(fly, 20000);
  }

  const start = () => {
    greeting(); hat(); stars(); trees();
    setTimeout(lights, 60); // after ripple.js has put its canvas in
    if (!still) { snow(); sleigh(); }
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
})();
