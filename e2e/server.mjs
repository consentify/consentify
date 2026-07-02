import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dir = path.dirname(fileURLToPath(import.meta.url));
const port = process.env.PORT || 4173;

const mimeTypes = {
	'.html': 'text/html',
	'.js': 'application/javascript',
	'.json': 'application/json',
	'.css': 'text/css',
};

const server = http.createServer((req, res) => {
	// Map /consentify.iife.min.js to the built bundle
	if (req.url === '/consentify.iife.min.js') {
		const bundlePath = path.join(__dir, '../packages/core/dist/consentify.iife.min.js');
		try {
			const content = fs.readFileSync(bundlePath);
			res.writeHead(200, { 'Content-Type': 'application/javascript' });
			res.end(content);
			return;
		} catch (err) {
			res.writeHead(404);
			res.end('Not found');
			return;
		}
	}

	// Serve fixtures directory
	const fixtures = path.join(__dir, 'fixtures');
	let filePath = path.join(fixtures, req.url === '/' ? 'index.html' : req.url);

	// Prevent path traversal
	if (!filePath.startsWith(fixtures)) {
		res.writeHead(404);
		res.end('Not found');
		return;
	}

	try {
		const stat = fs.statSync(filePath);
		if (stat.isDirectory()) {
			filePath = path.join(filePath, 'index.html');
		}

		const ext = path.extname(filePath);
		const mimeType = mimeTypes[ext] || 'application/octet-stream';
		const content = fs.readFileSync(filePath);

		res.writeHead(200, { 'Content-Type': mimeType });
		res.end(content);
	} catch (err) {
		res.writeHead(404);
		res.end('Not found');
	}
});

server.listen(port, () => {
	console.log(`E2E server listening on http://localhost:${port}`);
});
