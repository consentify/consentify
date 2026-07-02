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
	let pathname;
	try {
		pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
	} catch {
		res.writeHead(400);
		res.end('Bad request');
		return;
	}

	// Map /consentify.iife.min.js to the built bundle
	if (pathname === '/consentify.iife.min.js') {
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

	// Serve fixtures directory. Contain the resolved path within it: normalize
	// after joining, then require the fixtures root itself or a child of it
	// (root + separator prefix, so sibling dirs like `fixtures-evil` never match).
	const fixtures = path.join(__dir, 'fixtures');
	const resolved = path.normalize(path.join(fixtures, pathname));
	if (resolved !== fixtures && !resolved.startsWith(fixtures + path.sep)) {
		res.writeHead(404);
		res.end('Not found');
		return;
	}
	let filePath = pathname === '/' ? path.join(fixtures, 'index.html') : resolved;

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
