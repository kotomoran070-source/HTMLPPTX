import type { Plugin } from 'vite';
export interface PackageInfo { dir: string; name: string; version: string; license: string; text: string }
export const PERMISSIVE: Set<string>;
export const LGPL_OK: Set<string>;
export function spdxOk(expr: string, allowed?: Set<string>): boolean;
export function readPackage(dir: string): PackageInfo;
export function packageDirOf(id: string): string | null;
export function prodPackages(root: string): PackageInfo[];
export function checkLicenses(pkgs: PackageInfo[], opts?: { html?: boolean }): PackageInfo[];
export function noticeText(pkgs: PackageInfo[], fonts?: string): string;
export function licenseNotice(root: string): Plugin[];
