@echo off
"C:\ProgramData\chocolatey\lib\ffmpeg\tools\ffmpeg\bin\ffmpeg.exe" -re -stream_loop -1 -i https://sample.vodobox.net/skate_phantom_flex_4k/skate_phantom_flex_4k.m3u8 -c:v libx264 -preset ultrafast -tune zerolatency -b:v 500k -vf scale=854:480 -c:a aac -b:a 64k -f flv rtmp://localhost/live/stream
pause