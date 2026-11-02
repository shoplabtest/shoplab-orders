import type { Config } from '../config.ts';

export interface CatalogClient {
  /** Unit price in minor units, or null when the product is unknown or the catalog is unreachable. */
  unitPrice(productId: string): Promise<number | null>;
}

interface CatalogProduct { id: string; price: { amount: number; currency: string } }

export class HttpCatalogClient implements CatalogClient {
  constructor(private cfg: Pick<Config, 'catalogApiUrl'>) {}

  async unitPrice(productId: string) {
    try {
      const res = await fetch(`${this.cfg.catalogApiUrl}/products/${encodeURIComponent(productId)}`);
      if (!res.ok) return null;
      return ((await res.json()) as CatalogProduct).price.amount;
    } catch {
      return null;
    }
  }
}
