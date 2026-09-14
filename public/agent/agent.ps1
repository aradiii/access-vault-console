<#
.SYNOPSIS
  Access Vault Monitor Agent - Windows telemetry reporter.

.DESCRIPTION
  Runs on each Windows server in your fleet and self-reports hardware specs and
  live metrics (CPU cores, total RAM, Windows edition/version, computer name,
  CPU load, memory usage, uptime) to your Access Vault console every N seconds.

  Configuration is read (first match wins):
    1. direct parameters   (-ServerUrl / -Token / -IntervalSec)
    2. config.json next to this script (see config.example.json)

.EXAMPLES
  # Quick test (single report, then exit):
  powershell -NoProfile -ExecutionPolicy Bypass -File .\agent.ps1 -Once

  # Continuous loop every 30 seconds:
  powershell -NoProfile -ExecutionPolicy Bypass -File .\agent.ps1

  # Install as an auto-start scheduled task (run as Administrator once):
  powershell -NoProfile -ExecutionPolicy Bypass -File .\agent.ps1 -Install
  powershell -NoProfile -ExecutionPolicy Bypass -File .\agent.ps1 -Uninstall
#>
param(
  [string]$ConfigFile = "",
  [string]$ServerUrl = "",
  [string]$Token = "",
  [int]$IntervalSec = -1,
  [switch]$Once,
  [switch]$Install,
  [switch]$Uninstall
)

$ErrorActionPreference = "Stop"
$TaskName = "AccessVaultMonitor"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

# ---------------------------------------------------------------------------
# Scheduled task management (-Install / -Uninstall). Requires elevation.
# ---------------------------------------------------------------------------
if ($Install -or $Uninstall) {
  $isElevated = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
    ).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
  if (-not $isElevated) {
    Write-Host " -Install / -Uninstall must run in an elevated (Administrator) PowerShell." -ForegroundColor Red
    exit 1
  }
  if ($Uninstall) {
    if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
      Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
      Write-Host "Scheduled task '$TaskName' removed." -ForegroundColor Yellow
    } else {
      Write-Host "Scheduled task '$TaskName' was not installed."
    }
    exit 0
  }
  $action = New-ScheduledTaskAction -Execute "powershell.exe" `
    -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$PSCommandPath`""
  $trigger = New-ScheduledTaskTrigger -AtStartup
  $settings = New-ScheduledTaskSettingsSet -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) `
    -ExecutionTimeLimit (New-TimeSpan -Days 3650) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
  Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger `
    -Settings $settings -User "SYSTEM" -RunLevel Highest -Force | Out-Null
  Start-ScheduledTask -TaskName $TaskName
  Write-Host "Scheduled task '$TaskName' installed (starts at boot, runs as SYSTEM)." -ForegroundColor Green
  Write-Host "The agent now reports telemetry continuously. Remove with: .\agent.ps1 -Uninstall"
  exit 0
}

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
if (-not $ConfigFile) { $ConfigFile = Join-Path $scriptDir "config.json" }
if (Test-Path $ConfigFile) {
  try {
    $cfg = Get-Content $ConfigFile -Raw | ConvertFrom-Json
    if (-not $ServerUrl -and $cfg.serverUrl) { $ServerUrl = [string]$cfg.serverUrl }
    if (-not $Token -and $cfg.token) { $Token = [string]$cfg.token }
    if ($IntervalSec -lt 0 -and $cfg.intervalSec) { $IntervalSec = [int]$cfg.intervalSec }
  } catch {
    Write-Warning "config.json could not be parsed: $($_.Exception.Message)"
  }
}
if ($IntervalSec -lt 5) { $IntervalSec = 30 }
if (-not $ServerUrl) { Write-Host "ServerUrl is required (pass -ServerUrl or fill config.json)." -ForegroundColor Red; exit 1 }
if (-not $Token)     { Write-Host "Token is required (pass -Token or fill config.json)." -ForegroundColor Red; exit 1 }

$reportUrl = $ServerUrl.TrimEnd("/") + "/api/rdp/agent/report"

Write-Host ""
Write-Host "  Access Vault Monitor Agent" -ForegroundColor Cyan
Write-Host "  target : $reportUrl"
Write-Host "  every  : $IntervalSec sec  (-Once for a single report)"
Write-Host ""

# ---------------------------------------------------------------------------
# Telemetry collection (pure CIM/WMI - no admin rights needed)
# ---------------------------------------------------------------------------
function Get-Telemetry {
  $os = Get-CimInstance -ClassName Win32_OperatingSystem
  $cs = Get-CimInstance -ClassName Win32_ComputerSystem

  $totalKb = [double]$os.TotalVisibleMemorySize
  $freeKb  = [double]$os.FreePhysicalMemory
  $memUsedPercent = $null
  if ($totalKb -gt 0) {
    $memUsedPercent = [int][math]::Round((($totalKb - $freeKb) / $totalKb) * 100)
    if ($memUsedPercent -lt 0) { $memUsedPercent = 0 }
    if ($memUsedPercent -gt 100) { $memUsedPercent = 100 }
  }

  $cpuLoad = $null
  try {
    $loads = @(Get-CimInstance -ClassName Win32_Processor | ForEach-Object { [int]$_.LoadPercentage })
    if ($loads.Count -gt 0) {
      $cpuLoad = [int][math]::Round(($loads | Measure-Object -Average).Average)
    }
  } catch { }
  if ($null -eq $cpuLoad) {
    try {
      $cpuLoad = [int][math]::Round(
        (Get-Counter '\Processor(_Total)\% Processor Time' -ErrorAction Stop).CounterSamples[0].CookedValue)
    } catch { }
  }

  $cores = 0
  try { $cores = [int]$cs.NumberOfLogicalProcessors } catch { }
  if ($cores -le 0) {
    try { $cores = [int]$env:NUMBER_OF_PROCESSORS } catch { }
  }

  $ramMb = 0
  try { $ramMb = [int][math]::Round([double]$cs.TotalPhysicalMemory / 1MB) } catch { }

  $uptimeSec = 0
  try { $uptimeSec = [int]((Get-Date) - $os.LastBootUpTime).TotalSeconds } catch { }

  return [ordered]@{
    token          = $Token
    cores          = $cores
    ramMb          = $ramMb
    osName         = [string]$os.Caption
    osVersion      = [string]$os.Version
    computerName   = [string]$os.CSName
    cpuLoad        = $cpuLoad
    memUsedPercent = $memUsedPercent
    uptimeSec      = $uptimeSec
  }
}

function Send-Report {
  $t = Get-Telemetry
  $json = $t | ConvertTo-Json -Compress
  $resp = Invoke-RestMethod -Uri $reportUrl -Method Post -ContentType "application/json" `
    -Body $json -TimeoutSec 15
  return @{ payload = $t; ok = ($resp.ok -eq $true) }
}

# ---------------------------------------------------------------------------
# Main loop
# ---------------------------------------------------------------------------
do {
  try {
    $r = Send-Report
    $p = $r.payload
    $stamp = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
    Write-Host "[$stamp] reported: $([string]$p.computerName) - $([string]$p.osName) - $([int]$p.cores) cores, $([int]$p.ramMb) MB, CPU $([int]$p.cpuLoad)%, MEM $([int]$p.memUsedPercent)%"
  } catch {
    $stamp = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
    Write-Host "[$stamp] report failed: $($_.Exception.Message)" -ForegroundColor Yellow
  }
  if (-not $Once) { Start-Sleep -Seconds $IntervalSec }
} while (-not $Once)
