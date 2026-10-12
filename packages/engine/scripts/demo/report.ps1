# Writes demo/bridged/DEMO-OUTPUT.md from the local database (intel can keep running).
$ErrorActionPreference = "Stop"
$engine = Resolve-Path "$PSScriptRoot\..\.."
$url = (docker inspect platform-intel-1 --format "{{range .Config.Env}}{{println .}}{{end}}" | Select-String -Pattern "^DATABASE_URL=").Line.Substring(13)
$port = (docker port platform-postgres-1 5432/tcp | Select-Object -First 1).Split(":")[-1]
$env:DATABASE_URL = $url -replace "@postgres:5432/", "@127.0.0.1:$port/"
try {
    Push-Location $engine
    npx tsx scripts/demo/report.ts
} finally {
    Pop-Location
    Remove-Item Env:DATABASE_URL
}
