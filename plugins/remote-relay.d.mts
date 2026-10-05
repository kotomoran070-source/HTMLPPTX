import type { IncomingMessage, ServerResponse } from 'node:http';

export function lanUrls(port: number): string[];
export function lanAddresses(): { name: string; ip: string; score: number }[];
export function isLocal(req: IncomingMessage): boolean;
export const LAN_HEADER: string;
/** Можно ли запросу из сети что-то получить: пропуск телефона или одноразовая ссылка */
export function lanPass(req: IncomingMessage): boolean;
export function deviceOf(req: IncomingMessage): { id: string; room: string; name: string } | null;
/** Страница «отсканируйте QR» для телефона без пропуска */
export function denyPage(res: ServerResponse, why?: string, code?: number): void;
export interface RelayNet {
  port: number;
  localOnly: boolean;
  /** Сервер приложения Slideria: вход для телефона открывается по запросу */
  app?: boolean;
  /** Приложение под Windows: в окне с QR есть кнопка «Разрешить в брандмауэре» */
  firewall?: boolean;
}
export function remoteRelay(req: IncomingMessage, res: ServerResponse, net: () => RelayNet | Promise<RelayNet>): boolean;
