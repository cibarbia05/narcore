#requires -Version 5.1
<#
.SYNOPSIS
  One-shot health check for the Narcore local infra (Redis + embedding sidecar).

.DESCRIPTION
  Verifies the two containerized dependencies are actually serving:
    1. Redis      -> `redis-cli ping` returns PONG (via `docker exec narcore-redis`)
    2. Embedding  -> GET /health is OK, and POST /v1/embeddings returns a 768-length vector

  Prints PASS/FAIL per service and exits non-zero if anything fails — safe to wire into
  a pre-demo smoke check. No external tools (jq/curl) required.

.PARAMETER EmbeddingUrl
  The OpenAI-compatible embeddings endpoint. Defaults to the docker-compose mapping.

.EXAMPLE
  pwsh ./scripts/health-check.ps1
#>
[CmdletBinding()]
param(
  [string]$EmbeddingUrl = "http://localhost:8080/v1/embeddings",
  [string]$RedisContainer = "narcore-redis",
  [int]$ExpectedDim = 768
)

$ErrorActionPreference = "Stop"
$failures = 0

function Write-Pass([string]$msg) { Write-Host "  PASS  $msg" -ForegroundColor Green }
function Write-Fail([string]$msg) { Write-Host "  FAIL  $msg" -ForegroundColor Red }

Write-Host "Narcore health check" -ForegroundColor Cyan
Write-Host ("=" * 40)

# 1. Redis -------------------------------------------------------------------
Write-Host "`n[redis]"
try {
  $pong = (& docker exec $RedisContainer redis-cli ping 2>&1 | Out-String).Trim()
  if ($pong -eq "PONG") {
    Write-Pass "redis-cli ping -> PONG"
  } else {
    Write-Fail "redis-cli ping -> '$pong' (expected PONG)"
    $failures++
  }
} catch {
  Write-Fail "could not reach container '$RedisContainer': $($_.Exception.Message)"
  $failures++
}

# 2. Embedding sidecar -------------------------------------------------------
Write-Host "`n[embedding]"
$healthUrl = ($EmbeddingUrl -replace "/v1/embeddings/?$", "") + "/health"
try {
  Invoke-RestMethod -Uri $healthUrl -TimeoutSec 10 -Method Get | Out-Null
  Write-Pass "GET $healthUrl -> ok"
} catch {
  Write-Fail "GET $healthUrl -> $($_.Exception.Message)"
  $failures++
}

try {
  $body = @{
    model = "nomic-embed-text-v2-moe"
    input = @("search_query: blue m30 hmu telegram")
  } | ConvertTo-Json -Compress
  $resp = Invoke-RestMethod -Uri $EmbeddingUrl -Method Post -TimeoutSec 30 `
    -ContentType "application/json" -Body $body
  $len = @($resp.data[0].embedding).Count
  if ($len -eq $ExpectedDim) {
    Write-Pass "POST /v1/embeddings -> $len-dim vector"
  } else {
    Write-Fail "POST /v1/embeddings -> $len-dim vector (expected $ExpectedDim)"
    $failures++
  }
} catch {
  Write-Fail "POST $EmbeddingUrl -> $($_.Exception.Message)"
  $failures++
}

# Summary --------------------------------------------------------------------
Write-Host "`n$("=" * 40)"
if ($failures -eq 0) {
  Write-Host "ALL CHECKS PASSED" -ForegroundColor Green
  exit 0
} else {
  Write-Host "$failures CHECK(S) FAILED" -ForegroundColor Red
  exit 1
}
