import {describe, expect, it} from 'vitest';
import {checkoutSchema} from '../commerce.router';

describe('customer checkout without a delivery schedule', () => {
 const input = {segment:'b2c', shippingAddress:{address:'Test street 100',contactName:'Test customer',contactPhone:'+79001234567'}, delivery:{countryCode:'RU',cityValue:'Moscow',mode:0}};
 it.each(['b2c','b2b'])('accepts %s checkout without date and time', segment => {
  expect(checkoutSchema.parse({...input,segment}).delivery).toEqual(input.delivery);
 });
 it('discards schedule fields sent by an old client instead of assigning delivery', () => {
  expect(checkoutSchema.parse({...input,delivery:{...input.delivery,date:'2020-01-01',window:'09:00–13:00'}}).delivery).toEqual(input.delivery);
 });
});
