@echo off
ffmpeg -re -stream_loop -1 -i https://demo.unified-streaming.com/k8s/features/stable/video/tears-of-steel/tears-of-steel.ism/.m3u8 -c:v libx264 -preset ultrafast -tune zerolatency -b:v 500k -vf scale=854:480 -c:a aac -b:a 64k -f flv rtmp://localhost:1935/live/stream
pause