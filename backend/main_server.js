const express = require('express');
const NodeMediaServer = require('node-media-server');
const path = require('path');
const { Client } = require('@elastic/elasticsearch');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const dotenv = require('dotenv');
const cors = require('cors');
const { exec } = require('child_process');
const fs = require('fs');

dotenv.config();

const app = express();
app.use(express.json());
app.use(cors({
    origin: ["http://127.0.0.1:5500", "http://localhost:5500"],
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization']
}));

// Debug middleware to log requests
app.use((req, res, next) => {
    console.log(`Request for: ${req.path}, Static path: ${path.join(__dirname, 'media', 'live')}`);
    next();
});

// Serve static files from media/live, including the stream subdirectory
app.use('/live', express.static(path.join(__dirname, 'media', 'live')));
console.log('Serving static files from:', path.join(__dirname, 'media', 'live')); // Debug path

const JWT_SECRET = process.env.JWT_SECRET || 'fallback-secret-for-testing';

let users = {
    admin: { password: bcrypt.hashSync('admin123', 10), role: 'admin' },
    client1: { password: bcrypt.hashSync('client123', 10), role: 'client', approved: true }
};

const elasticClient = new Client({
    node: 'http://localhost:9200',
    auth: {
        apiKey: 'SEVXRkFwWUI0djd4WFhaYlNPX0w6aVJjODRQa19TVEdKQ0lhOXczcXkyZw=='
    }
});

elasticClient.ping()
    .then(() => console.log('Elasticsearch connected'))
    .catch(err => console.error('Elasticsearch connection failed:', err));

const mediaRoot = path.join(__dirname, 'media');
const streamDir = path.join(mediaRoot, 'live', 'stream');

// Ensure directory exists with error handling
try {
    fs.mkdirSync(streamDir, { recursive: true });
    console.log('mediaRoot:', mediaRoot);
    console.log('Stream directory created or verified at:', streamDir);

    // Test write permission
    const testFile = path.join(streamDir, 'test_write_permission.txt');
    fs.writeFileSync(testFile, 'Test write permission', { flag: 'w' });
    console.log('Successfully wrote test file to:', testFile);
    fs.unlinkSync(testFile); // Clean up test file
    console.log('Test file deleted successfully');
} catch (err) {
    console.error('Error creating or writing to stream directory:', err.message);
    console.error('Permissions issue detected. Ensure the directory is writable by the Node process.');
    process.exit(1); // Exit if permissions are insufficient
}

const config = {
    rtmp: { 
        port: 1935, 
        chunk_size: 60000,
        gop_cache: true,
        ping: 30,
        ping_timeout: 60
    },
    // Disable Node-Media-Server HTTP server to avoid port conflict
    http: false,
    trans: {
        ffmpeg: 'C:\\ProgramData\\chocolatey\\lib\\ffmpeg\\tools\\ffmpeg\\bin\\ffmpeg.exe',
        tasks: [{
            app: 'live',
            hls: true,
            hlsFlags: '[hls_time=4:hls_list_size=20:hls_flags=delete_segments+append_list]', // Increased to 20
            hlsKeep: false,
            hlsPath: streamDir
        }]
    },
    logType: 3 // Enable debug logging
};

// Ensure port is correctly applied (for RTMP only now)
if (!config.rtmp.port) {
    console.error('RTMP port is not defined. Setting to default 1935.');
    config.rtmp.port = 1935;
}
console.log('Config ports - RTMP:', config.rtmp.port);
console.log('HLS Path:', config.trans.tasks[0].hlsPath);

const nms = new NodeMediaServer(config);
const streamStartTimes = new Map();
const streamMetrics = new Map();

const getStreamMetrics = (streamId, streamPath) => {
    return new Promise((resolve, reject) => {
        const hlsUrl = `http://localhost:8000/live/${streamPath.replace('/live/', '')}/index.m3u8`;
        const hlsFilePath = path.join(config.trans.tasks[0].hlsPath, 'index.m3u8');
        console.log(`Checking HLS file at: ${hlsFilePath}`);

        const checkHls = (attempt = 0) => {
            if (!fs.existsSync(hlsFilePath) && attempt < 5) {
                console.warn(`HLS file not found at ${hlsFilePath}, retrying (${attempt + 1}/5)...`);
                return setTimeout(() => checkHls(attempt + 1), 1000); // Retry every 1 second
            }

            if (!fs.existsSync(hlsFilePath)) {
                console.warn(`HLS file not found after retries, using fallback metrics`);
                return resolve({
                    frames: 0, fps: 24, bitrate: 500000, throughput: 0, packetLoss: 0,
                    latency: 0, jitter: 0, bandwidth: 0, timestamp: new Date().toISOString()
                });
            }

            const ffprobePath = config.trans.ffmpeg.replace('ffmpeg.exe', 'ffprobe.exe');
            const ffprobeCommand = `${ffprobePath} -i ${hlsUrl} -show_streams -show_format -print_format json -loglevel error`;

            exec(ffprobeCommand, (error, stdout, stderr) => {
                console.log('FFprobe stdout:', stdout);
                console.log('FFprobe stderr:', stderr);
                let frames = 0, fps = 0, bitrate = 0;

                if (error) {
                    console.error(`FFprobe error for stream ${streamId}:`, error.message);
                    fps = 24; // Fallback FPS
                } else {
                    try {
                        const probeData = JSON.parse(stdout);
                        const videoStream = probeData.streams.find(stream => stream.codec_type === 'video');
                        if (videoStream) {
                            const [num, den] = videoStream.r_frame_rate.split('/').map(Number);
                            fps = den ? num / den : 24;
                            bitrate = parseInt(videoStream.bit_rate) || parseInt(probeData.format.bit_rate) || 500000; // Fallback to encoded bitrate
                            frames = parseInt(videoStream.nb_frames) || 0;
                            console.log(`Extracted FPS: ${fps}, Bitrate: ${bitrate}, Frames: ${frames}`);
                        } else {
                            console.warn('No video stream found, using default FPS');
                            fps = 24;
                            bitrate = 500000; // Fallback to encoded bitrate
                        }
                    } catch (e) {
                        console.warn('FFprobe parsing failed:', e.message);
                        fps = 24;
                        bitrate = 500000;
                    }
                }

                // Use FFmpeg for additional real-time stats
                const ffmpegCommand = `${config.trans.ffmpeg} -i ${hlsUrl} -f null - -vstats -loglevel debug`;
                exec(ffmpegCommand, (err, out, stderr) => {
                    let throughput = 0, bandwidth = 0, packetLoss = 0, latency = 0, jitter = 0;
                    if (err) {
                        console.error(`FFmpeg error for stream ${streamId}:`, err.message);
                    } else {
                        const lines = stderr.split('\n');
                        lines.forEach(line => {
                            if (line.includes('frame=')) frames = parseInt(line.match(/frame=\s*(\d+)/)?.[1]) || frames;
                            if (line.includes('fps=')) fps = parseFloat(line.match(/fps=\s*([\d\.]+)/)?.[1]) || fps;
                            if (line.includes('bitrate=')) bitrate = parseInt(line.match(/bitrate=\s*(\d+)/)?.[1]) || bitrate;
                            if (line.includes('speed=')) throughput = parseFloat(line.match(/speed=\s*([\d\.]+)/)?.[1]) || throughput;
                            // Note: Packet loss, latency, and jitter require network monitoring tools
                        });
                        bandwidth = bitrate * (throughput || 1) / 8 || 0; // Approximate bandwidth
                    }

                    resolve({
                        frames,
                        fps,
                        bitrate,
                        throughput: throughput || 0,
                        packetLoss: packetLoss || 0,
                        latency: latency || 0,
                        jitter: jitter || 0,
                        bandwidth: bandwidth || 0,
                        timestamp: new Date().toISOString()
                    });
                });
            });
        };

        checkHls();
    });
};

nms.on('prePublish', (id, streamPath, args) => {
    console.log(`[prePublish] Stream ${id} about to publish to ${streamPath}`);
});

nms.on('postPublish', async (id, streamPath, args) => {
    console.log('[DEBUG] postPublish - id:', id);
    const actualStreamPath = id.streamPath || id.rtmp?.streamPath || streamPath || '/live/stream';
    console.log(`[postPublish] Stream ${id.id || id} publishing - Path: ${actualStreamPath}`);

    streamStartTimes.set(id.id || id, new Date());

    const hlsCheckPath = path.join(config.trans.tasks[0].hlsPath, 'index.m3u8');
    console.log(`[postPublish] Checking HLS files in ${hlsCheckPath}`);
    fs.readdir(path.join(config.trans.tasks[0].hlsPath), (err, files) => {
        if (err) {
            console.error('Error reading stream directory:', err.message);
        } else {
            console.log('Files in stream directory:', files);
        }
    });

    setTimeout(async () => {
        try {
            const metrics = await getStreamMetrics(id.id || id, actualStreamPath);
            streamMetrics.set(id.id || id, metrics);
            const log = {
                '@timestamp': metrics.timestamp,
                event: 'stream_started',
                stream_id: id.id || id,
                path: actualStreamPath,
                args: args ? { ...args } : {},
                frames: metrics.frames,
                fps: metrics.fps,
                bitrate: metrics.bitrate,
                throughput: metrics.throughput,
                packet_loss: metrics.packetLoss,
                latency: metrics.latency,
                jitter: metrics.jitter,
                bandwidth: metrics.bandwidth
            };
            const response = await elasticClient.index({ index: 'streaming_logs_v3', body: log });
            console.log(`Stream ${id.id || id} started and indexed:`, response);
        } catch (error) {
            console.error('Elasticsearch error (start):', error);
        }
    }, 10000); // Increased to 5 seconds
});

nms.on('donePublish', async (id, streamPath, args) => {
    console.log('[DEBUG] donePublish - id:', id);
    console.log('[DEBUG] donePublish - id.rtmp:', id.rtmp);
    console.log('[DEBUG] donePublish - id.streamPath:', id.streamPath);
    const actualStreamPath = id.streamPath || id.rtmp?.streamPath || streamPath || 'unknown';
    const endTime = new Date();
    
    const startTime = streamStartTimes.get(id.id || id);
    const duration = startTime ? (endTime - startTime) / 1000 : 0;
    
    console.log(`[donePublish] Stream ${id.id || id} ended at ${endTime.toISOString()} - Path: ${actualStreamPath} - Duration: ${duration}s - Reason: Connection closed`);
    
    try {
        const metrics = await getStreamMetrics(id.id || id, actualStreamPath);
        streamMetrics.set(id.id || id, metrics);

        const log = { 
            '@timestamp': endTime.toISOString(),
            event: 'stream_ended', 
            stream_id: id.id || id, 
            path: actualStreamPath, 
            duration: duration,
            args: args ? { ...args } : {},
            frames: metrics.frames,
            fps: metrics.fps,
            bitrate: metrics.bitrate,
            throughput: metrics.throughput,
            packet_loss: metrics.packetLoss,
            latency: metrics.latency,
            jitter: metrics.jitter,
            bandwidth: metrics.bandwidth
        };
        const response = await elasticClient.index({ index: 'streaming_logs_v3', body: log });
        console.log(`Stream ${id.id || id} ended and indexed:`, response);
    } catch (error) {
        console.error('Elasticsearch error (end):', {
            message: error.message,
            name: error.name,
            meta: error.meta,
            body: error.meta?.body,
            error: error.meta?.body?.error,
            status: error.meta?.statusCode
        });
    }
    
    streamStartTimes.delete(id.id || id);
    streamMetrics.delete(id.id || id);
    console.log('Raw event data:', { id, streamPath, args });
});

nms.on('preTranscode', (id, streamPath, args) => {
    console.log('[preTranscode] Starting transcoding for', streamPath);
    fs.readdir(config.trans.tasks[0].hlsPath, (err, files) => {
        if (err) console.error('Error reading directory before transcoding:', err.message);
        else console.log('Files before transcoding:', files);
    });
});

nms.on('postTranscode', (id, streamPath, args) => {
    console.log('[postTranscode] Completed transcoding for', streamPath);
    fs.readdir(config.trans.tasks[0].hlsPath, (err, files) => {
        if (err) console.error('Error reading directory after transcoding:', err.message);
        else console.log('Files after transcoding:', files);
    });
});

nms.on('preConnect', (id, args) => {
    console.log('NMS Config:', nms.getConfig());
});

nms.on('error', (err, context) => {
    console.error('NMS error:', err.message, context);
});

nms.run();

// Start Express server on port 8000
app.listen(8000, () => {
    console.log('Backend server running on http://localhost:8000');
});

const verifyToken = (req, res, next) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'No token provided' });
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = decoded;
        next();
    } catch (error) {
        res.status(401).json({ error: 'Invalid token' });
    }
};

const isAdmin = (req, res, next) => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
    next();
};

const isClient = (req, res, next) => {
    if (req.user.role !== 'client' || !req.user.approved) return res.status(403).json({ error: 'Approved client access required' });
    next();
};

app.post('/login', async (req, res) => {
    const { username, password } = req.body;
    console.log('Login attempt:', { username, password }); // Debug log
    const user = users[username];
    if (!user || !await bcrypt.compare(password, user.password)) {
        console.log('Invalid credentials for:', username); // Debug log
        return res.status(401).json({ error: 'Invalid credentials' });
    }
    const token = jwt.sign({ username, role: user.role, approved: user.approved }, JWT_SECRET, { expiresIn: '1h' });
    console.log('Login successful, token generated for:', username); // Debug log
    res.json({ token });
});

app.post('/signup-client', (req, res) => {
    const { username, password } = req.body;
    if (users[username]) return res.status(400).json({ error: 'Username already exists' });
    users[username] = { password: bcrypt.hashSync(password, 10), role: 'client', approved: false };
    res.json({ message: 'Client signup request submitted. Awaiting approval.' });
});

app.get('/pending-clients', verifyToken, isAdmin, (req, res) => {
    const pending = Object.entries(users)
        .filter(([_, u]) => u.role === 'client' && !u.approved)
        .map(([username, u]) => ({ username }));
    res.json(pending);
});

app.post('/approve-client', verifyToken, isAdmin, (req, res) => {
    const { username, approve } = req.body;
    if (!users[username] || users[username].role !== 'client') {
        return res.status(404).json({ error: 'Client not found' });
    }
    if (approve) {
        users[username].approved = true;
        res.json({ message: 'Client approved' });
    } else {
        delete users[username];
        res.json({ message: 'Client request denied and removed' });
    }
});

app.get('/health', verifyToken, (req, res) => {
    res.json({ status: 'ok', nms: nms.getStatus ? nms.getStatus() : 'running' });
});

app.get('/stream-metrics', verifyToken, isClient, async (req, res) => {
    const metrics = await elasticClient.search({
        index: 'streaming_logs_v3',
        query: { match_all: {} },
        sort: [{ '@timestamp': 'desc' }],
        size: 10
    });
    res.json(metrics.hits.hits.map(hit => hit._source));
});

// Optional: Start FFmpeg process
// const ffmpegProcess = exec('powershell -File E:\\IITGN\\practise\\NOC-CSOC\\stream.ps1');
// ffmpegProcess.stdout.on('data', (data) => console.log(`FFmpeg: ${data}`));
// ffmpegProcess.stderr.on('data', (data) => console.error(`FFmpeg Error: ${data}`));
// ffmpegProcess.on('close', (code) => console.log(`FFmpeg process exited with code ${code}`));