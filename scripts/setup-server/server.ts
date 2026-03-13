import fs from 'node:fs/promises';
import https from 'node:https';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { TlsCertificatePaths } from './types.js';
import { setupLogger } from './logger.js';

type RouteHandler = (
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
) => Promise<void> | void;

export class SetupServer {
  private readonly routes = new Map<string, RouteHandler>();

  private server?: https.Server;

  constructor(
    private readonly tls: TlsCertificatePaths,
    private readonly host: string,
    private readonly port = 443,
  ) {}

  register(pathname: string, handler: RouteHandler): void {
    this.routes.set(pathname, handler);
  }

  async start(): Promise<void> {
    const [cert, key] = await Promise.all([
      fs.readFile(this.tls.certPath),
      fs.readFile(this.tls.keyPath),
    ]);

    this.server = https.createServer(
      { cert, key },
      async (request, response) => {
        const requestUrl = new URL(
          request.url ?? '/',
          `https://${this.host}:${this.port}`,
        );
        const route = this.routes.get(requestUrl.pathname);

        if (!route) {
          writeHtml(response, 404, 'Not found', '<h1>Not found</h1>');
          return;
        }

        try {
          await route(request, response, requestUrl);
        } catch (error) {
          setupLogger.error(
            { err: error, path: requestUrl.pathname },
            'Setup server request failed',
          );
          if (!response.headersSent) {
            writeHtml(
              response,
              500,
              'Setup failed',
              '<h1>Setup failed</h1><p>Check the NanoClaw logs for details.</p>',
            );
          }
        }
      },
    );

    await new Promise<void>((resolve, reject) => {
      this.server?.once('error', reject);
      this.server?.listen(this.port, '0.0.0.0', () => resolve());
    });

    setupLogger.info(
      { host: this.host, port: this.port },
      'HTTPS setup server started',
    );
  }

  async stop(): Promise<void> {
    if (!this.server) {
      return;
    }

    await new Promise<void>((resolve, reject) => {
      this.server?.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });

    setupLogger.info(
      { host: this.host, port: this.port },
      'HTTPS setup server stopped',
    );
  }
}

export function writeHtml(
  response: ServerResponse,
  statusCode: number,
  title: string,
  body: string,
): void {
  response.writeHead(statusCode, {
    'content-type': 'text/html; charset=utf-8',
  });
  response.end(
    `<!doctype html><html><head><title>${title}</title></head><body>${body}</body></html>`,
  );
}
