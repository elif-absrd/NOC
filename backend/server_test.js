const express = require('express');
const NodeMediaServer = require('node-media-server');
const path = require('path');
const { Client } = require('@elastic/elasticsearch');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const dotenv = require('dotenv');
const cors = require('cors');

dotenv.config();

const app = express();
app.use(express.json());
app.use(cors({
    origin: ["http://127.0.0.1:5500", "http://localhost:5500"],
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization']
  }));

// JWT Secret from environment variable
const JWT_SECRET = process.env.JWT_SECRET || 'fallback-secret-for-testing';

// In-memory user store (replace with a database in production)
let users = {
    admin: { password: bcrypt.hashSync('admin123', 10), role: 'admin' },
    client1: { password: bcrypt.hashSync('client123', 10), role: 'client', approved: true }
};

// Elasticsearch Client (unchanged)
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
const streamStartTimes = new Map();

// Stream Event Handlers (completely unchanged)
nms.on('postPublish', async (id, streamPath, args) => {
    console.log('[DEBUG] postPublish - id:', id);
    console.log('[DEBUG] postPublish - id.rtmp:', id.rtmp);
    console.log('[DEBUG] postPublish - id.streamPath:', id.streamPath);
    const actualStreamPath = id.streamPath || id.rtmp?.streamPath || streamPath || 'unknown';
    console.log(`[postPublish] Stream ${id.id || id} publishing - Path: ${actualStreamPath}`);
    
    streamStartTimes.set(id.id || id, new Date());
    
    const log = { 
        '@timestamp': new Date().toISOString(),
        event: 'stream_started', 
        stream_id: id.id || id, 
        path: actualStreamPath, 
        args: args ? { ...args } : {}
    };
    try {
        const response = await elasticClient.index({ index: 'streaming_logs_v2', body: log });
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
    
    const startTime = streamStartTimes.get(id.id || id);
    const duration = startTime ? (endTime - startTime) / 1000 : 0;
    
    console.log(`[donePublish] Stream ${id.id || id} ended at ${endTime.toISOString()} - Path: ${actualStreamPath} - Duration: ${duration}s - Reason: Connection closed`);
    
    const log = { 
        '@timestamp': endTime.toISOString(),
        event: 'stream_ended', 
        stream_id: id.id || id, 
        path: actualStreamPath, 
        duration: duration,
        args: args ? { ...args } : {}
    };
    try {
        const response = await elasticClient.index({ index: 'streaming_logs_v2', body: log });
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
    console.log('Raw event data:', { id, streamPath, args });
});

nms.on('error', (err, context) => {
    console.error('NMS error:', err.message, context);
});

nms.run();

// JWT Authentication Middleware
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

// Authentication Endpoints
app.post('/login', async (req, res) => {
    const { username, password } = req.body;
    const user = users[username];
    if (!user || !await bcrypt.compare(password, user.password)) {
        return res.status(401).json({ error: 'Invalid credentials' });
    }
    const token = jwt.sign({ username, role: user.role, approved: user.approved }, JWT_SECRET, { expiresIn: '1h' });
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

// Protected Health Endpoint
app.get('/health', verifyToken, (req, res) => {
    res.json({ status: 'ok', nms: nms.getStatus ? nms.getStatus() : 'running' });
});

app.listen(3001, () => {
    console.log('Backend server running on http://localhost:3001');
});