# Start the extracted desktop baseline with Pilot-only development data.
# Requires built/staged bundle dependencies; this does not refresh the staged bundle.
param(
    [string]$NodePath,
    [string]$RuntimePath,
    [string]$RelayUrl,
    [ValidateRange(0,65535)][int]$DebugPort = 0
)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
$desktop = Join-Path $projectRoot 'harness\desktop'
if ($RelayUrl) {
    $relay = $null
    if (![Uri]::TryCreate($RelayUrl, [UriKind]::Absolute, [ref]$relay) -or $relay.Scheme -notin @('http','https') -or !$relay.Host -or $relay.UserInfo -or $relay.Query -or $relay.Fragment -or $relay.AbsolutePath -ne '/') {
        throw 'RelayUrl must be an HTTP(S) origin without credentials, path, query or fragment.'
    }
    $env:NANOMUSE_CLOUD_URL = $RelayUrl.TrimEnd('/')
}
if (!$NodePath) {
    $nodeCommand = Get-Command node -ErrorAction SilentlyContinue
    if ($nodeCommand) { $NodePath = $nodeCommand.Source }
    elseif ($env:PI_SCRATCH_DIR) { $NodePath = Join-Path $env:PI_SCRATCH_DIR 'node-v22.19.0-win-x64\node.exe' }
}
if (!$NodePath -or !(Test-Path -LiteralPath $NodePath)) { throw 'Node is missing. Pass -NodePath with a Node 22.19+ executable.' }
if (!$RuntimePath) {
    $runtimeCommand = Get-Command nanomuse -ErrorAction SilentlyContinue
    if ($runtimeCommand) { $RuntimePath = $runtimeCommand.Source }
    elseif ($env:PI_SCRATCH_DIR) { $RuntimePath = Join-Path $env:PI_SCRATCH_DIR 'venv\Scripts\nanomuse.exe' }
}
$electron = Join-Path $desktop 'node_modules\electron\dist\electron.exe'
foreach ($required in @($electron, (Join-Path $desktop 'dsh\dsh.json'), (Join-Path $desktop 'node_modules\typescript\bin\tsc'))) {
    if (!(Test-Path -LiteralPath $required)) { throw "Missing development dependency: $required" }
}
$env:PATH = (Split-Path $NodePath -Parent) + ';' + $env:PATH
& $NodePath (Join-Path $desktop 'node_modules\typescript\bin\tsc') -p (Join-Path $desktop 'tsconfig.json')
if ($LASTEXITCODE -ne 0) { throw "Desktop build failed: $LASTEXITCODE" }
$dataRoot = Join-Path $projectRoot '.pilot-data\dev'
$env:NANOMUSE_DESKTOP_HOME = Join-Path $dataRoot 'desktop'
$env:NANOMUSE_DATA_DIR = Join-Path $dataRoot 'runtime'
$env:DSH_HOME = $env:NANOMUSE_DESKTOP_HOME
$env:PYTHONUTF8 = '1'
$env:NO_PROXY = 'localhost,127.0.0.1,::1'
if ($RuntimePath -and (Test-Path -LiteralPath $RuntimePath)) { $env:NANOMUSE_PY = $RuntimePath }
else { throw 'Python runtime is missing. Pass -RuntimePath with the nanomuse executable.' }
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
$electronData = Join-Path $dataRoot 'electron'
New-Item -ItemType Directory -Path $electronData -Force | Out-Null
$logRoot = if ($env:PI_SCRATCH_DIR) { $env:PI_SCRATCH_DIR } else { $dataRoot }
$launchId = [DateTime]::Now.ToString('yyyyMMdd-HHmmss-fff')
$stdout = Join-Path $logRoot "dev-$launchId.stdout.log"
$stderr = Join-Path $logRoot "dev-$launchId.stderr.log"
$launchArgs = @('.', ('--user-data-dir="' + $electronData + '"'))
if ($DebugPort -gt 0) { $launchArgs += @("--remote-debugging-port=$DebugPort", '--remote-debugging-address=127.0.0.1') }
$process = Start-Process -FilePath $electron -ArgumentList $launchArgs -WorkingDirectory $desktop -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru
Write-Output "Desktop PID: $($process.Id)"
Write-Output "Development data: $dataRoot"
Write-Output "Startup logs: $stdout ; $stderr"
Write-Output 'Pilot development UI started; full project and remote execution acceptance remains pending.'
