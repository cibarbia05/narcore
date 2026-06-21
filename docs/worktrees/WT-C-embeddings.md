# WT-C — Infra + Embedding Sidecar

> Read `SPEC.md` §3.3 and §5.4. You provide the real embedding service; the app's
> `src/lib/embeddings.ts` already speaks the OpenAI-compatible contract and falls back to
> hosted/mock, so you can develop and verify entirely standalone with `curl`.

## Scope & owned files

```
docker-compose.yml          # SOLE editor — fill in the commented `embedding` service
infra/embedding/            # NEW — Dockerfile (if building), README (Windows bring-up), notes
infra/embedding/README.md   # NEW — one-command bring-up + troubleshooting + fallback docs
scripts/health-check.ps1    # NEW (optional) — curls Redis + /v1/embeddings, prints status
```

Do **not** edit app code. The only integration point is the env var `EMBEDDING_API_URL` (WT-B
sets it) and the wire contract below.

## The contract you must satisfy

`POST $EMBEDDING_API_URL` (default `http://localhost:8080/v1/embeddings`):

```
Request:  { "model": "nomic-embed-text-v2-moe", "input": ["search_query: ...", "search_document: ..."] }
Response: { "data": [ { "embedding": [<768 floats>], "index": 0 }, ... ] }
```

- **768 dimensions**, FLOAT32. The app validates length === 768.
- **The app applies the `search_document:` / `search_query:` prefixes** — your server must NOT
  add prefixes. Just embed the strings it receives.

## Recommended recipe: llama.cpp server via docker-compose

Replace the commented block in `docker-compose.yml`. The `llama-server` `-hf` flag
auto-downloads the GGUF on first boot (cache to a volume):

```yaml
  embedding:
    image: ghcr.io/ggml-org/llama.cpp:server          # CPU build; or :server-cuda for GPU
    container_name: narcore-embedding
    ports:
      - "8080:8080"
    command: >
      -hf ggml-org/Nomic-Embed-Text-V2-GGUF
      --embeddings --pooling mean
      --host 0.0.0.0 --port 8080
      -c 2048 -b 2048 -ub 2048
    volumes:
      - llama-models:/root/.cache/llama.cpp
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8080/health"]
      interval: 10s
      timeout: 5s
      retries: 12
```

Add `llama-models:` under the top-level `volumes:`.

**Pin the model file.** Confirm the exact filename on
<https://huggingface.co/ggml-org/Nomic-Embed-Text-V2-GGUF> and, if `-hf <repo>` doesn't resolve a
default, pass `--hf-file <name>` (e.g. a `Q8_0` or `f16` quant). Prefer the **ggml-org** repo —
it carries the conversion fix for the known v2-MoE pooling assert bug
(ggml-org/llama.cpp #13534/#13689). `nomic-ai/nomic-embed-text-v2-moe-GGUF` is the fallback repo.

> The OpenAI-compatible `/v1/embeddings` endpoint requires a non-`none` pooling type — we use
> `--pooling mean`. (`/embedding` also exists but `/v1/embeddings` is what the app calls.)

## Verify (standalone, no app needed)

```bash
docker compose up -d embedding
curl -s http://localhost:8080/health
curl -s http://localhost:8080/v1/embeddings \
  -H "content-type: application/json" \
  -d '{"model":"nomic-embed-text-v2-moe","input":["search_query: blue m30 hmu telegram"]}' \
  | jq '.data[0].embedding | length'      # -> 768
```

## Windows notes

- Docker Desktop (WSL2 backend) must be running before `docker compose up`.
- CPU is fine for embeddings; GPU (`:server-cuda` + `--gpus all`) is optional and faster.
- First boot downloads the model (hundreds of MB) — the volume caches it for later runs.
- If the llama.cpp image/flags give trouble, an Ollama service (`ollama` image,
  `ollama pull nomic-embed-text-v2-moe`, OpenAI-compatible `/v1/embeddings` on :11434) is an
  acceptable drop-in — set `EMBEDDING_API_URL` accordingly. Either way the app is unchanged.

## Fallback documentation (put in README)

The app degrades gracefully: if the sidecar is unreachable it tries a hosted endpoint
(`NOMIC_API_URL`/`NOMIC_API_KEY`), then deterministic mock vectors (`EMBEDDING_MODE=auto`). So a
flaky sidecar never breaks the demo — but for the real semantic-search story, get llama.cpp up.

## Definition of Done

`docker compose up` brings up Redis **and** the embedding sidecar; the `curl` above returns
`768`; `infra/embedding/README.md` documents one-command bring-up, the model pin, GPU/CPU, and
the fallback. Hand WT-B the `EMBEDDING_API_URL` value.
