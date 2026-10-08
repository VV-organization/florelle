/** Same calendar boundary as backend checkout validation. */
export function minimumDeliveryDate(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Moscow' })
    .format(new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000));
}
