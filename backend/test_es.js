const { Client } = require('@elastic/elasticsearch');
const client = new Client({ 
    node: 'http://localhost:9200', 
    auth: { apiKey: 'dGYyTXVaVUJCOXF0b19mQVN3RFY6LU4wUmh4SHBScXUtM2hpS3NDNlNoZw==' }
});

async function testIndex() {
    try {
        console.log('Attempting to index document...');
        const response = await client.index({ 
            index: 'streaming_logs', 
            body: { timestamp: new Date().toISOString(), event: 'test' } 
        });
        console.log('Test:', response.body || response);
    } catch (err) {
        console.error('Test error:', {
            message: err.message,
            name: err.name,
            stack: err.stack,
            meta: err.meta,
            body: err.meta?.body,
            error: err.meta?.body?.error,
            status: err.meta?.statusCode,
            rawError: err
        });
    }
}

testIndex();