// Stub so wrangler's `main` resolves; a later task replaces it with the real router.
export default { fetch: () => new Response("not implemented", { status: 501 }) };
