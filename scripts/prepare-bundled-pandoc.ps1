param(
  [Parameter(Mandatory = $true)]
  [string]$AssetPattern,

  [Parameter(Mandatory = $true)]
  [string]$ResourceSubdir,

  [Parameter(Mandatory = $false)]
  [string]$BinaryName = "pandoc"
)

$ErrorActionPreference = "Stop"

$headers = @{
  "User-Agent" = "pandoc-gui-build"
}

$release = Invoke-RestMethod -Uri "https://api.github.com/repos/jgm/pandoc/releases/latest" -Headers $headers
$asset = $release.assets | Where-Object { $_.name -like $AssetPattern } | Select-Object -First 1

if (-not $asset) {
  throw "Could not find a Pandoc asset matching pattern '$AssetPattern' in release $($release.tag_name)."
}

$tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("pandoc-gui-pandoc-" + [System.Guid]::NewGuid().ToString("N"))
$archiveDir = Join-Path $tempRoot "archive"
$extractDir = Join-Path $tempRoot "extract"
New-Item -ItemType Directory -Force -Path $archiveDir | Out-Null
New-Item -ItemType Directory -Force -Path $extractDir | Out-Null

$archivePath = Join-Path $archiveDir $asset.name
Write-Host "Downloading $($asset.name) from $($release.tag_name)..."
Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $archivePath

if ($asset.name.EndsWith(".zip")) {
  Expand-Archive -Path $archivePath -DestinationPath $extractDir -Force
} elseif ($asset.name.EndsWith(".tar.gz")) {
  tar -xzf $archivePath -C $extractDir
} else {
  throw "Unsupported Pandoc archive format: $($asset.name)"
}

$binary = Get-ChildItem -Path $extractDir -Recurse -File |
  Where-Object { $_.Name -eq $BinaryName } |
  Sort-Object FullName |
  Select-Object -First 1

if (-not $binary) {
  throw "Could not find bundled binary '$BinaryName' after extracting $($asset.name)."
}

$repoRoot = Split-Path -Parent $PSScriptRoot
$resourceDir = Join-Path $repoRoot "src-tauri\resources\pandoc\$ResourceSubdir"
New-Item -ItemType Directory -Force -Path $resourceDir | Out-Null
Get-ChildItem -Path $resourceDir -File -ErrorAction SilentlyContinue | Remove-Item -Force

$destination = Join-Path $resourceDir $BinaryName
Copy-Item -Path $binary.FullName -Destination $destination -Force

if ($IsLinux -or $IsMacOS) {
  & chmod +x $destination
}

Write-Host "Bundled Pandoc $($release.tag_name) into $destination"
