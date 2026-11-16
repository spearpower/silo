'use client';
// Choose PicknPlay Classic or PicknPlay Super (host, practice and quick game).
import { VARIANTS } from '@/lib/rules';
import type { Variant } from '@/lib/card-codes';

export default function VariantPicker({ value, onChange, name = 'variant' }: { value: Variant; onChange: (v: Variant) => void; name?: string }) {
	return (
		<div className="variant-pick" role="radiogroup" aria-label="Game variant">
			{VARIANTS.map(v => (
				<label key={v.id} className={value === v.id ? 'on' : ''}>
					<input type="radio" name={name} checked={value === v.id} onChange={() => onChange(v.id)} />
					<span className="vp-cards" aria-hidden="true">
						<img src="/cards/AS.svg" alt="" /><img src={v.id === 'super' ? '/cards/XR.svg' : '/cards/7H.svg'} alt="" />
					</span>
					<span className="vp-text"><b>{v.name}</b><span>{v.blurb}</span></span>
				</label>
			))}
		</div>
	);
}
