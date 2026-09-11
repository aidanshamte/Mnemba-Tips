param([ValidateSet('fixtures','hourly','daily')][string]$Group)
$ErrorActionPreference='Stop'
$projectPath=Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectPath
$process=Start-Process -FilePath (Get-Command node).Source -ArgumentList "`"$projectPath\scripts\update-local.mjs`" $Group" -WorkingDirectory $projectPath -WindowStyle Hidden -Wait -PassThru
exit $process.ExitCode
