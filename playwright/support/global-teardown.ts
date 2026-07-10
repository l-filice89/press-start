import { execFileSync } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';
import { PID_FILE } from './server';

/** Kills the dev-server tree started by global-setup. */
export default async function globalTeardown() {
	let pid: number;
	try {
		pid = Number(readFileSync(PID_FILE, 'utf8'));
	} catch {
		return; // no server was started
	}
	try {
		if (process.platform === 'win32') {
			execFileSync('taskkill', ['/pid', String(pid), '/T', '/F'], {
				stdio: 'ignore',
			});
		} else {
			process.kill(-pid, 'SIGTERM'); // negative pid = whole process group (spawned detached)
		}
	} catch {
		// already gone
	}
	rmSync(PID_FILE, { force: true });
}
