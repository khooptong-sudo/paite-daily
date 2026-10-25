// The page footer, shared by the server-rendered pages (/about, /contributors, /glossary,
// /proverbs). The front page keeps its own copy in public/index.html, and 404.html and
// 500.html carry a short one. The reviewer page has no footer.
// Order: the coffee button first, then a full-width charcoal band (styles in style.css)
// with the contact icons and the credit line. footer.js draws the waveform in the band.
// `data-s` keys come from public/strings.js; the English text here is the fallback, since these
// pages only replace it when the owner has filled in a Paite translation.
export const FOOTER = `
<footer class="foot">
  <a class="coffee" id="coffee" href="upi://pay?pa=khooptong%40okicici&amp;pn=Min%20Khooptong&amp;cu=INR&amp;tn=Paite%20Daily" aria-expanded="false" aria-controls="upi">&#9749; <span data-s="coffee">Click Here to Buy Us Coffee</span> &#128513;
    <span class="coffee-note" data-s="coffeeNote">Helps cover the AI and server costs, so the data stays free for everyone.</span>
  </a>
  <div class="card" id="upi" hidden>
    <img class="qr" src="/upi-qr.jpg" alt="UPI QR code for Min Khooptong, khooptong@okicici" loading="lazy" decoding="async">
    <p data-s="scanUpi">Scan with any UPI app</p>
    <p>UPI ID: <b id="upi-id">khooptong@okicici</b> <button type="button" id="upi-copy">Copy</button></p>
  </div>
  <div class="reach">
    <canvas class="wave" aria-hidden="true"></canvas>
    <p class="reach-title">Get in touch</p>
    <p class="reach-note">Contact for data, corrections, partnerships, or to volunteer as a reviewer. We treat corrections as data, not as complaints. If a pair is wrong, we fix it at the source.</p>
    <p class="contact"><a class="mail" href="mailto:theconcierge@lamkalabs.com" aria-label="Email theconcierge@lamkalabs.com" title="Email theconcierge@lamkalabs.com"><img src="/mail.png" alt="" width="22" height="22" decoding="async"></a> <a class="wa" href="https://wa.me/918375098415" target="_blank" rel="noopener" aria-label="Message Lamka Labs on WhatsApp" title="Message Lamka Labs on WhatsApp"><img src="/whatsapp.png" alt="" width="22" height="22" decoding="async"></a></p>
    <p class="built">Built and maintained by <a class="lab" href="https://lamkalabs.com" target="_blank" rel="noopener">Lamka <span>Labs</span></a> &middot; <a href="/about">About This Project</a></p>
  </div>
</footer>
<script src="/footer.js"></script>`;
