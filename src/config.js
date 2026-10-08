// Site settings the owner fills in by hand (no build step: plain values).
export const BOOKING = {
  // WhatsApp Business number for the "Забронювати" button of Crazy Tuk: international format, digits only, no "+"
  // (for example '34600123456'). Empty = the button says that the number is not set yet.
  whatsapp: '',
  // the message the player's WhatsApp opens with (one per language; A1 uses uk)
  text: {
    uk: 'Хочу справжній тур після гри Crazy Tuk',
    en: 'I want the real tour after playing Crazy Tuk',
    es: 'Quiero el tour real después de jugar a Crazy Tuk',
  },
};
// the link for the button, or null while the number is not set
export function bookingLink(lang = 'uk') {
  const n = String(BOOKING.whatsapp || '').replace(/\D/g, '');
  if (!n) return null;
  return `https://wa.me/${n}?text=${encodeURIComponent(BOOKING.text[lang] || BOOKING.text.uk)}`;
}
