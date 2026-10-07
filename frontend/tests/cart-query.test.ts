import {test} from 'node:test';
import assert from 'node:assert/strict';
import {loadCart} from '../src/lib/cart-query.ts';
test('a consumed checkout cart is an empty cart, not a global error banner',async()=>{
 const cart=await loadCart(async()=>{throw Object.assign(new Error('Корзина пуста'),{status:404,code:'CART_NOT_FOUND'});},'RUB');
 assert.deepEqual(cart.items,[]);assert.equal(cart.total,'0.00');assert.equal(cart.currency,'RUB');
});
test('authentication, stock and server failures remain visible',async()=>{
 for(const error of [Object.assign(new Error('auth'),{status:401,code:'UNAUTHORIZED'}),Object.assign(new Error('db'),{status:503,code:'CART_NOT_FOUND'}),Object.assign(new Error('stock'),{status:404,code:'LISTING_UNAVAILABLE'})])await assert.rejects(loadCart(async()=>{throw error;},'RUB'),e=>e===error);
});
