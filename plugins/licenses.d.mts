import type { Plugin } from 'vite';
export interface PackageInfo { dir: string; name: string; version: string; license: string; text: string }
export const PERMISSIVE: Set<string>;
export const LGPL_OK: Set<string>;
export function spdxOk(expr: string, allowed?: Set<string>): boolean;
export function readPackage(dir: string): PackageInfo;
export function packageDirOf(id: string): string | null;
export function prodPackages(root: string): PackageInfo[];
export function checkLicenses(pkgs: PackageInfo[], opts?: { html?: boolean }): PackageInfo[];
export function noticeText(pkgs: Omit<PackageInfo, 'dir'>[], fonts?: string): string;
export function licenseNotice(root: string, opts?: { manifest?: string }): Plugin[];
export function kitFontsIn(html: string, root: string): string[];
export function noticeInto(html: string, pkgs: Omit<PackageInfo, 'dir'>[], root: string): string;
export function electronFiles(): { electron: string; chromium: string };
export function licensesPage(root: string, chromiumUrl?: string): string;
