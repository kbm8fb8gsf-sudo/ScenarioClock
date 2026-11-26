// A stand-in for an OpenAI-compatible API. Records every request; replies from a script.
//   POST /__script   {"replies": ["...", ...]}  queue the next replies
//   GET  /__requests                             everything received so far
//   POST /__reset                                forget requests and queued replies
import http from 'node:http';

const PORT = Number(process.env.PORT ?? 5001);
const requests = [];
let queue = [];
const DEFAULT_REPLY = '"Sounds good." *She nods.* [TIME: +2m]';

function send(res, status, body) {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
}

function readBody(req) {
    return new Promise((resolve) => {
        let data = '';
        req.on('data', (chunk) => (data += chunk));
        req.on('end', () => resolve(data ? JSON.parse(data) : {}));
    });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    if (req.method === 'GET' && url.pathname === '/v1/models') {
        return send(res, 200, { object: 'list', data: [{ id: 'fake-model', object: 'model' }] });
    }
    if (req.method === 'GET' && url.pathname === '/__requests') return send(res, 200, requests);
    if (req.method === 'POST' && url.pathname === '/__reset') {
        requests.length = 0;
        queue = [];
        return send(res, 200, { ok: true });
    }
    if (req.method === 'POST' && url.pathname === '/__script') {
        const body = await readBody(req);
        queue.push(...(body.replies ?? []));
        return send(res, 200, { queued: queue.length });
    }
    if (req.method === 'POST' && url.pathname === '/v1/chat/completions') {
        const body = await readBody(req);
        const reply = queue.length ? queue.shift() : DEFAULT_REPLY;
        requests.push({ at: new Date().toISOString(), stream: Boolean(body.stream), messages: body.messages, reply });
        console.log(`[fake-ai] request #${requests.length} (${body.messages?.length} messages, stream=${Boolean(body.stream)})`);
        if (!body.stream) {
            return send(res, 200, {
                id: `cmpl-${requests.length}`, object: 'chat.completion', model: 'fake-model',
                choices: [{ index: 0, message: { role: 'assistant', content: reply }, finish_reason: 'stop' }],
                usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
            });
        }
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
        // Small pieces, slowly, so a browser can be watched mid-stream.
        const pieces = reply.match(/.{1,4}/gs) ?? [];
        for (const piece of pieces) {
            res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: piece } }] })}\n\n`);
            await sleep(Number(process.env.STREAM_DELAY ?? 60));
        }
        res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\n`);
        res.write('data: [DONE]\n\n');
        return res.end();
    }
    send(res, 404, { error: 'not found' });
}).listen(PORT, '127.0.0.1', () => console.log(`[fake-ai] listening on ${PORT}`));
