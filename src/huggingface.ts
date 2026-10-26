import { allVerifiedLines, toBase64Utf8 } from "./export";
import { wordCounts, wordsTsv } from "./keyboard";
import type { Env } from "./types";

// Weekly mirror to the Hugging Face dataset. Only community/ is written: the dataset card
// (README.md), training/ and eval/ belong to paite_corpus/scripts/publish_hf.py. One commit
// replaces the three files, so the folder always matches the site.

export const DEFAULT_REPO = "LamkaLabs/paite-open-language-data";

export function communityCard(pairs: number, words: number, date: string): string {
  return `# Paite Daily: community translations

Every Paite–English pair verified on [Paite Daily](https://paite.lamkalabs.com), refreshed each week. Updated ${date}: ${pairs} verified pairs, ${words} distinct Paite words.

- \`paite-daily.jsonl\`: one verified pair per line. \`direction\` is \`en2pai\` (an English sentence translated into Paite) or \`pai2en\` (a Paite line translated into English, with the round-trip \`original_english\`). \`paite\` is the reviewer's final text: a reviewer's correction always stands over the submission. \`also_correct\` lists other accepted renderings.
- \`paite-words.tsv\`: every Paite word in verified sentences and the word list, with how often it appears, most used first.

One native speaker wrote each line and another approved it; nothing is machine-generated. Licence: CC BY 4.0, credit "Paite Daily contributors". The same files, split by review range, are in the GitHub corpus under \`community/\`.
`;
}

/** Builds the files and commits them in one go. Returns null when there is no token. */
export async function runHuggingFace(env: Env, fetcher: typeof fetch, now: number): Promise<{ pairs: number; words: number } | null> {
  if (!env.HF_TOKEN) return null;
  const repo = env.HF_REPO || DEFAULT_REPO;
  const lines = await allVerifiedLines(env);
  const words = await wordCounts(env, now);
  const date = new Date(now).toISOString().slice(0, 10);
  const files: [string, string][] = [
    ["community/paite-daily.jsonl", lines.join("\n") + "\n"],
    ["community/paite-words.tsv", wordsTsv(words)],
    ["community/README.md", communityCard(lines.length, words.length, date)],
  ];
  // The Hub commit API: one NDJSON header line, then one line per file.
  const body = [
    { key: "header", value: { summary: `Paite Daily community: ${lines.length} verified pairs (${date})`, description: "" } },
    ...files.map(([path, text]) => ({ key: "file", value: { path, content: toBase64Utf8(text), encoding: "base64" } })),
  ].map((x) => JSON.stringify(x)).join("\n");
  const res = await fetcher(`https://huggingface.co/api/datasets/${repo}/commit/main`, {
    method: "POST",
    headers: { authorization: `Bearer ${env.HF_TOKEN}`, "content-type": "application/x-ndjson" },
    body,
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`Hugging Face commit ${res.status}`);
  return { pairs: lines.length, words: words.length };
}
