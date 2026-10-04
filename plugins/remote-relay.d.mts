import type { IncomingMessage, ServerResponse } from 'node:http';

export function lanUrls(port: number): string[];
export function lanAddresses(): { name: string; ip: string; score: number }[];
export function isLocal(req: IncomingMessage): boolean;
export interface RelayNet {
  port: number;
  localOnly: boolean;
  /** Сервер приложения Slideria: вход для телефона открывается по запросу */
  app?: boolean;
}
export function remoteRelay(req: IncomingMessage, res: ServerResponse, net: () => RelayNet | Promise<RelayNet>): boolean;
