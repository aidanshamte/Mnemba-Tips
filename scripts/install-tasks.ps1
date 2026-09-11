param([switch]$Remove)
$ErrorActionPreference = 'Stop'
$projectPath = Split-Path -Parent $PSScriptRoot
$nodePath = (Get-Command node).Source
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 25) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 5)
foreach ($task in @(@{Name='Fixtures';Group='fixtures';Minutes=30;Offset=5},@{Name='NewsSocial';Group='hourly';Minutes=60;Offset=15},@{Name='Daily';Group='daily';Minutes=1440;Offset=25})) {
 $taskName = "PitchPredict-$($task.Name)"
 if ($Remove) { Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue; continue }
 $action = New-ScheduledTaskAction -Execute (Get-Command powershell).Source -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$projectPath\scripts\task-runner.ps1`" -Group $($task.Group)" -WorkingDirectory $projectPath
 $trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes($task.Offset) -RepetitionInterval (New-TimeSpan -Minutes $task.Minutes)
 $principal = New-ScheduledTaskPrincipal -UserId ([System.Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Limited
 Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Description 'PitchPredict local free-source updates; requires this user session and an internet connection.' -Force | Select-Object TaskName,State
}
