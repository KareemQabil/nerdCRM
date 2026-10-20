# IOETI developer commands for native Windows PowerShell (WSL2 + scripts/ioeti.sh is preferred).
# Usage: .\scripts\ioeti.ps1 <init|db-up|db-down|build|test|run|health>
# NOTE: written to mirror scripts/ioeti.sh; it was not executed on Windows in this phase.
param([Parameter(Mandatory = $true)][string]$Command)
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$App = Join-Path $Root "axelor-app"
$Modules = @("ioeti-core", "ioeti-business-lines", "ioeti-commercial", "ioeti-training", "ioeti-certification", "ioeti-recruitment", "ioeti-fundraising", "ioeti-operations")
$Compose = @("compose", "--env-file", (Join-Path $Root ".env"), "-f", (Join-Path $Root "infra/docker-compose.yml"))

function New-Secret { -join ((48..57) + (65..90) + (97..122) | Get-Random -Count 24 | ForEach-Object { [char]$_ }) }

function Read-Env {
  $envFile = Join-Path $Root ".env"
  if (-not (Test-Path $envFile)) { throw "Missing .env - run: .\scripts\ioeti.ps1 init" }
  $vars = @{}
  Get-Content $envFile | Where-Object { $_ -match "^[A-Z_]+=" } | ForEach-Object {
    $k, $v = $_ -split "=", 2; $vars[$k] = $v
  }
  if (-not [IO.Path]::IsPathRooted($vars["IOETI_DATA_DIR"])) { $vars["IOETI_DATA_DIR"] = (Join-Path $Root $vars["IOETI_DATA_DIR"]) -replace "\\", "/" }
  $vars["IOETI_LOG_DIR"] = (Join-Path $Root "logs") -replace "\\", "/"
  return $vars
}

function Write-Config($vars) {
  New-Item -ItemType Directory -Force -Path (Join-Path $Root ".local"), (Join-Path $Root "logs") | Out-Null
  $text = Get-Content -Raw (Join-Path $Root "infra/axelor/axelor-config.ioeti.template.properties")
  foreach ($k in $vars.Keys) { $text = $text.Replace("@@$k@@", $vars[$k]) }
  Set-Content -NoNewline -Encoding UTF8 -Path (Join-Path $Root ".local/axelor-config.local.properties") -Value $text
}

function Link-Modules {
  foreach ($m in $Modules) {
    $link = Join-Path $App "modules/$m"
    if (-not (Test-Path $link)) {
      try { New-Item -ItemType SymbolicLink -Path $link -Target (Join-Path $Root "modules/$m") | Out-Null }
      catch { New-Item -ItemType Junction -Path $link -Target (Join-Path $Root "modules/$m") | Out-Null }
    }
    $exclude = Join-Path $App ".git/info/exclude"
    if (Test-Path $exclude) { if (-not (Select-String -Quiet -Path $exclude -Pattern "^/modules/$m$")) { Add-Content $exclude "/modules/$m" } }
  }
}

switch ($Command) {
  "init" {
    $envFile = Join-Path $Root ".env"
    if (-not (Test-Path $envFile)) {
      (Get-Content (Join-Path $Root ".env.example")) `
        -replace "^IOETI_DB_PASSWORD=.*", "IOETI_DB_PASSWORD=$(New-Secret)" `
        -replace "^IOETI_ENCRYPTION_PASSWORD=.*", "IOETI_ENCRYPTION_PASSWORD=$(New-Secret)" `
        -replace "^IOETI_BANKORDER_ENCRYPTION_PASSWORD=.*", "IOETI_BANKORDER_ENCRYPTION_PASSWORD=$(New-Secret)" |
        Set-Content $envFile
    }
    git -C $Root submodule update --init axelor-app
    git -C $App submodule init
    git -C $App config submodule.axelor-open-suite.url https://github.com/axelor/axelor-open-suite.git
    git -C $App submodule update
    Write-Config (Read-Env); Link-Modules
  }
  "db-up" { docker @Compose up -d postgres }
  "db-down" { docker @Compose stop postgres }
  "build" { Push-Location $App; .\gradlew.bat --max-workers=2 assemble -x archiveReports; Pop-Location }
  "test" { Push-Location $App; .\gradlew.bat --max-workers=2 (($Modules | ForEach-Object { ":modules:${_}:test" })); Pop-Location }
  "run" {
    $vars = Read-Env; Write-Config $vars; Link-Modules
    Push-Location $App; .\gradlew.bat run --port $vars["IOETI_APP_PORT"] --config (Join-Path $Root ".local/axelor-config.local.properties"); Pop-Location
  }
  "health" {
    $vars = Read-Env; $base = "http://localhost:$($vars['IOETI_APP_PORT'])/axelor-erp"
    $session = New-Object Microsoft.PowerShell.Commands.WebRequestSession
    Invoke-WebRequest -WebSession $session -Method Post -ContentType "application/json" -Body '{"username":"admin","password":"admin"}' "$base/callback" | Out-Null
    $r = Invoke-WebRequest -WebSession $session -Method Post -ContentType "application/json" -Body '{"limit":1,"fields":["code"]}' "$base/ws/rest/com.axelor.auth.db.User/search"
    Write-Output "authenticated REST -> $($r.StatusCode)"
  }
  default { Write-Output "Unknown command. Use: init | db-up | db-down | build | test | run | health" }
}
