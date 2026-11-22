// Totale kostprijs van tweedehandsaankopen naar België (verzending + platformkosten).
import { round2 } from './util.js';

// Schattingen; pas aan als tarieven wijzigen. Altijd als "schatting" getoond in de app.
export const ESTIMATES = {
  vintedShipping: 3.5,          // goedkoopste afhaalpunt-verzending binnen BE/NL, ongeveer
  vintedProtectionFixed: 0.7,   // kopersbescherming: vast deel
  vintedProtectionPct: 0.05,    // + percentage van de prijs
  marketplaceShipping: 5.0,     // particuliere verzending (bpost / Shop2Shop / PostNL)
};

export function secondhandCost(l) {
  if (l.price == null) return { total: null, breakdown: [], estimated: true };
  const b = [{ label: 'Prijs', amount: l.price }];
  let estimated = false;
  if (l.source === 'vinted') {
    const protection = l.priceInclProtection != null
      ? round2(l.priceInclProtection - l.price)
      : (estimated = true, round2(ESTIMATES.vintedProtectionFixed + l.price * ESTIMATES.vintedProtectionPct));
    b.push({ label: 'Kopersbescherming', amount: protection });
    const ship = l.sellerShipping ?? (estimated = true, ESTIMATES.vintedShipping);
    b.push({ label: 'Verzending', amount: ship });
  } else if (l.pickupOnly) {
    b.push({ label: `Ophalen${l.location ? ' in ' + l.location : ''}`, amount: 0 });
  } else {
    const ship = l.sellerShipping ?? (estimated = true, ESTIMATES.marketplaceShipping);
    b.push({ label: 'Verzending', amount: ship });
  }
  return { total: round2(b.reduce((s, x) => s + x.amount, 0)), breakdown: b, estimated };
}
