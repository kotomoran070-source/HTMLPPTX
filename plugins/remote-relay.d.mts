import type { IncomingMessage, ServerResponse } from 'node:http';

export function lanUrls(port: number): string[];
export function lanAddresses(): { name: string; ip: string; score: number }[];
export function isLocal(req: IncomingMessage): boolean;
export interface RelayNet {
  port: number;
  localOnly: boolean;
  /** Сервер приложения Slideria: вход для телефона открывается по запросу */
  app?: boolean;
  /** Приложение под Windows: в окне с QR есть кнопка «Разрешить в брандмауэре» */
  firewall?: boolean;
}
export function remoteRelay(req: IncomingMessage, res: ServerResponse, net: () => RelayNet | Promise<RelayNet>): boolean;
