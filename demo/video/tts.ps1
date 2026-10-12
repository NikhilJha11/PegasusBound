# Renders each narration line to demo/video/audio/<id>.wav with Windows speech.
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Speech
$dir = Join-Path $PSScriptRoot "audio"
New-Item -ItemType Directory -Force $dir | Out-Null
$lines = Get-Content (Join-Path $PSScriptRoot "narration.json") -Raw | ConvertFrom-Json
$voice = if ($env:TTS_VOICE) { $env:TTS_VOICE } else { "Microsoft Zira Desktop" }
foreach ($l in $lines) {
    $s = New-Object System.Speech.Synthesis.SpeechSynthesizer
    $s.SelectVoice($voice)
    $s.Rate = 2
    $fmt = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(44100, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)
    $s.SetOutputToWaveFile((Join-Path $dir "$($l.id).wav"), $fmt)
    $s.Speak($l.text)
    $s.Dispose()
}
"rendered $($lines.Count) lines"
