$ErrorActionPreference = "Stop"

$repoRoot = $PSScriptRoot
$logDir = Join-Path $PSScriptRoot "logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

$findPidsByPort = {
  param([int]$Port)
  $lines = netstat -ano | Select-String ":$Port"
  $pids = @()
  foreach ($line in $lines) {
    if ($line.ToString() -match "LISTENING\s+(\d+)$") {
      $pids += [int]$Matches[1]
    }
  }
  return ($pids | Select-Object -Unique)
}

# Avoid duplicate local servers on same ports.
foreach ($port in @(8000, 3000)) {
  $existing = & $findPidsByPort -Port $port
  foreach ($procId in $existing) {
    try {
      Stop-Process -Id $procId -Force -ErrorAction Stop
      Write-Output "Stopped existing listener on port $port (PID: $procId)"
    } catch {
      Write-Output "Could not stop existing listener on port $port (PID: $procId)"
    }
  }
}

$apiOut = Join-Path $logDir "api.out.log"
$apiErr = Join-Path $logDir "api.err.log"
$uiOut = Join-Path $logDir "ui.out.log"
$uiErr = Join-Path $logDir "ui.err.log"
$pidFile = Join-Path $logDir "local_dashboard_pids.json"

$apiProc = Start-Process -FilePath "python" `
  -ArgumentList "-m", "uvicorn", "src.iran_monitor.health:app", "--host", "127.0.0.1", "--port", "8000" `
  -WorkingDirectory $repoRoot `
  -RedirectStandardOutput $apiOut `
  -RedirectStandardError $apiErr `
  -PassThru

$uiProc = Start-Process -FilePath "python" `
  -ArgumentList "-m", "http.server", "3000" `
  -WorkingDirectory $repoRoot `
  -RedirectStandardOutput $uiOut `
  -RedirectStandardError $uiErr `
  -PassThru

Start-Sleep -Seconds 2

@{
  api_pid = $apiProc.Id
  ui_pid = $uiProc.Id
  started_at = (Get-Date).ToString("s")
} | ConvertTo-Json | Set-Content -Path $pidFile -Encoding UTF8

Write-Output "API  : http://127.0.0.1:8000/api/state (PID: $($apiProc.Id))"
Write-Output "UI   : http://127.0.0.1:3000/ui/index_v2.html (PID: $($uiProc.Id))"
Write-Output "PIDs : $pidFile"
