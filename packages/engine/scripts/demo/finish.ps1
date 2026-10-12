# Runs the demo engine pass for the Bridged workspace against the local stack.
# Stops the intel container meanwhile (so only this run processes jobs), passes
# the database URL from that container without printing it, then restarts it.
$ErrorActionPreference = "Stop"
$platform = Resolve-Path "$PSScriptRoot\..\..\..\..\platform"
$engine = Resolve-Path "$PSScriptRoot\..\.."
$url = (docker inspect platform-intel-1 --format "{{range .Config.Env}}{{println .}}{{end}}" | Select-String -Pattern "^DATABASE_URL=").Line.Substring(13)
$port = (docker port platform-postgres-1 5432/tcp | Select-Object -First 1).Split(":")[-1]
$env:DATABASE_URL = $url -replace "@postgres:5432/", "@127.0.0.1:$port/"
Push-Location $platform
docker compose -f docker-compose.yml -f docker-compose.local.yml stop intel | Out-Null
Pop-Location
try {
    Push-Location $engine
    npx tsx scripts/demo/finish.ts
} finally {
    Pop-Location
    Push-Location $platform
    docker compose -f docker-compose.yml -f docker-compose.local.yml start intel | Out-Null
    Pop-Location
    Remove-Item Env:DATABASE_URL
}
