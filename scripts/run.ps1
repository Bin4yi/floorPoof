# One command to run FloorProof on Windows:  .\scripts\run.ps1
# Builds the frontend if it is missing or older than its source, builds floorproof.rl if missing, then serves http://localhost:8000
param([switch]$Replay, [int]$Port = 8000)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Push-Location $root
try {
    $dist = "frontend\dist\index.html"
    $stale = -not (Test-Path $dist)
    if (-not $stale) {
        $built = (Get-Item $dist).LastWriteTime
        $stale = [bool](Get-ChildItem frontend\src, frontend\index.html -Recurse -File | Where-Object { $_.LastWriteTime -gt $built })
    }
    if ($stale) {
        Write-Host "Building the frontend..."
        Push-Location frontend
        if (-not (Test-Path node_modules)) { npm install --no-audit --no-fund }
        npm run build
        Pop-Location
    }
    if (-not (Test-Path "floorproof.rl")) { & "$PSScriptRoot\py.ps1" scripts/seed.py }
    if ($Replay) { $env:FLOORPROOF_LLM = "replay" }
    Write-Host "FloorProof on http://localhost:$Port  (Ctrl+C to stop)"
    & "$PSScriptRoot\py.ps1" -m uvicorn backend.api.app:app --host 127.0.0.1 --port $Port
} finally { Pop-Location }
