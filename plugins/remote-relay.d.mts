import type { IncomingMessage, ServerResponse } from 'node:http';

export function lanUrls(port: number): string[];
export function lanAddresses(): { name: string; ip: string; score: number }[];
export function isLocal(req: IncomingMessage): boolean;
export function remoteRelay(req: IncomingMessage, res: ServerResponse, net: () => { port: number; localOnly: boolean }): boolean;
