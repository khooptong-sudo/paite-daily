// The page footer, shared by the server-rendered pages (/contributors, /glossary).
// The front page keeps its own copy in public/index.html. The reviewer page has no footer.
// `data-s` keys come from public/strings.js; the English text here is the fallback, since these
// pages only replace it when the owner has filled in a Paite translation.
export const FOOTER = `
<footer class="foot">
  <p>Built and maintained by <a class="lab" href="https://lamkalabs.com" target="_blank" rel="noopener">Lamka <span>Labs</span></a>.</p>
  <a class="coffee" id="coffee" href="upi://pay?pa=khooptong%40okicici&amp;pn=Min%20Khooptong&amp;cu=INR&amp;tn=Paite%20Daily" aria-expanded="false" aria-controls="upi">&#9749; <span data-s="coffee">Click Here to Buy Us a Coffee</span> &#128513;</a>
  <p class="coffee-note" data-s="coffeeNote">Helps cover the AI and server costs. The data stays free for everyone.</p>
  <p>Contact: <a href="mailto:khooptong@lamkalabs.com">khooptong@lamkalabs.com</a> &#183; <a href="mailto:khooptong@lamka.net">khooptong@lamka.net</a> &#183; <a href="https://wa.me/918375098415" target="_blank" rel="noopener">WhatsApp +91 83750 98415</a></p>
  <div class="card" id="upi" hidden>
    <img class="qr" src="/upi-qr.jpg" alt="UPI QR code for Min Khooptong, khooptong@okicici" loading="lazy" decoding="async">
    <p data-s="scanUpi">Scan with any UPI app</p>
    <p>UPI ID: <b id="upi-id">khooptong@okicici</b> <button type="button" id="upi-copy">Copy</button></p>
  </div>
</footer>
<script src="/footer.js"></script>`;
