import type { IncomingMessage } from 'node:http';

/** Что можно с телефона: читать и отправлять сообщения пульта; из презентаций — только та, что в показе */
export function allowed(req: IncomingMessage, decks: string, deck: string): boolean;

/** Вход для телефона в локальной сети: open(имя) — порт входа или null; target — порт сервера приложения */
export function lanGateway(target: () => number, decksDir: string, log: (...a: unknown[]) => void): {
  open(name: string): Promise<number | null>;
  close(): void;
};
