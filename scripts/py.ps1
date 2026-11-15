# Run Python for FloorProof.
# Uses native Windows Python (.venv) if Relate loads there, else WSL2 Ubuntu.
# Example: .\scripts\py.ps1 scripts/seed.py
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$argLine = ($args | ForEach-Object { if ($_ -match '\s') { "'$_'" } else { $_ } }) -join ' '

$winPy = Join-Path $root ".venv\Scripts\python.exe"
if ((Test-Path $winPy) -and -not $env:FLOORPROOF_FORCE_WSL) {
    & $winPy -c "import relate" 2>$null
    if ($LASTEXITCODE -eq 0) {
        Push-Location $root
        try { & $winPy @args; exit $LASTEXITCODE } finally { Pop-Location }
    }
}

$distro = if ($env:FLOORPROOF_WSL_DISTRO) { $env:FLOORPROOF_WSL_DISTRO } else { "Ubuntu" }
$wslRoot = (wsl -d $distro -- wslpath -a ($root -replace '\\', '/')).Trim()
wsl -d $distro --cd $wslRoot -- bash -lc "~/.venvs/floorproof/bin/python $argLine"
exit $LASTEXITCODE
