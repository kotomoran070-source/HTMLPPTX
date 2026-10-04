export const RULE: string;
export const PORTS: string;
export type FirewallState = 'skip' | 'ok' | 'fixed' | 'declined' | 'error';
export function ensureFirewall(opts?: { log?: (s: string) => void }): Promise<FirewallState>;
export function firewallMessage(state: FirewallState): string;
export type FirewallCheck = 'skip' | 'ok' | 'missing' | 'blocked' | 'error';
export function checkFirewall(): Promise<FirewallCheck>;
export function checkMessage(state: FirewallCheck): string;
