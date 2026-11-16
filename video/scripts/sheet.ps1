param([string]$Clip, [int]$N = 8, [string]$Out)
$dur = [double](ffprobe -v error -show_entries format=duration -of csv=p=0 $Clip)
$fps = $N / $dur
ffmpeg -v error -y -i $Clip -vf "fps=$fps,scale=640:-1,drawtext=fontfile='C\:/Windows/Fonts/arial.ttf':text='%{pts\:hms}':x=8:y=8:fontsize=22:fontcolor=white:box=1:boxcolor=black@0.6,tile=4x$([math]::Ceiling($N/4))" -frames:v 1 $Out
"$Clip $([math]::Round($dur,1)) s"
