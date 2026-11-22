$ErrorActionPreference = 'Stop'
if ($env:GITHUB_ACTIONS -ne 'true' -or -not $env:RUNNER_TEMP) {
    throw 'Run the Windows installer check in a disposable GitHub Actions runner.'
}

$version = node -p 'require("./package.json").version'
$newInstaller = Resolve-Path "src-tauri/target/release/bundle/nsis/Wave_${version}_x64-setup.exe"
$sandbox = Join-Path $env:RUNNER_TEMP 'wave-upgrade'
$previousInstaller = Join-Path $sandbox 'Wave-0.6.0.exe'
$installDir = Join-Path $sandbox 'app'
$database = Join-Path $env:APPDATA 'com.wave.desktop/wave.db'
if (Test-Path $database) { throw 'The runner already has a Wave library.' }
New-Item -ItemType Directory -Force -Path $sandbox | Out-Null
Invoke-WebRequest 'https://github.com/milalulu/wave/releases/download/v0.6.0/Wave_0.6.0_x64-setup.exe' -OutFile $previousInstaller

function Install-Wave($installer) {
    $process = Start-Process -FilePath $installer -ArgumentList @('/S', "/D=$installDir") -Wait -PassThru -WindowStyle Hidden
    if ($process.ExitCode -ne 0) { throw "Installer exited with code $($process.ExitCode)" }
    if (-not (Test-Path "$installDir/wave.exe")) { throw 'Wave executable was not installed.' }
}

function Test-WaveStart($migrationCount) {
    $app = Start-Process -FilePath "$installDir/wave.exe" -PassThru
    try {
        for ($attempt = 0; $attempt -lt 45; $attempt++) {
            if ($app.HasExited) { throw "Wave exited with code $($app.ExitCode)" }
            if (Test-Path $database) {
                $output = python -c 'import sqlite3,sys; print(sqlite3.connect(sys.argv[1]).execute("select count(*) from _sqlx_migrations where success").fetchone()[0])' $database 2>$null
                if ($LASTEXITCODE -eq 0 -and [int]$output -ge $migrationCount) { return }
            }
            Start-Sleep -Seconds 1
        }
        throw "Wave did not apply $migrationCount database migrations."
    } finally {
        if (-not $app.HasExited -and (-not $app.CloseMainWindow() -or -not $app.WaitForExit(5000))) {
            Stop-Process -Id $app.Id
            $app.WaitForExit()
        }
    }
}

Install-Wave $previousInstaller
Test-WaveStart 8
@'
import json
import sqlite3
import sys

with sqlite3.connect(sys.argv[1]) as db:
    track = {"id": "release-fixture", "provider": "local", "uri": "file:///fixture.wav", "title": "Release fixture"}
    db.execute("INSERT INTO liked_tracks VALUES (?, ?, ?)", (track["id"], json.dumps(track), 10))
    db.execute("INSERT INTO history (track_json, played_at) VALUES (?, ?)", (json.dumps(track), 11))
    db.execute("INSERT INTO queue_state VALUES (?, ?, ?, ?)", ("release-fixture", json.dumps([track]), 0, 18.5))
'@ | python - $database
if ($LASTEXITCODE -ne 0) { throw 'Could not seed the previous version.' }
Install-Wave $newInstaller.Path
Test-WaveStart 9
@'
import sqlite3
import sys

with sqlite3.connect(sys.argv[1]) as db:
    assert db.execute("PRAGMA integrity_check").fetchone() == ("ok",)
    assert db.execute("SELECT COUNT(*) FROM liked_tracks WHERE id='release-fixture'").fetchone() == (1,)
    assert db.execute("SELECT COUNT(*) FROM history WHERE played_at=11").fetchone() == (1,)
    assert db.execute("SELECT position FROM queue_state WHERE id='release-fixture'").fetchone() == (18.5,)
'@ | python - $database
if ($LASTEXITCODE -ne 0) { throw 'Update did not preserve the previous library.' }
Write-Output "Installed Windows upgrade from 0.6.0 to $version preserved SQLite data."
