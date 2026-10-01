// How the rest of the accommodation can be paid at the house (tourModel.js's
// onSitePayment) - the tour edit form's Fizetési módok; shown to attendees
// on the attendee list's Fizetendő header and in the Programfüzet.

// The request body as it's saved: just the three methods.
export function cleanOnSitePayment(body) {
  return {
    cash: body?.cash === true,
    card: body?.card === true,
    szep: body?.szep === true,
  };
}

// "készpénz, bankkártya, SZÉP kártya" - or null when none is set.
export function onSitePaymentText(payment) {
  if (!payment) return null;
  const methods = [
    payment.cash && 'készpénz',
    payment.card && 'bankkártya',
    payment.szep && 'SZÉP kártya',
  ].filter(Boolean);
  return methods.length ? methods.join(', ') : null;
}
