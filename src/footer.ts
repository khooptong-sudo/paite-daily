// The page footer, shared by the server-rendered pages (/contributors, /glossary).
// The front page keeps its own copy in public/index.html. The reviewer page has no footer.
// `data-s` keys come from public/strings.js; the English text here is the fallback, since these
// pages only replace it when the owner has filled in a Paite translation.
export const FOOTER = `
<footer class="foot">
  <p>Built and maintained by <a class="lab" href="https://lamkalabs.com" target="_blank" rel="noopener">Lamka <span>Labs</span></a>.</p>
  <p class="contact"><a class="mail" href="mailto:theconcierge@lamkalabs.com" aria-label="Email theconcierge@lamkalabs.com" title="Email theconcierge@lamkalabs.com"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2.6" y="4.8" width="18.8" height="14.4" rx="2.6"></rect><path d="M3.5 6.6 12 13.4 20.5 6.6"></path></svg></a> <a class="wa" href="https://wa.me/918375098415" target="_blank" rel="noopener" aria-label="Message Lamka Labs on WhatsApp" title="Message Lamka Labs on WhatsApp"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2.7a9.3 9.3 0 0 0-8 14L2.7 21.3l4.6-1.3A9.3 9.3 0 1 0 12 2.7Z"></path><path d="M9.6 9.3c1.2 3 3.1 4.9 6.1 6.1l.9-.9c.3-.3.8-.4 1.2-.2l1.3.7c.4.2.6.7.4 1.1l-.5 1.1c-.2.5-.7.8-1.2.8-4.8-.4-8.6-4.2-9-9 0-.5.3-1 .8-1.2l1.1-.5c.4-.2.9 0 1.1.4l.7 1.3c.2.4.1.9-.2 1.2l-.9.9Z"></path></svg></a></p>
  <a class="coffee" id="coffee" href="upi://pay?pa=khooptong%40okicici&amp;pn=Min%20Khooptong&amp;cu=INR&amp;tn=Paite%20Daily" aria-expanded="false" aria-controls="upi">&#9749; <span data-s="coffee">Click Here to Buy Us Coffee</span> &#128513;
    <span class="coffee-note" data-s="coffeeNote">Helps cover the AI and server costs, so the data stays free for everyone.</span>
  </a>
  <div class="card" id="upi" hidden>
    <img class="qr" src="/upi-qr.jpg" alt="UPI QR code for Min Khooptong, khooptong@okicici" loading="lazy" decoding="async">
    <p data-s="scanUpi">Scan with any UPI app</p>
    <p>UPI ID: <b id="upi-id">khooptong@okicici</b> <button type="button" id="upi-copy">Copy</button></p>
  </div>
</footer>
<script src="/footer.js"></script>`;
