# Nightly D1 backup with a restore test.
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\backup-d1.ps1
# Exports the remote database, restores it into the local D1, compares every table's row count,
# keeps the newest $Keep dumps. Exit codes: 0 ok, 1 could not read the remote, 2 restore mismatched.
#
# Two Windows traps are handled on purpose:
#   1. Piping a node process into PowerShell's pipeline kills it with "Assertion failed:
#      !(handle->flags & UV_HANDLE_CLOSING), file src\win\async.c". Every call uses Start-Process with
#      a redirection file instead, which writes straight to a file handle and creates no pipe.
#   2. The argument list goes in as an array, so nothing is re-parsed by cmd or PowerShell.
#      `wrangler d1 execute --file` cannot return rows, so a query must use --command.
# node aborts on exit in that same spot, so the exit code is reported but never treated as proof;
# the output text is the evidence.
param(
  [string]$Dir = "F:\Backups\paite-daily",
  [int]$Keep = 14
)
$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent $PSScriptRoot
Set-Location $repo
New-Item -ItemType Directory -Force -Path $Dir | Out-Null
$log = Join-Path $Dir "backup.log"
$wrangler = Join-Path $repo "node_modules\.bin\wrangler.cmd"
function Write-Log($m) { "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')  $m" | Out-File -FilePath $log -Append -Encoding utf8; Write-Host $m }

# Runs wrangler with its output in files. Returns the stdout text, the stderr text and the exit code.
# The argument list is one string with the SQL in double quotes. Start-Process splits an array on
# spaces, which breaks a query into stray arguments.
function Invoke-Wrangler([string]$commandLine) {
  $out = Join-Path $env:TEMP "pd-wrangler-out.txt"
  $err = Join-Path $env:TEMP "pd-wrangler-err.txt"
  Remove-Item $out, $err -ErrorAction SilentlyContinue
  $p = Start-Process -FilePath $wrangler -ArgumentList $commandLine -NoNewWindow -Wait -PassThru -RedirectStandardOutput $out -RedirectStandardError $err
  $text = Get-Content $out -Raw -ErrorAction SilentlyContinue
  $errText = Get-Content $err -Raw -ErrorAction SilentlyContinue
  Remove-Item $out, $err -ErrorAction SilentlyContinue
  return @{ out = $text; err = $errText; code = $p.ExitCode }
}

# One SELECT against the remote or the local database, back as raw JSON text.
function Invoke-Query([string]$sql, [switch]$Local) {
  $target = "--remote"
  if ($Local) { $target = "--local" }
  $r = Invoke-Wrangler "d1 execute paite-daily --json $target --command `"$sql`""
  return $r.out
}

# The table list comes from the database itself, so a table a later deploy adds is not a failure.
$tableSql = "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name <> 'd1_migrations'"
$tableJson = Invoke-Query $tableSql
$tables = @([regex]::Matches([string]$tableJson, '"name":\s*"([A-Za-z_]+)"') | ForEach-Object { $_.Groups[1].Value })
if ($tables.Count -lt 5) { Write-Log "FAIL cannot read the remote table list: $tableJson"; exit 1 }
Write-Log ("tables: " + ($tables -join ", "))

$query = "SELECT " + (($tables | ForEach-Object { "(SELECT count(*) FROM $_) AS $_" }) -join ", ")

function Get-Counts([switch]$Local) {
  $json = [string](Invoke-Query $query -Local:$Local)
  $counts = @{}
  foreach ($name in $tables) {
    if ($json -match "`"$name`":\s*(\d+)") { $counts[$name] = [int]$Matches[1] } else { $counts[$name] = -1 }
  }
  return $counts
}

$stamp = Get-Date -Format "yyyy-MM-dd-HHmm"
$dump = Join-Path $Dir "paite-daily-$stamp.sql"
Write-Log "export -> $dump"
$exp = Invoke-Wrangler "d1 export paite-daily --remote --output `"$dump`" --skip-confirmation"
if (-not (Test-Path $dump)) { Write-Log "FAIL export produced no file: $($exp.err)"; exit 1 }
Write-Log ("exported " + [math]::Round((Get-Item $dump).Length / 1KB) + " KB")

$remote = Get-Counts
$unreadable = @($tables | Where-Object { $remote[$_] -lt 0 })
if ($unreadable.Count -gt 0) { Write-Log "FAIL cannot read the remote counts for: $($unreadable -join ', ')"; exit 1 }

# Restore test: wipe the local D1 state, load the dump, compare every table's count.
$state = Join-Path $repo ".wrangler\state\v3\d1"
if (Test-Path $state) { Remove-Item -Recurse -Force $state }
Write-Log "restoring the dump into the local D1"
$res = Invoke-Wrangler "d1 execute paite-daily --local --file `"$dump`""
$local = Get-Counts -Local

$bad = @()
foreach ($name in $tables) { if ($local[$name] -ne $remote[$name]) { $bad += "$name local=$($local[$name]) remote=$($remote[$name])" } }
$summary = (($tables | ForEach-Object { "$_=$($remote[$_])" }) -join " ")
if ($bad.Count -gt 0) { Write-Log "FAIL restore mismatch: $($bad -join '; ') (remote $summary) (restore exit $($res.code))"; exit 2 }
Write-Log "restore ok: $summary"

Get-ChildItem $Dir -Filter "paite-daily-*.sql" | Sort-Object LastWriteTime -Descending | Select-Object -Skip $Keep | Remove-Item -Force
Write-Log "kept the newest $Keep dumps in $Dir"
exit 0
