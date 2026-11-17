'use client';
import { supabase } from '../supabase/browser';

const TYPES = ['image/png', 'image/jpeg', 'image/webp'];

/** Square-crop and shrink a picture in the browser (max 512 px, WebP), so uploads are small and EXIF is dropped. */
export async function squareImage(file: File, size = 512): Promise<Blob> {
	if (!TYPES.includes(file.type)) throw new Error('Choose a PNG, JPEG or WebP picture');
	if (file.size > 15 * 1024 * 1024) throw new Error('That picture is too large');
	const bmp = await createImageBitmap(file);
	const side = Math.min(bmp.width, bmp.height);
	const out = Math.min(size, side);
	const canvas = document.createElement('canvas');
	canvas.width = canvas.height = out;
	const g = canvas.getContext('2d')!;
	g.drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, out, out);
	bmp.close();
	const blob = await new Promise<Blob | null>(r => canvas.toBlob(r, 'image/webp', 0.86));
	if (!blob) throw new Error('Couldn’t read that picture');
	return blob;
}

/** Upload to a public-read bucket under a folder the Storage policies allow; returns the public URL. */
export async function uploadPicture(bucket: 'avatars' | 'group-photos', folder: string, file: File): Promise<string> {
	const blob = await squareImage(file);
	const path = `${folder}/${crypto.randomUUID()}.webp`;
	const db = supabase();
	const { error } = await db.storage.from(bucket).upload(path, blob, { contentType: 'image/webp', cacheControl: '31536000', upsert: false });
	if (error) throw new Error('Upload failed. Try again.');
	return db.storage.from(bucket).getPublicUrl(path).data.publicUrl;
}
