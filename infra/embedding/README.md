# Embedding sidecar (WT-C)

llama.cpp serving **`nomic-embed-text-v2-moe`** on an **OpenAI-compatible
`POST /v1/embeddings`** endpoint, returning **768-dim, L2-normalized** vectors with
**mean pooling**. This is the real embedding provider behind `src/lib/embeddings.ts`;
if it is unavailable the app degrades to a hosted endpoint, then deterministic mock
vectors, so the demo never dies.

There is **no Dockerfile** here — we run the prebuilt `ghcr.io/ggml-org/llama.cpp:server`
image and pass flags via `command:` in `docker-compose.yml` (its ENTRYPOINT is
`/app/llama-server`). The model GGUF is auto-downloaded on first boot and cached in the
`llama-models` Docker volume.

## One-command bring-up (Windows + Docker Desktop / WSL2)

```powershell
# from the repo root
docker compose up -d            # starts Redis + the embedding sidecar
```

First boot downloads the model (~490 MB Q8_0) — give it a minute. Watch progress / readiness:

```powershell
docker compose logs -f embedding     # follow the download + "server is listening" line
docker compose ps                    # embedding -> "healthy" once ready
```

> Docker Desktop (WSL2 backend) must be running before `docker compose up`.

## Verify (standalone — no app needed)

```bash
curl -s http://localhost:8080/health

curl -s http://localhost:8080/v1/embeddings \
  -H "content-type: application/json" \
  -d '{"model":"nomic-embed-text-v2-moe","input":["search_query: blue m30 hmu telegram"]}' \
  | jq '.data[0].embedding | length'      # -> 768
```

On Windows you can instead run the bundled check (pings Redis + asserts a 768-length vector):

```powershell
pwsh ./scripts/health-check.ps1
```

## Integration handoff (WT-B)

Point the app at this sidecar with **one env var** (in `.env.local`):

```
EMBEDDING_API_URL=http://localhost:8080/v1/embeddings
```

Optional: `EMBEDDING_MODEL=nomic-embed-text-v2-moe` (already the default). No other wiring —
the app's `embeddings.ts` already speaks this exact wire contract.

## Wire contract (what this server must satisfy)

```
Request:  { "model": "nomic-embed-text-v2-moe", "input": ["...", "..."] }
Response: { "data": [ { "embedding": [<768 floats>], "index": 0 }, ... ] }
```

- **768 dimensions, FLOAT32**, L2-normalized (ideal for the Redis `COSINE` index).
- **The app applies the `search_document:` / `search_query:` task prefixes itself.** This
  server must **not** add prefixes — it embeds the strings it receives verbatim. Mean
  pooling over the raw (already-prefixed) text is exactly what Nomic expects.

## Model pin & the pooling-assert bug

- Repo: **`ggml-org/Nomic-Embed-Text-V2-GGUF`**. It contains exactly one GGUF —
  **`nomic-embed-text-v2-moe-q8_0.gguf`** (Q8_0, ~488 MB) — which `--hf-file` pins
  deterministically. Q8_0 is near-lossless; embedding similarity is precision-sensitive.
- Use the **ggml-org** build specifically: it carries the GGUF conversion fix for the known
  v2-MoE pooling assert bug (`GGML_ASSERT(pc_type == ...) failed`,
  ggml-org/llama.cpp [#13534](https://github.com/ggml-org/llama.cpp/issues/13534) /
  [#13689](https://github.com/ggml-org/llama.cpp/pull/13689)). Combined with `--pooling mean`,
  the OpenAI `/v1/embeddings` endpoint (which requires a non-`none` pooling type) works.

### If your network blocks huggingface.co (offline / air-gapped / restricted)

`-hf` needs to reach `huggingface.co` on first boot. If that host is blocked (or the
container has no DNS), download the GGUF elsewhere and **mount it** instead of using `-hf`:

```powershell
# on a host that can reach HF (or an HF mirror), into any folder:
curl.exe -L -o nomic-embed-text-v2-moe-q8_0.gguf `
  https://huggingface.co/ggml-org/Nomic-Embed-Text-V2-GGUF/resolve/main/nomic-embed-text-v2-moe-q8_0.gguf
```

Then in `docker-compose.yml`, replace the `-hf … --hf-file …` lines with a bind-mount + `-m`:

```yaml
    volumes:
      - ./models:/models:ro            # put the .gguf in ./models
    command: >
      -m /models/nomic-embed-text-v2-moe-q8_0.gguf
      --embeddings --pooling mean --host 0.0.0.0 --port 8080
      -c 2048 -b 2048 -ub 2048
```

This is exactly how the 768-dim DoD was verified in a HF-blocked environment. (An HF mirror
via `HF_ENDPOINT` is **not** a reliable workaround — this llama.cpp build's `-hf` downloader
does not honor it.)

## CPU vs GPU

- **CPU (default)** — `ghcr.io/ggml-org/llama.cpp:server`. Plenty fast for short captions.
- **GPU (optional, faster)** — use `:server-cuda` and reserve the GPU:

  ```yaml
  embedding:
    image: ghcr.io/ggml-org/llama.cpp:server-cuda
    # ...same command/ports/healthcheck...
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: all
              capabilities: [gpu]
  ```

  Requires the NVIDIA Container Toolkit + Docker Desktop GPU support.

## Fallback chain (why the demo is resilient)

`src/lib/embeddings.ts` resolves providers in order, controlled by `EMBEDDING_MODE`
(default `auto`):

1. **Self-host** — `EMBEDDING_API_URL` (this sidecar), optional `EMBEDDING_API_KEY`.
2. **Hosted** — `NOMIC_API_URL` + `NOMIC_API_KEY` (any OpenAI-compatible nomic endpoint).
3. **Deterministic mock** — normalized vectors keyed on the raw text, so the full
   pipeline (seed → ingest → KNN → score → drift) runs end-to-end with no sidecar at all.

So a flaky sidecar never breaks the demo — but for the real semantic-search story, keep
llama.cpp up.

### Ollama drop-in alternative

If the llama.cpp image gives trouble, Ollama is an acceptable swap (also OpenAI-compatible):
`ollama pull nomic-embed-text-v2-moe`, serves `/v1/embeddings` on `:11434`. Set
`EMBEDDING_API_URL=http://localhost:11434/v1/embeddings`. The app is unchanged either way.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `docker compose up` errors immediately | Docker Desktop (WSL2) not running — start it first. |
| `embedding` stuck "starting" for a few minutes | First-boot model download. Watch `docker compose logs -f embedding`; `start_period` (300s) prevents false `unhealthy`. |
| `embedding` → `unhealthy` after start | `docker compose logs embedding`. If it's the pooling assert, confirm the **ggml-org** repo + `--pooling mean`; see the model-pin section. |
| Bind for `0.0.0.0:8080` fails | Port 8080 in use. Free it or remap the host side (`"8081:8080"`) and set `EMBEDDING_API_URL` to match. |
| Verify curl returns a length ≠ 768 | Wrong model/quant or pooling — re-check the `command:` flags. |
| Re-download every boot | The `llama-models` volume was removed. `docker volume ls` should list `*_llama-models`. |

## Definition of Done

`docker compose up` brings up Redis **and** the embedding sidecar; the verify curl above
returns **768**; `EMBEDDING_API_URL=http://localhost:8080/v1/embeddings` is handed to WT-B.
