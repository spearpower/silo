import { randomInt } from 'crypto';
import { sql } from './db';
import { GameError } from './engine';
import { Session } from './session';
import { AVATARS, isAvatar } from './avatars';

interface UserRow { id: number; username: string; photo: string; role: 'player' | 'admin' | 'superadmin'; status: string; ok: boolean; is_bot?: boolean; must_change_password?: boolean }

export async function signIn(username: string, password: string): Promise<Session> {
	const u = (username || '').trim();
	if (!u || !password) throw new GameError('Enter your username and password');
	const [row] = await sql<UserRow[]>`
		select id, username, photo, role, status, is_bot, must_change_password, app_check_password(${password}, password_hash) as ok
		from users where lower(username) = lower(${u})`;
	// Same message for unknown user and wrong password, so usernames can't be probed
	if (!row || !row.ok || row.is_bot) throw new GameError('That username and password don’t match', 401);
	if (row.status !== 'active') throw new GameError('This account is suspended. Contact the admin.', 403);
	await sql`update users set last_login_at = now(), last_seen_at = now() where id = ${row.id}`;
	return { id: row.id, username: row.username, photo: row.photo, role: row.role, mustChange: !!row.must_change_password };
}

export interface SignUpInput { fullname: string; email: string; phone: string; username: string; password: string; repassword: string }

export async function signUp(input: Partial<SignUpInput>): Promise<Session> {
	const fullname = (input.fullname || '').trim();
	const username = (input.username || '').trim();
	const email = (input.email || '').trim() || null;
	const phone = (input.phone || '').replace(/\D/g, '') || null;
	const password = input.password || '';
	if (!fullname) throw new GameError('Enter your full name');
	if (!/^[A-Za-z0-9]{2,20}$/.test(username)) throw new GameError('Usernames are 2 to 20 letters or numbers, with no spaces');
	if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new GameError('That email doesn’t look right');
	if (phone && (phone.length < 9 || phone.length > 13)) throw new GameError('That phone number doesn’t look right');
	if (password.length < 6) throw new GameError('Use a password of at least 6 characters');
	if (password !== input.repassword) throw new GameError('The two passwords don’t match');

	const [taken] = await sql`select 1 from users where lower(username) = lower(${username})`;
	if (taken) throw new GameError('That username is taken. Try another.', 409);
	const photo = AVATARS[randomInt(AVATARS.length)];
	const [row] = await sql<{ id: number }[]>`
		insert into users (username, password_hash, fullname, email, phone, photo)
		values (${username}, app_hash_password(${password}), ${fullname}, ${email}, ${phone}, ${photo})
		returning id`;
	return { id: row.id, username, photo, role: 'player' };
}

// ---------- Account ----------

export interface Account { id: number; username: string; fullname: string; email: string | null; phone: string | null; photo: string; role: 'player' | 'admin' | 'superadmin' }

export async function getAccount(id: number): Promise<Account> {
	const [row] = await sql<Account[]>`select id, username, fullname, email, phone, photo, role from users where id = ${id} and not is_bot`;
	if (!row) throw new GameError('Account not found', 404);
	return row;
}

export interface AccountUpdate { username: string; fullname: string; email: string; phone: string; photo: string }

/** Update profile fields. Returns the fresh session data (the cookie carries username + avatar). */
export async function updateAccount(id: number, input: Partial<AccountUpdate>): Promise<Session> {
	const cur = await getAccount(id);
	const username = (input.username ?? cur.username).trim();
	const fullname = (input.fullname ?? cur.fullname).trim();
	const email = (input.email ?? cur.email ?? '').trim() || null;
	const phone = (input.phone ?? cur.phone ?? '').replace(/\D/g, '') || null;
	const photo = input.photo ?? cur.photo;
	if (!/^[A-Za-z0-9]{2,20}$/.test(username)) throw new GameError('Usernames are 2 to 20 letters or numbers, with no spaces');
	if (!fullname) throw new GameError('Enter your full name');
	if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new GameError('That email doesn’t look right');
	if (phone && (phone.length < 9 || phone.length > 13)) throw new GameError('That phone number doesn’t look right');
	if (!isAvatar(photo)) throw new GameError('Pick an avatar from the list');
	if (username.toLowerCase() !== cur.username.toLowerCase()) {
		const [taken] = await sql`select 1 from users where lower(username) = lower(${username}) and id <> ${id}`;
		if (taken) throw new GameError('That username is taken. Try another.', 409);
	}
	try {
		await sql`update users set username = ${username}, fullname = ${fullname}, email = ${email}, phone = ${phone}, photo = ${photo} where id = ${id}`;
	} catch (e) {
		if ((e as { code?: string }).code === '23505') throw new GameError('That username is taken. Try another.', 409);
		throw e;
	}
	return { id, username, photo, role: cur.role };
}

export async function changePassword(id: number, current: string, next: string, repeat: string): Promise<void> {
	if (next.length < 6) throw new GameError('Use a new password of at least 6 characters');
	if (next !== repeat) throw new GameError('The two new passwords don’t match');
	const [row] = await sql<{ ok: boolean }[]>`select app_check_password(${current}, password_hash) as ok from users where id = ${id} and not is_bot`;
	if (!row?.ok) throw new GameError('Your current password isn’t right', 403);
	await sql`update users set password_hash = app_hash_password(${next}), must_change_password = false where id = ${id}`;
}

/** After an admin reset: the player sets a new password (no current password needed, only while flagged). */
export async function setNewPassword(id: number, next: string, repeat: string): Promise<Session> {
	if (next.length < 6) throw new GameError('Use a new password of at least 6 characters');
	if (next !== repeat) throw new GameError('The two passwords don’t match');
	const [row] = await sql<{ id: number; username: string; photo: string; role: Session['role'] }[]>`
		update users set password_hash = app_hash_password(${next}), must_change_password = false
		where id = ${id} and must_change_password and not is_bot
		returning id, username, photo, role`;
	if (!row) throw new GameError('Your password was already changed. Sign in again.', 409);
	return { id: row.id, username: row.username, photo: row.photo, role: row.role };
}
