import {describe,it,expect} from 'vitest';
import {nativePriceWrite} from '../native-pricing';
describe('catalog native price writes',()=>{
 it('updates RUB wholesale without silently changing independent retail price',()=>{
  expect(nativePriceWrite({price:{amountMinor:5500,currency:'RUB'},attributes:{}},{retailPrice:'137.11',referencePrice:'70.87',wholesalePrice:'54.84'},80,2.5)).toMatchObject({priceCurrency:'RUB',wholesalePrice:'55.00',retailPrice:'137.11',referencePrice:'70.87',sellerPriceUsd:'0.69'});
 });
 it('converts a legacy USD write and permits explicit native retail and reference values',()=>{
  expect(nativePriceWrite({price:{amountMinor:100,currency:'USD'},attributes:{retailPrice:'190.12',referencePrice:'99.99'}},null,80,2.5)).toMatchObject({wholesalePrice:'80.00',retailPrice:'190.12',referencePrice:'99.99'});
 });
 it('rejects unknown currencies and missing exchange rates instead of corrupting prices',()=>{
  expect(()=>nativePriceWrite({price:{amountMinor:100,currency:'EUR'},attributes:{}},null,80,2.5)).toThrow();
  expect(()=>nativePriceWrite({price:{amountMinor:100,currency:'RUB'},attributes:{}},null,0,2.5)).toThrow();
 });
});
