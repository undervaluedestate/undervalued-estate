import express from 'express';
import cors from 'cors';
import healthRouter from './routes/health';
import propertiesRouter from './routes/properties';
import benchmarksRouter from './routes/benchmarks';
import alertsRouter from './routes/alerts';
import scrapeRouter from './routes/scrape';
import diagnosticsRouter from './routes/diagnostics';
export const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));
// Simple request logger to diagnose hanging requests
app.use((req, res, next) => {
    const started = Date.now();
    const path = `${req.method} ${req.originalUrl}`;
    console.log('[req:start]', path);
    res.on('finish', () => {
        console.log('[req:done]', path, res.statusCode, `${Date.now() - started}ms`);
    });
    next();
});
app.use('/health', healthRouter);
app.use('/api/properties', propertiesRouter);
app.use('/api/benchmarks', benchmarksRouter);
app.use('/api/alerts', alertsRouter);
app.use('/api/scrape', scrapeRouter);
app.use('/api/diagnostics', diagnosticsRouter);
// Public ping (no auth) to validate that API path resolves quickly
app.get('/api/ping', (_req, res) => {
    res.json({ status: 'ok', t: new Date().toISOString() });
});
// Root route for quick status check
app.get('/', (_req, res) => {
    res.json({
        name: 'Undervalued Estate API',
        status: 'ok',
        time: new Date().toISOString(),
        endpoints: [
            'GET /health',
            'GET /api/properties',
            'GET /api/benchmarks',
            'GET /api/alerts (auth)',
            'POST /api/alerts (auth)',
            'POST /api/scrape/run (x-api-secret or Bearer)',
            'POST /api/scrape/benchmarks/refresh (x-api-secret or Bearer)'
        ],
    });
});
// Error handler
app.use((err, _req, res, _next) => {
    console.error('[Error]', err);
    res.status(err?.status || 500).json({ error: err?.message || 'Internal Server Error' });
});
