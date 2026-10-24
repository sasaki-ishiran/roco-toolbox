param(
    [string]$BuildDirectory = 'D:\roco-build\collector-shell',
    [string]$SdkDirectory = 'D:\roco-build\sdk',
    [string]$JdkDirectory = 'D:\roco-build\tools\jdk21',
    [string[]]$Tasks = @('assembleDebug', 'testDebugUnitTest', 'lintDebug'),
    [switch]$Online
)
$ErrorActionPreference = 'Stop'
$source = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\android-shell'))
$stage = [IO.Path]::GetFullPath($BuildDirectory)
if ($stage.StartsWith($source, [StringComparison]::OrdinalIgnoreCase)) { throw 'Build outside the source directory.' }
if ($stage -match '[^\x00-\x7f]') { throw 'Use an ASCII build path for Gradle/NDK.' }
if (-not (Test-Path -LiteralPath "$JdkDirectory\bin\java.exe")) { throw 'JDK is missing.' }
New-Item -ItemType Directory -Force $stage | Out-Null
& robocopy $source $stage /E /XD .gradle .cxx build /XF local.properties '*.log' /NFL /NDL /NJH /NJS /NP
if ($LASTEXITCODE -ge 8) { throw "Copy failed: $LASTEXITCODE" }
$captureToken = ''
$sourceProperties = Join-Path $source 'local.properties'
if (Test-Path -LiteralPath $sourceProperties) {
    foreach ($line in Get-Content -LiteralPath $sourceProperties) {
        if ($line -match '^\s*capture\.token\s*=\s*(.+)$') { $captureToken = $Matches[1].Trim() }
    }
}
$localProperties = "sdk.dir=$($SdkDirectory.Replace('\','/').Replace(':','\:'))`n"
if ($captureToken) { $localProperties += "capture.token=$captureToken`n" }
[IO.File]::WriteAllText("$stage\local.properties", $localProperties, [Text.UTF8Encoding]::new($false))
$javaBefore = $env:JAVA_HOME
$optionsBefore = $env:JAVA_TOOL_OPTIONS
$gradleBefore = $env:GRADLE_USER_HOME
try {
    $env:JAVA_HOME = $JdkDirectory
    $env:GRADLE_USER_HOME = 'D:\roco-build\gradle-home'
    $env:JAVA_TOOL_OPTIONS = '-Dfile.encoding=UTF-8 -Djdk.net.unixdomain.tmpdir=D:/roco-build/tmp -Djava.io.tmpdir=D:/roco-build/tmp -Djava.net.preferIPv4Stack=true'
    [string[]]$offlineArgs = @()
    if (-not $Online) { $offlineArgs += '--offline' }
    & "$stage\gradlew.bat" -p $stage @offlineArgs --no-daemon --console=plain @Tasks
    if ($LASTEXITCODE -ne 0) { throw "Android checks failed: $LASTEXITCODE" }
    Write-Output "APK: $stage\app\build\outputs\apk\debug\app-debug.apk"
} finally {
    $env:JAVA_HOME = $javaBefore
    $env:JAVA_TOOL_OPTIONS = $optionsBefore
    $env:GRADLE_USER_HOME = $gradleBefore
}
