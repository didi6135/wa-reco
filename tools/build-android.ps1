param(
    [ValidatePattern('^[A-Za-z]$')][string] $DriveLetter = 'W',
    [string[]] $Tasks = @(':app:externalNativeBuildDebug'),
    [string[]] $GradleArguments = @('--offline', '--console=plain', '--max-workers=2', '--no-daemon'),
    # Compatibility only: every invocation uses the one canonical log below.
    [ValidatePattern('^[A-Za-z0-9_-]+$')][string] $LogGroup = 'android-build',
    [switch] $ReplaceLog
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) {
    throw 'This short-path Android build wrapper requires Windows.'
}
$buildRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..')).TrimEnd('\')
$buildDrive = $DriveLetter.ToUpperInvariant() + ':'
$substExecutable = (Get-Command subst.exe -ErrorAction Stop).Source

function Get-BuildDriveTarget {
    $mappingLines = @(& $substExecutable)
    if ($LASTEXITCODE -ne 0) { throw 'Could not inspect existing drive aliases.' }
    $pattern = '^' + [regex]::Escape($buildDrive) + '\\?:?\s*=>\s*(.+)$'
    foreach ($line in $mappingLines) {
        if ($line -match $pattern) { return [IO.Path]::GetFullPath($matches[1]).TrimEnd('\') }
    }
    return $null
}

# Never overwrite a real, network, PowerShell or already-substituted drive.
if ((Get-BuildDriveTarget) -or (Test-Path -LiteralPath ($buildDrive + '\')) -or
    (@([Environment]::GetLogicalDrives()) -contains ($buildDrive + '\')) -or
    (Get-PSDrive -Name $DriveLetter -ErrorAction SilentlyContinue)) {
    throw 'The requested build drive is occupied. Choose a different unused letter.'
}
if ((Get-Item -LiteralPath $buildRoot -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) {
    throw 'The project root must be a physical directory, not a redirected link.'
}
if (-not (Test-Path -LiteralPath (Join-Path $buildRoot 'android\gradlew.bat') -PathType Leaf)) {
    throw 'Run this wrapper from a checkout containing android/gradlew.bat.'
}
if ($Tasks.Count -eq 0 -or @($Tasks | Where-Object { $_ -notmatch '^:[A-Za-z0-9_:\[\]-]+$' }).Count) {
    throw 'Tasks must be explicit Gradle task paths, such as :app:externalNativeBuildDebug.'
}
$buildLogs = Join-Path $buildRoot 'artifacts\workspace\android-build'
[IO.Directory]::CreateDirectory($buildLogs) | Out-Null
$buildLog = Join-Path $buildLogs 'native-build.log'
if ((Test-Path -LiteralPath $buildLog) -and -not $ReplaceLog) {
    throw 'The canonical build log exists. Review or capture it before deliberately passing -ReplaceLog.'
}
# CreateNew protects a first run; an explicit replacement cannot share an
# existing writer. Snapshot the normal release log before the modified build.
$buildFileMode = if ($ReplaceLog) { [IO.FileMode]::Create } else { [IO.FileMode]::CreateNew }
$buildStream = New-Object IO.FileStream($buildLog, $buildFileMode, [IO.FileAccess]::Write, [IO.FileShare]::Read)
$buildWriter = New-Object IO.StreamWriter($buildStream, (New-Object Text.UTF8Encoding($false)))
$aliasCreated = $false
$locationPushed = $false
$buildExit = 1
try {
    & $substExecutable $buildDrive $buildRoot
    if ($LASTEXITCODE -ne 0) { throw 'Could not create the temporary build drive alias.' }
    $aliasCreated = $true
    if ((Get-BuildDriveTarget) -ne $buildRoot) { throw 'The temporary build drive does not point to this project root.' }
    $buildWriter.WriteLine('Temporary drive alias to the physical project root; all native staging remains under artifacts/cxx.')
    Push-Location -LiteralPath ($buildDrive + '\android')
    $locationPushed = $true
    $previousErrorPreference = $ErrorActionPreference
    try {
        # Native stderr is part of the build log; the exit code decides success.
        $ErrorActionPreference = 'Continue'
        & .\gradlew.bat @Tasks @GradleArguments 2>&1 | ForEach-Object {
            $line = $_.ToString()
            $buildWriter.WriteLine($line)
            $buildWriter.Flush()
            Write-Output $line
        }
        $buildExit = $LASTEXITCODE
    } finally { $ErrorActionPreference = $previousErrorPreference }
} finally {
    if ($locationPushed) { Pop-Location }
    try {
        if ($aliasCreated) {
            if ((Get-BuildDriveTarget) -ne $buildRoot) {
                throw 'The temporary drive mapping changed; it was left untouched.'
            }
            & $substExecutable $buildDrive /d
            if ($LASTEXITCODE -ne 0 -or (Get-BuildDriveTarget)) {
                throw 'Could not remove the owned temporary build drive alias.'
            }
            $buildWriter.WriteLine('Owned temporary drive alias removed.')
        }
    } finally { $buildWriter.Dispose() }
}
Write-Output ('Build log: ' + $buildLog)
if ($buildExit -ne 0) { throw ('Android build failed with exit code ' + $buildExit + '; see the project-local build log.') }
