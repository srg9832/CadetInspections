$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $Root

Write-Host ''
Write-Host 'CAP Uniform Inspection Tracker - PWA Database Upgrade' -ForegroundColor Cyan
Write-Host '------------------------------------------------------' -ForegroundColor Cyan
Write-Host 'This applies the offline-sync database migration and redeploys the'
Write-Host 'administrator Edge Function. It does NOT overwrite config.js.'
Write-Host ''

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    throw 'Node.js 20 or newer is required.'
}

$nodeVersion = (& node -p "process.versions.node.split('.')[0]").Trim()
if ([int]$nodeVersion -lt 20) {
    throw "Node.js 20 or newer is required. Detected Node.js major version $nodeVersion."
}

$ProjectRef = (Read-Host 'Supabase project reference').Trim()
if ($ProjectRef -notmatch '^[a-z]{20}$') {
    throw 'Project reference should be the 20-character ID from your Supabase dashboard URL.'
}

function Invoke-Supabase {
    param([Parameter(ValueFromRemainingArguments=$true)][string[]]$Args)
    & npx --yes supabase@latest @Args
    if ($LASTEXITCODE -ne 0) { throw "Supabase command failed: $($Args -join ' ')" }
}

Write-Host 'Signing in to Supabase CLI...' -ForegroundColor Yellow
Invoke-Supabase login

if (-not (Test-Path (Join-Path $Root 'supabase\config.toml'))) {
    Write-Host 'Initializing Supabase project metadata...' -ForegroundColor Yellow
    Invoke-Supabase init
}

Write-Host 'Linking project...' -ForegroundColor Yellow
Invoke-Supabase link --project-ref $ProjectRef

Write-Host 'Applying new database migration...' -ForegroundColor Yellow
Invoke-Supabase db push

Write-Host 'Redeploying create-user Edge Function...' -ForegroundColor Yellow
Invoke-Supabase functions deploy create-user --project-ref $ProjectRef --no-verify-jwt

Write-Host ''
Write-Host 'PWA DATABASE UPGRADE COMPLETE' -ForegroundColor Green
Write-Host 'Your existing config.js was left unchanged.' -ForegroundColor Green
Write-Host ''
