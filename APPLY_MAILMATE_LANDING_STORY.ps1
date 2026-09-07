param(
  [string]$SourceRef = "origin/main"
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Step([string]$Message) {
  Write-Host ""
  Write-Host "==> $Message" -ForegroundColor Cyan
}

if (-not (Test-Path -LiteralPath ".\app.py")) {
  throw "Run this script from the MailMate repository root."
}

$files = @(
  "index.html",
  "styles.css",
  "script.js",
  "landing.css",
  "landing.js",
  "dashboard.html",
  "dashboard.css",
  "dashboard.js",
  "kyle.js",
  "kyle-ui.js",
  "kyle-canvas.js",
  "kyle-drag.js",
  "services/google_service.py",
  "tests/test_landing_story.py",
  "tests/test_dashboard_markup.py",
  "tests/test_google_message.py"
)

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$backupRoot = Join-Path ".mailmate-patch-backups" "landing-$stamp"
New-Item -ItemType Directory -Force -Path $backupRoot | Out-Null

Step "Backing up the current landing files"
foreach ($file in $files) {
  if (-not (Test-Path -LiteralPath $file)) { continue }
  $destination = Join-Path $backupRoot $file
  $parent = Split-Path -Parent $destination
  if ($parent) { New-Item -ItemType Directory -Force -Path $parent | Out-Null }
  Copy-Item -LiteralPath $file -Destination $destination -Force
}

Step "Fetching the reviewed landing patch"
git fetch origin --prune
if ($LASTEXITCODE -ne 0) { throw "Could not fetch origin." }

git cat-file -e "$SourceRef`:index.html"
if ($LASTEXITCODE -ne 0) { throw "Source ref '$SourceRef' does not contain the landing patch." }

git checkout $SourceRef -- @files
if ($LASTEXITCODE -ne 0) { throw "Could not apply the landing files from '$SourceRef'." }

Step "Validating the patch"
node --check script.js
if ($LASTEXITCODE -ne 0) { throw "script.js syntax check failed." }
node --check landing.js
if ($LASTEXITCODE -ne 0) { throw "landing.js syntax check failed." }
node --check dashboard.js
if ($LASTEXITCODE -ne 0) { throw "dashboard.js syntax check failed." }
node --check kyle.js
if ($LASTEXITCODE -ne 0) { throw "kyle.js syntax check failed." }
node --check kyle-ui.js
if ($LASTEXITCODE -ne 0) { throw "kyle-ui.js syntax check failed." }
python -m pytest tests/test_landing_story.py tests/test_dashboard_markup.py tests/test_google_message.py -q
if ($LASTEXITCODE -ne 0) { throw "MailMate patch tests failed." }
git diff --check
if ($LASTEXITCODE -ne 0) { throw "Whitespace validation failed." }

Write-Host ""
Write-Host "MailMate production patch applied successfully." -ForegroundColor Green
Write-Host "Backup: $backupRoot" -ForegroundColor DarkGray
Write-Host "Review the changes, then commit them on your branch." -ForegroundColor DarkGray
