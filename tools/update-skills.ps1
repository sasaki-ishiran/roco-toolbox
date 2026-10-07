# Re-clone and update the installed Superpowers / frontend skills.
# Usage: powershell -ExecutionPolicy Bypass -File tools\update-skills.ps1
# Kept ASCII-only on purpose: Windows PowerShell 5.1 mis-reads UTF-8 scripts without a BOM.

$ErrorActionPreference = 'Stop'

$tmp = Join-Path $env:TEMP ('skillgit-' + [guid]::NewGuid().ToString('N'))
$dst = Join-Path $env:USERPROFILE '.codex\skills'
New-Item -ItemType Directory -Path $tmp -Force | Out-Null

Write-Host "Cloning into $tmp ..."
git clone --depth 1 https://github.com/obra/superpowers.git "$tmp\superpowers"
git clone --depth 1 --filter=blob:none --sparse https://github.com/openai/plugins.git "$tmp\openai-plugins"
git -C "$tmp\openai-plugins" sparse-checkout set plugins/build-web-apps

Write-Host 'Updating Superpowers skills ...'
Get-ChildItem -LiteralPath "$tmp\superpowers\skills" -Directory | ForEach-Object {
    Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $dst $_.Name) -Recurse -Force
}

Write-Host 'Updating frontend skills ...'
foreach ($name in 'frontend-app-builder', 'frontend-testing-debugging', 'react-best-practices', 'shadcn-best-practices') {
    Copy-Item -LiteralPath "$tmp\openai-plugins\plugins\build-web-apps\skills\$name" -Destination (Join-Path $dst $name) -Recurse -Force
}

# Upstream names the shadcn skill "shadcn" while its folder is "shadcn-best-practices".
# Align the frontmatter name with the folder name, writing UTF-8 without BOM.
$shadcnSkill = Join-Path $dst 'shadcn-best-practices\SKILL.md'
$text = [System.IO.File]::ReadAllText($shadcnSkill)
$text = $text -replace '(?m)^name:\s*shadcn\s*$', 'name: shadcn-best-practices'
[System.IO.File]::WriteAllText($shadcnSkill, $text, (New-Object System.Text.UTF8Encoding($false)))

Remove-Item -LiteralPath $tmp -Recurse -Force
Write-Host "Done. Skills updated in $dst (takes effect in a new session)."
