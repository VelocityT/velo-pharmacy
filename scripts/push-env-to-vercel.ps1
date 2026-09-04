# Push .env to Vercel - Production + Preview
#
# Use this instead of pasting into the dashboard. Values pasted into
# Vercel's web UI can silently fail to save (the key gets created, the
# value stays blank) - which is exactly the failure this project hit.
# The CLI writes the value directly and reads it back, so there is no
# ambiguity.
#
# ASCII only, on purpose. PowerShell 5 reads .ps1 files as the system
# ANSI codepage, so box-drawing characters in comments corrupt the
# parser and produce a bogus "string is missing the terminator" error
# tens of lines further down.
#
# Run from the repository root:
#     powershell -ExecutionPolicy Bypass -File scripts\push-env-to-vercel.ps1

$ErrorActionPreference = "Stop"

if (-not (Test-Path ".env")) {
    Write-Host "  No .env found at the repository root." -ForegroundColor Red
    Write-Host "  Run this from D:\Velocare-pharmacy" -ForegroundColor Red
    exit 1
}

if (-not (Get-Command vercel -ErrorAction SilentlyContinue)) {
    Write-Host "  Installing Vercel CLI..." -ForegroundColor Cyan
    npm i -g vercel
}

Write-Host ""
Write-Host "  Sign in and link the project (skipped if already done)" -ForegroundColor Cyan
vercel login
vercel link

# Only these get pushed. Anything else in .env stays local.
$keys = @(
    "NODE_MODE", "NODE_KEY",
    "DATABASE_URL", "DIRECT_URL",
    "JWT_SECRET", "JWT_EXPIRES_IN",
    "SYNC_ENABLED", "SEQUENCE_BLOCK_SIZE"
)

# Parse .env, honouring quoted values (connection strings are quoted
# because they contain ? and &).
$vars = @{}
foreach ($line in Get-Content ".env") {
    $t = $line.Trim()
    if ($t -eq "" -or $t.StartsWith("#")) { continue }
    $i = $t.IndexOf("=")
    if ($i -lt 1) { continue }
    $k = $t.Substring(0, $i).Trim()
    $v = $t.Substring($i + 1).Trim().Trim('"').Trim("'")
    if ($k -and $v) { $vars[$k] = $v }
}

Write-Host ""
Write-Host "  Pushing to Production and Preview" -ForegroundColor Cyan
Write-Host "  ------------------------------------------------------"

foreach ($k in $keys) {
    if (-not $vars.ContainsKey($k)) {
        Write-Host ("  SKIP  {0,-22} not in .env" -f $k) -ForegroundColor DarkGray
        continue
    }

    $v = $vars[$k]

    foreach ($target in @("production", "preview")) {
        # Remove first - `vercel env add` refuses to overwrite, and a
        # blank existing value is precisely what we are replacing.
        vercel env rm $k $target --yes 2>$null | Out-Null
        $v | vercel env add $k $target 2>$null | Out-Null
    }

    Write-Host ("  OK    {0,-22} {1} chars" -f $k, $v.Length) -ForegroundColor Green
}

Write-Host ""
Write-Host "  Verifying what Vercel actually stored:" -ForegroundColor Cyan
vercel env pull ".env.vercel-check" --environment=production --yes | Out-Null

if (Test-Path ".env.vercel-check") {
    foreach ($k in $keys) {
        $line = Select-String -Path ".env.vercel-check" -Pattern "^$k=" -ErrorAction SilentlyContinue
        if (-not $line) {
            Write-Host ("  MISSING  {0}" -f $k) -ForegroundColor Red
        }
        else {
            $val = ($line.Line -split "=", 2)[1].Trim('"')
            if ($val.Length -eq 0) {
                Write-Host ("  EMPTY    {0}   still blank" -f $k) -ForegroundColor Red
            }
            else {
                Write-Host ("  ok       {0,-22} {1} chars" -f $k, $val.Length) -ForegroundColor Green
            }
        }
    }
    # Contains real secrets - do not leave it on disk.
    Remove-Item ".env.vercel-check" -Force
}

Write-Host ""
Write-Host "  Now redeploy - Vercel only injects env vars at deploy time:" -ForegroundColor Yellow
Write-Host "      vercel --prod"
Write-Host ""
