// The page footer, shared by the server-rendered pages (/about, /contributors, /glossary,
// /proverbs). The front page keeps its own copy in public/index.html, and 404.html and
// 500.html carry a short one. The reviewer page has no footer.
// One full-width dark band (styles in style.css): title, note, a row of three hairline links
// (coffee, email, WhatsApp), the desktop UPI panel, then the credit line.
// footer.js paints the Liquid Silk shader behind it and opens the UPI panel.
// `data-s` keys come from public/strings.js; the English text here is the fallback, since these
// pages only replace it when the owner has filled in a Paite translation.
export const FOOTER = `
<footer class="foot">
  <div class="reach">
    <canvas class="silk" aria-hidden="true"></canvas>
    <p class="reach-kicker">Paite Daily</p>
    <p class="reach-title">Get in touch</p>
    <p class="reach-note">Contact for data, corrections, partnerships, or to volunteer as a reviewer. We treat corrections as data, not as complaints. If a pair is wrong, we fix it at the source.</p>
    <p class="links"><a class="coffee" id="coffee" href="upi://pay?pa=khooptong%40okicici&amp;pn=Min%20Khooptong&amp;cu=INR&amp;tn=Paite%20Daily" aria-expanded="false" aria-controls="upi"><svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 9h11v5a5 5 0 0 1-5 5h-1a5 5 0 0 1-5-5zM16 10.5h1.5a2.5 2.5 0 0 1 0 5H16M9 3.5v2.5M12 3.5v2.5"/></svg><span data-s="coffee">Buy us Coffee</span><svg class="ic arr" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 17L17 7M9 7h8v8"/></svg></a><a class="mail" href="mailto:theconcierge@lamkalabs.com" aria-label="Email theconcierge@lamkalabs.com" title="Email theconcierge@lamkalabs.com"><img src="/mail.png" alt="" width="18" height="18" decoding="async"><span>Email</span></a><a class="wa" href="https://wa.me/918375098415" target="_blank" rel="noopener" aria-label="WhatsApp: message Lamka Labs" title="Message Lamka Labs on WhatsApp"><img src="/whatsapp.png" alt="" width="18" height="18" decoding="async"><span>WhatsApp</span></a></p>
    <p class="coffee-note" data-s="coffeeNote">Helps cover the AI and server costs, so the data stays free for everyone.</p>
    <div class="card" id="upi" hidden>
      <img class="qr" src="/upi-qr.jpg" alt="UPI QR code for Min Khooptong, khooptong@okicici" loading="lazy" decoding="async">
      <p data-s="scanUpi">Scan with Any UPI App</p>
      <p>UPI ID: <b id="upi-id">khooptong@okicici</b> <button type="button" id="upi-copy">Copy</button></p>
    </div>
    <p class="built">Built and maintained by <a class="lab" href="https://lamkalabs.com" target="_blank" rel="noopener">Lamka <span>Labs</span></a> &middot; <a href="/about">About This Project</a></p>
  </div>
</footer>
<script src="/footer.js"></script>`;
