// Shared embedding-model constants. Tiny and dependency-free so both the
// server embedding client and the UI-importable scoring module can use it
// without pulling network code into the client bundle.

export const EMBEDDING_DIM = 768; // nomic-embed-text-v2-moe (Matryoshka-reducible to 256)
export const EMBEDDING_MODEL =
  process.env.EMBEDDING_MODEL ?? "nomic-embed-text-v2-moe";
export const MODEL_VERSION = `${EMBEDDING_MODEL}@${EMBEDDING_DIM}`;

/** Nomic task-instruction prefixes — REQUIRED, or similarity is subtly wrong.
 *  Stored corpus text is a "document"; a caption being scored is a "query". */
export const EMBED_PREFIX = {
  document: "search_document: ",
  query: "search_query: ",
} as const;
