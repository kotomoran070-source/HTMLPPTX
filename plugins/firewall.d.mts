export const RULE: string;
export const PORTS: string;
export type FirewallState = 'skip' | 'ok' | 'fixed' | 'declined' | 'error';
export function ensureFirewall(opts?: { log?: (s: string) => void }): Promise<FirewallState>;
export function firewallMessage(state: FirewallState): string;
