param(
  [Parameter(Mandatory = $true)]
  [string]$AssetPattern,

  [Parameter(Mandatory = $true)]
  [string]$ResourceSubdir,

  [Parameter(Mandatory = $false)]
  [string]$BinaryName = "tectonic.exe"
)

$ErrorActionPreference = "Stop"

$headers = @{
  "User-Agent" = "pandoc-gui-build"
}

try {
  $release = Invoke-RestMethod -Uri "https://api.github.com/repos/tectonic-typesetting/tectonic/releases/latest" -Headers $headers
} catch {
  Write-Host "Invoke-RestMethod failed, retrying release metadata fetch with curl.exe..."
  $json = & curl.exe -L --fail -H "User-Agent: pandoc-gui-build" "https://api.github.com/repos/tectonic-typesetting/tectonic/releases/latest"
  if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($json)) {
    throw "Failed to fetch Tectonic release metadata."
  }
  $release = $json | ConvertFrom-Json
}

$asset = $release.assets | Where-Object { $_.name -like $AssetPattern } | Select-Object -First 1

if (-not $asset) {
  throw "Could not find a Tectonic asset matching pattern '$AssetPattern' in release $($release.tag_name)."
}

$tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("pandoc-gui-tectonic-" + [System.Guid]::NewGuid().ToString("N"))
$archiveDir = Join-Path $tempRoot "archive"
$extractDir = Join-Path $tempRoot "extract"
New-Item -ItemType Directory -Force -Path $archiveDir | Out-Null
New-Item -ItemType Directory -Force -Path $extractDir | Out-Null

$archivePath = Join-Path $archiveDir $asset.name
Write-Host "Downloading $($asset.name) from $($release.tag_name)..."
try {
  Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $archivePath
} catch {
  Write-Host "Invoke-WebRequest failed, retrying with curl.exe..."
  & curl.exe -L --fail --output $archivePath $asset.browser_download_url
  if ($LASTEXITCODE -ne 0) {
    throw "Failed to download $($asset.name) with curl.exe."
  }
}

if ($asset.name.EndsWith(".zip")) {
  Expand-Archive -Path $archivePath -DestinationPath $extractDir -Force
} elseif ($asset.name.EndsWith(".tar.gz")) {
  tar -xzf $archivePath -C $extractDir
} else {
  throw "Unsupported Tectonic archive format: $($asset.name)"
}

$binary = Get-ChildItem -Path $extractDir -Recurse -File |
  Where-Object { $_.Name -eq $BinaryName } |
  Sort-Object FullName |
  Select-Object -First 1

if (-not $binary) {
  throw "Could not find bundled binary '$BinaryName' after extracting $($asset.name)."
}

$repoRoot = Split-Path -Parent $PSScriptRoot
$resourceDir = Join-Path $repoRoot "src-tauri\resources\tectonic\$ResourceSubdir"
New-Item -ItemType Directory -Force -Path $resourceDir | Out-Null
Get-ChildItem -Path $resourceDir -Force -ErrorAction SilentlyContinue | Remove-Item -Recurse -Force

$binaryDir = Split-Path -Parent $binary.FullName
Copy-Item -Path (Join-Path $binaryDir '*') -Destination $resourceDir -Recurse -Force

if ($IsLinux -or $IsMacOS) {
  $destination = Join-Path $resourceDir $BinaryName
  & chmod +x $destination
}

Write-Host "Bundled Tectonic $($release.tag_name) into $resourceDir"
