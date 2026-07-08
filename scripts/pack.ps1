Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# Resolve repo root from this script's location
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot  = Resolve-Path (Join-Path $ScriptDir '..')
$SrcDir    = Join-Path $RepoRoot 'src'
$DistDir   = Join-Path $RepoRoot 'dist'

$rootManifestPath = Join-Path $RepoRoot 'manifest.json'
if (-not (Test-Path $rootManifestPath)) {
  throw "Could not find manifest.json at repo root: '$rootManifestPath'"
}

# Read base version from root manifest
$baseManifest = Get-Content $rootManifestPath | ConvertFrom-Json
$version = $baseManifest.version
if (-not $version) { throw 'Version not found in manifest.json' }

# Clean dist and recreate targets
if (Test-Path $DistDir) { Remove-Item -Recurse -Force $DistDir }
New-Item -ItemType Directory -Force -Path (Join-Path $DistDir 'edge') | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $DistDir 'firefox') | Out-Null

# Files that make up the shippable extension. Everything else under src/
# (node_modules, tests, coverage, dotfiles, lockfiles) must NOT be packaged:
# Manifest V3 stores reject bundled remotely-hosted code, and dev dependencies
# such as yargs/sprintf-js contain references to remote URLs.
$include = @(
  'background.js',
  'compat.js',
  'config.js',
  'main.js',
  'emoji.js',
  'popup.html',
  'popup.js',
  'style.css',
  'icon.png',
  'content/main.helpers.js',
  'content/main.banner.js',
  'content/main.links.js',
  'content/main.detect.js',
  'content/main.bootstrap.js'
)

# Build Edge/Chrome package (root manifest + whitelisted src files only)
$edgeDir = Join-Path $DistDir 'edge'
$edgeSrcDir = Join-Path $edgeDir 'src'
Copy-Item -Force $rootManifestPath -Destination (Join-Path $edgeDir 'manifest.json')
foreach ($rel in $include) {
  $srcPath  = Join-Path $SrcDir $rel
  $destPath = Join-Path $edgeSrcDir $rel
  $destDir  = Split-Path -Parent $destPath
  New-Item -ItemType Directory -Force -Path $destDir | Out-Null
  if (-not (Test-Path $srcPath)) { throw "Missing required file for Edge package: $rel" }
  Copy-Item -Force $srcPath -Destination $destPath
}

# Fail the build if remotely hosted executable code or common MV3-incompatible
# dynamic-code constructs ever enter the Chrome/Edge package.
$forbiddenPatterns = @(
  @{ Name = 'remote script tag'; Pattern = '<script[^>]+src\s*=\s*["'']https?://' },
  @{ Name = 'remote module import'; Pattern = '(?:from\s*|import\s*\()["'']https?://' },
  @{ Name = 'remote worker import'; Pattern = 'importScripts\s*\([^)]*https?://' },
  @{ Name = 'remote CSS resource'; Pattern = '(?:@import|url\s*\()[^;\r\n]*https?://' },
  @{ Name = 'eval'; Pattern = '\beval\s*\(' },
  @{ Name = 'Function constructor'; Pattern = '\bnew\s+Function\s*\(' }
)
$scanFiles = Get-ChildItem $edgeDir -Recurse -File | Where-Object { $_.Extension -in '.js', '.mjs', '.html', '.css' }
foreach ($rule in $forbiddenPatterns) {
  $matches = $scanFiles | Select-String -Pattern $rule.Pattern
  if ($matches) {
    $locations = ($matches | ForEach-Object { "$($_.Path):$($_.LineNumber)" }) -join ', '
    throw "Manifest V3 validation failed ($($rule.Name)): $locations"
  }
}
$unexpected = Get-ChildItem $edgeDir -Recurse -File | Where-Object {
  $_.FullName -match '[\\/](node_modules|test|tests|coverage)[\\/]' -or
  $_.Name -in 'package.json', 'package-lock.json'
}
if ($unexpected) {
  throw "Development files found in extension package: $($unexpected.FullName -join ', ')"
}
Compress-Archive -Path (Join-Path $edgeDir '*') -DestinationPath (Join-Path $DistDir "GitPulse-$version-edge.zip") -Force

# Build Firefox package (use root firefox manifest if present, else derive)
$ffDir = Join-Path $DistDir 'firefox'
$ffManifestRoot = Join-Path $RepoRoot 'manifest.firefox.json'
if (Test-Path $ffManifestRoot) {
  $ffManifest = Get-Content $ffManifestRoot | ConvertFrom-Json
  $ffManifest.version = $version
  $ffManifest | ConvertTo-Json -Depth 20 | Out-File -Encoding UTF8 (Join-Path $ffDir 'manifest.json')
} else {
  $m = $baseManifest | ConvertTo-Json -Depth 20 | ConvertFrom-Json
  $m.background = @{ scripts = @('GitPulse/src/background.js') }
  if (-not $m.browser_specific_settings) { $m | Add-Member browser_specific_settings (@{}) }
  if (-not $m.browser_specific_settings.gecko) { $m.browser_specific_settings | Add-Member gecko (@{}) }
  $m.browser_specific_settings.gecko.id = 'gitpulse@example.com'
  $m.browser_specific_settings.gecko.strict_min_version = '109.0'
  $m.browser_specific_settings.gecko.data_collection_permissions = @{ 
    required = @('websiteContent');
    optional = @()
  }
  $m | ConvertTo-Json -Depth 20 | Out-File -Encoding UTF8 (Join-Path $ffDir 'manifest.json')
}
# Place sources under 'GitPulse/src' to match manifest paths
$ffGitPulseDir = Join-Path $ffDir 'GitPulse'
$ffSrcDir      = Join-Path $ffGitPulseDir 'src'
New-Item -ItemType Directory -Force -Path $ffSrcDir | Out-Null

# Firefox package reuses the same $include whitelist defined above so both
# packages stay in sync and neither ships dev/test/dotfiles or node_modules.
foreach ($rel in $include) {
  $srcPath  = Join-Path $SrcDir $rel
  $destPath = Join-Path $ffSrcDir $rel
  $destDir  = Split-Path -Parent $destPath
  New-Item -ItemType Directory -Force -Path $destDir | Out-Null
  if (-not (Test-Path $srcPath)) { throw "Missing required file for Firefox package: $rel" }
  Copy-Item -Force $srcPath -Destination $destPath
}
# Generate square icons in staging (GitPulse/src/icons)
Add-Type -AssemblyName System.Drawing
$inIcon        = Join-Path $ffSrcDir 'icon.png'
$iconsDir      = Join-Path $ffSrcDir 'icons'
New-Item -ItemType Directory -Force -Path $iconsDir | Out-Null

function New-SquareIcon([string]$inPath, [string]$outPath, [int]$size) {
  $img = [System.Drawing.Image]::FromFile($inPath)
  try {
    $max = [Math]::Max($img.Width, $img.Height)
    $square = New-Object System.Drawing.Bitmap($max, $max)
    $g = [System.Drawing.Graphics]::FromImage($square)
    try {
      $g.Clear([System.Drawing.Color]::Transparent)
      $x = [Math]::Round(($max - $img.Width) / 2)
      $y = [Math]::Round(($max - $img.Height) / 2)
      $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
      $g.DrawImage($img, $x, $y, $img.Width, $img.Height)
    } finally { $g.Dispose() }

    $outBmp = New-Object System.Drawing.Bitmap($size, $size)
    $g2 = [System.Drawing.Graphics]::FromImage($outBmp)
    try {
      $g2.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
      $g2.DrawImage($square, 0, 0, $size, $size)
    } finally { $g2.Dispose() }
    $outBmp.Save($outPath, [System.Drawing.Imaging.ImageFormat]::Png)
    $outBmp.Dispose()
    $square.Dispose()
  } finally { $img.Dispose() }
}

foreach ($s in 16,32,48,128) {
  New-SquareIcon $inIcon (Join-Path $iconsDir ("icon-{0}.png" -f $s)) $s
}
Add-Type -AssemblyName System.IO.Compression.FileSystem
$ffZipPath = Join-Path $DistDir ("GitPulse-{0}-firefox.zip" -f $version)
if (Test-Path $ffZipPath) { Remove-Item $ffZipPath -Force }
$fs = [System.IO.File]::Open($ffZipPath, [System.IO.FileMode]::Create)
try {
  $zip = New-Object System.IO.Compression.ZipArchive($fs, [System.IO.Compression.ZipArchiveMode]::Create, $false)
  try {
    # manifest at root
    [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, (Join-Path $ffDir 'manifest.json'), 'manifest.json', [System.IO.Compression.CompressionLevel]::Optimal) | Out-Null
    # core files under GitPulse/src
    foreach ($rel in $include) {
      $srcFile = Join-Path $ffSrcDir $rel
      $entryName = ('GitPulse/src/' + ($rel -replace '\\','/'))
      [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $srcFile, $entryName, [System.IO.Compression.CompressionLevel]::Optimal) | Out-Null
    }
    # generated icons
    foreach ($s in 16,32,48,128) {
      $srcFile = Join-Path $iconsDir ("icon-{0}.png" -f $s)
      $entryName = "GitPulse/src/icons/icon-$s.png"
      [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $srcFile, $entryName, [System.IO.Compression.CompressionLevel]::Optimal) | Out-Null
    }
  } finally { $zip.Dispose() }
} finally { $fs.Dispose() }

Write-Host "Created: $(Join-Path $DistDir "GitPulse-$version-edge.zip")"
Write-Host "Created: $(Join-Path $DistDir "GitPulse-$version-firefox.zip")"

