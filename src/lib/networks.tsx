import { networkBrand } from './network-brands';

export { networkBrands, networkBrand } from './network-brands';

/** Brand-colored network label with its logo; falls back to plain text for unbranded networks (e.g. RSS). */
export function NetworkBadge({ network, className = '' }: { network: string; className?: string }) {
  const brand = networkBrand(network);
  if (!brand) return <span className={className}>{network}</span>;
  return (
    <span className={`atlas-network-badge ${className}`} style={{ color: brand.color }}>
      <svg viewBox={brand.logoViewBox} width="1em" height="1em" fill="currentColor" aria-hidden="true">
        <path d={brand.logoPath} />
      </svg>
      {brand.label}
    </span>
  );
}
