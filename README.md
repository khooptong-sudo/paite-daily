# Paite Daily

**A free, volunteer-checked corpus of Paite, built one sentence at a time.**

Live at **[paite.lamkalabs.com](https://paite.lamkalabs.com)** · Data at **[paite-open-language-data](https://github.com/khooptong-sudo/paite-open-language-data)** · Cite with DOI **[10.5281/zenodo.23349155](https://doi.org/10.5281/zenodo.23349155)**

Paite Daily is a website where people who speak Paite translate everyday sentences between Paite and English, read checked Paite lines aloud, and share their sayings and words. A second speaker checks every contribution before it goes on the site. Every night, the checked sentences and recordings are copied to an open dataset that anyone can use.

No computer writes the Paite here. Every line was written by one person and checked by another.

## About the Paite language

Paite (ISO 639-3 `pck`, Glottolog `pait1244`) is an independent Tibeto-Burman language. Most speakers live in Churachandpur district, Manipur, India, where Lamka is the main town; there are also Paite communities in Mizoram and Assam, and Paite families in Myanmar.

- **78,725** people gave Paite as their mother tongue in the 2011 Census of India.
- **1903:** T. Vialphung made the Paite alphabet (*Paite Laimal*).
- **1993, 2003, 2014:** editions of the Paite Tribe Council's *English–Paite Dictionary*.
- **2004:** Manipur University made Paite a subject in its three-year degree course.
- **2006:** Naorem Saratchandra Singh's *A Grammar of Paite*, still the only full grammar book.
- All India Radio Imphal broadcasts in Paite every day.
- The Endangered Languages Project and Glottolog list Paite as *vulnerable*, with low certainty.

Paite is well written down, but phones and computers do not support it: there is no spellchecker, no predictive keyboard and no translation tool. Those tools are built from many sentences written in two languages side by side. Paite Daily gathers those sentences.

## What you can do on the site

- **Translate a sentence.** One everyday line at a time, English to Paite or Paite to English. You say whether your answer is how people talk (*Gen Thoh*), how people write (*Gelh Thoh*), or both (*Anih In*). No account needed.
- **Read a line aloud (*Aw in Aw*).** Record yourself reading a checked Paite line. A reviewer listens before anyone else hears it.
- **Share a saying (*Pau Upa*).** Proverbs and idioms, in either direction, with what they mean.
- **Add a word.** Words and meanings for the word list, *Paite Kammal Kaihkhawm*, which you can browse one letter at a time.
- **Chat (*Paite Pau In*).** Type an English line and get the checked Paite line that means the same, if there is one.
- **See it grow.** A woven shawl (*Siamsin Puan*) gains one thread for every checked sentence, and the contributors' wall (*Panlate*) thanks everyone by name.

The site works as an app on any phone (it can be installed from the browser), and there is an Android app as well.

## How a contribution is checked

1. **You send it.** A quick check stops robots.
2. **A reviewer checks it** against the original. Reviewers never check their own submissions; those go to someone else.
3. **It joins the collection.** Only approved lines appear on the site or go into the dataset.

## Where AI helps, and where it does not

The site uses an AI model (DeepSeek) for a few support jobs: suggesting new everyday English sentences to translate, leaving reviewers an optional note, the "Check English" button, picking word-list candidates out of contributors' notes for reviewers to confirm, and matching your English to a checked Paite line in the chat. **It never writes, corrects or approves Paite.**

## Privacy

Visits are counted by the site itself: no cookies, no outside companies, no IP addresses stored. Each visitor is counted with a code that changes every day, so nobody can be followed from one day to the next. Browsers that ask not to be tracked are not counted. Rare values (a town, a phone model, a network) are shown only once two or more people share them. Raw visits are deleted after 30 days. The full statement is on the [About page](https://paite.lamkalabs.com/about).

## The open data

Every night the site copies newly checked sentences and recordings to [paite-open-language-data](https://github.com/khooptong-sudo/paite-open-language-data). It is mirrored on [Hugging Face](https://huggingface.co/datasets/LamkaLabs/paite-open-language-data) every Monday, and released with a DOI on [Zenodo](https://doi.org/10.5281/zenodo.23349155).

| Part | Terms |
|------|-------|
| Checked sentences sent before 21 Oct 2026, 18:47 UTC | CC0 1.0 (no conditions) |
| Checked sentences sent since then | CC BY 4.0 (give credit) |
| Voice recordings | CC BY 4.0 (each speaker agreed before recording) |

Each exported line carries its own `licence` field. Credit "Paite Open Language Data, Lamka Labs", or cite the DOI.

## How it is built

- A [Cloudflare Worker](https://developers.cloudflare.com/workers/) written in TypeScript, with D1 (SQLite) for data, R2 for files, Turnstile against bots, and Workers AI with Vectorize for search.
- Plain HTML, CSS and JavaScript pages, light and dark themes, installable as a Progressive Web App; the Android app is a Trusted Web Activity.
- Database changes are numbered migrations in `migrations/`; tests use Vitest with the Workers test pool.

To run the tests:

```bash
npm install
npm test
```

Running your own copy needs your own Cloudflare account, a D1 database and the secrets listed in `src/types.ts`.

## Who runs this

Min Khooptong ([Lamka Labs](https://lamkalabs.com)) builds and looks after Paite Daily from Lamka, with volunteer reviewers. It has no funding and no advertising, and never will carry ads. If you would like to help with running costs, there is a UPI code at the bottom of every page. Write to theconcierge@lamkalabs.com.

## References

- Saratchandra Singh, Naorem. 2006. *A Grammar of Paite*. New Delhi: Mittal Publications.
- Paite Tribe Council. 1993, 2003, 2014. *English–Paite Dictionary*. Lamka, Manipur.
- Thuamkhopau, T. 2009. *Paite paunaak leh pau upate*.
- Census of India 2011, language tables (Paite, `pck`).
- [Glottolog: Paite (pait1244)](https://glottolog.org/resource/languoid/iso/pck).

## Licence

The code is dual-licensed: use it under either the [MIT licence](LICENSE-MIT) or the [Apache License 2.0](LICENSE-APACHE), whichever you prefer (SPDX: `MIT OR Apache-2.0`). Unless you say otherwise, any contribution you send is offered under the same two licences. The collected data is not covered by these files; see the table above.
