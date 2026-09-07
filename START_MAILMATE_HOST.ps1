param([switch]$NoBrowser)

$ErrorActionPreference = "Stop"

if (-not (Test-Path ".\app.py")) {
    Write-Host "Run this from the Mailmate repository root." -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "Mailmate host startup" -ForegroundColor Cyan
Write-Host "---------------------"

$lmReady = $false
try {
    $res = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:2806/v1/models" -TimeoutSec 2
    $lmReady = ($res.StatusCode -ge 200 -and $res.StatusCode -lt 300)
} catch {}

if ($lmReady) {
    Write-Host "LM Studio: READY on 127.0.0.1:2806" -ForegroundColor Green
} else {
    Write-Host "LM Studio: OFFLINE" -ForegroundColor Yellow
    Write-Host "Open LM Studio and start its Local API Server on port 2806." -ForegroundColor Yellow
    Write-Host "Kyle Work will pause until that server is running."
}

$workerListening = Get-NetTCPConnection -LocalPort 2810 -State Listen -ErrorAction SilentlyContinue
if (-not $workerListening) {
    Write-Host "Starting teammate compute worker on :2810..." -ForegroundColor Cyan
    Start-Process powershell.exe -ArgumentList @(
        "-NoExit",
        "-Command",
        "Set-Location -LiteralPath '$((Get-Location).Path)'; py -m services.remote_worker_server"
    )
} else {
    Write-Host "Remote worker: already listening on :2810" -ForegroundColor Green
}

$appListening = Get-NetTCPConnection -LocalPort 5000 -State Listen -ErrorAction SilentlyContinue
if (-not $appListening) {
    Write-Host "Starting Flask backend on :5000..." -ForegroundColor Cyan
    Start-Process powershell.exe -ArgumentList @(
        "-NoExit",
        "-Command",
        "Set-Location -LiteralPath '$((Get-Location).Path)'; py app.py"
    )
} else {
    Write-Host "Flask backend: already listening on :5000" -ForegroundColor Green
}

Start-Sleep -Seconds 2
if (-not $NoBrowser) {
    Start-Process "http://localhost:5000/dashboard.html"
}

Write-Host ""
Write-Host "Mailmate       http://localhost:5000"
Write-Host "LM Studio      http://127.0.0.1:2806"
Write-Host "Team worker    http://192.168.137.1:2810"
Write-Host ""
Write-Host "Teammates only need to connect to Priyam's hotspot." -ForegroundColor Green
