while ($true) {
    try {
        $ffmpegPath = "C:\ProgramData\chocolatey\lib\ffmpeg\tools\ffmpeg\bin\ffmpeg.exe"
        $ffmpegArgs = @(
            "-re",  # Read input at native frame rate
            "-fflags", "+genpts",  # Fix timestamp issues
            "-i", "https://demo.unified-streaming.com/k8s/features/stable/video/tears-of-steel/tears-of-steel.ism/.m3u8",
            "-c:v", "libx264",
            "-preset", "ultrafast",
            "-tune", "zerolatency",
            "-b:v", "500k",
            "-vf", "scale=854:480",
            "-c:a", "aac",
            "-b:a", "64k",
            "-f", "tee",
            "-map", "0:v:0",
            "-map", "0:a:0",
            "[f=flv]rtmp://localhost:1935/live/stream|[f=hls:hls_time=4:hls_list_size=10:hls_flags=delete_segments+append_list]E:/IITGN/practise/NOC-CSOC/backend/media/live/stream/index.m3u8"
        )
        & $ffmpegPath $ffmpegArgs
        Write-Host "FFmpeg stopped. Restarting in 5 seconds..."
    } catch {
        Write-Host "FFmpeg error occurred: $_ . Restarting in 5 seconds..."
    }
    Start-Sleep -Seconds 5
}