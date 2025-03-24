const express = require('express');
const NodeMediaServer = require('node-media-server');
const path = require('path');
const { Client } = require('@elastic/elasticsearch');

const app = express();
const elasticClient = new Client({
    node: 'http://localhost:9200',
    auth: {
        apiKey: 'dGYyTXVaVUJCOXF0b19mQVN3RFY6LU4wUmh4SHBScXUtM2hpS3NDNlNoZw=='
    }
});

const mediaRoot = path.join(__dirname, 'media');

const config = {
    rtmp: { 
        port: 1935, 
        chunk_size: 60000,
        gop_cache: true,
        ping: 0,
        ping_timeout: 0
    },
    http: { 
        port: 8000, 
        allow_origin: '*', 
        mediaroot: mediaRoot 
    },
    trans: {
        ffmpeg: 'C:\\ProgramData\\chocolatey\\lib\\ffmpeg\\tools\\ffmpeg\\bin\\ffmpeg.exe',
        tasks: [{
            app: 'live',
            hls: true,
            hlsFlags: '[hls_time=2:hls_list_size=5:hls_flags=delete_segments]',
            hlsKeep: false
        }]
    }
};

const nms = new NodeMediaServer(config);

// Track stream start times
const streamStartTimes = new Map();

nms.on('postPublish', async (id, streamPath, args) => {
    console.log('[DEBUG] postPublish - id:', id);
    console.log('[DEBUG] postPublish - id.rtmp:', id.rtmp);
    console.log('[DEBUG] postPublish - id.streamPath:', id.streamPath);
    const actualStreamPath = id.streamPath || id.rtmp?.streamPath || streamPath || 'unknown';
    console.log(`[postPublish] Stream ${id.id || id} publishing - Path: ${actualStreamPath}`);
    
    // Record the start time
    streamStartTimes.set(id.id || id, new Date());
    
    const log = { 
        timestamp: new Date().toISOString(), 
        event: 'stream_started', 
        stream_id: id.id || id, 
        path: actualStreamPath, 
        args: args ? { ...args } : {}
    };
    try {
        const response = await elasticClient.index({ index: 'streaming_logs', body: log });
        console.log(`Stream ${id.id || id} started and indexed:`, response);
    } catch (error) {
        console.error('Elasticsearch error (start):', {
            message: error.message,
            name: error.name,
            meta: error.meta,
            body: error.meta?.body,
            error: error.meta?.body?.error,
            status: error.meta?.statusCode
        });
    }
    console.log('Raw event data:', { id, streamPath, args });
});

nms.on('donePublish', async (id, streamPath, args) => {
    console.log('[DEBUG] donePublish - id:', id);
    console.log('[DEBUG] donePublish - id.rtmp:', id.rtmp);
    console.log('[DEBUG] donePublish - id.streamPath:', id.streamPath);
    const actualStreamPath = id.streamPath || id.rtmp?.streamPath || streamPath || 'unknown';
    const endTime = new Date();
    
    // Calculate duration
    const startTime = streamStartTimes.get(id.id || id);
    const duration = startTime ? (endTime - startTime) / 1000 : 0; // Duration in seconds
    
    console.log(`[donePublish] Stream ${id.id || id} ended at ${endTime.toISOString()} - Path: ${actualStreamPath} - Duration: ${duration}s - Reason: Connection closed`);
    
    const log = { 
        timestamp: endTime.toISOString(), 
        event: 'stream_ended', 
        stream_id: id.id || id, 
        path: actualStreamPath, 
        duration: duration, // Add duration to the log
        args: args ? { ...args } : {}
    };
    try {
        const response = await elasticClient.index({ index: 'streaming_logs', body: log });
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
    
    // Clean up
    streamStartTimes.delete(id.id || id);
    console.log('Raw event data:', { id, streamPath, args });
});

nms.on('error', (err, context) => {
    console.error('NMS error:', err.message, context);
});

nms.run();

app.listen(3000, () => {
    console.log('Backend server running on http://localhost:3000');
});

app.get('/health', (req, res) => {
    res.json({ status: 'ok', nms: nms.getStatus ? nms.getStatus() : 'running' });
});