# Render QA stills of one section at given frames, tiled 2x2 into one image.
#   .\scripts\qa.ps1 onefile 40,150,260,320
param([string]$Id, [string]$Frames)
Push-Location (Split-Path -Parent $PSScriptRoot)
$fr = @(); $i = 0
foreach ($f in $Frames.Split(",")) {
  npx remotion still src/index.ts "S-$Id" "out/qa/$Id-$i.png" --frame=$f 2>&1 | Out-Null
  $fr += "out/qa/$Id-$i.png"; $i++
}
$inputs = @(); foreach ($x in $fr) { $inputs += "-i"; $inputs += $x }
$scale = (0..($fr.Count - 1) | ForEach-Object { "[$($_):v]scale=960:-1[v$_];" }) -join ""
$labels = (0..($fr.Count - 1) | ForEach-Object { "[v$_]" }) -join ""
ffmpeg -v error -y @inputs -filter_complex "$scale${labels}xstack=inputs=$($fr.Count):layout=0_0|w0_0|0_h0|w0_h0" "out/qa/$Id-sheet.png"
"$Id -> out/qa/$Id-sheet.png"
Pop-Location
