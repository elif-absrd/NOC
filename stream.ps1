while ($true) {
    & "C:\ProgramData\chocolatey\lib\ffmpeg\tools\ffmpeg\bin\ffmpeg.exe" -re -fflags +igndts -stream_loop -1 -i https://demo.unified-streaming.com/k8s/features/stable/video/tears-of-steel/tears-of-steel.ism/.m3u8 -c:v libx264 -preset ultrafast -tune zerolatency -b:v 500k -vf scale=854:480 -c:a aac -b:a 64k -f flv -map 0:v:0 -map 0:a:0 -avioflags direct -flush_packets 1 rtmp://localhost:1935/live/stream
    Write-Host "FFmpeg stopped. Restarting in 5 seconds..."
    Start-Sleep -Seconds 5
}