export default function AuthBrand({ title, subtitle }: { title: string; subtitle?: string }) {
	return (
		<div className="auth-brand">
			<img src="/icons/icon-192.png" alt="Silo" width={64} height={64} />
			<h1>{title}</h1>
			{subtitle && <p>{subtitle}</p>}
		</div>
	);
}
