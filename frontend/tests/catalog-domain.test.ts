import test from 'node:test';
import assert from 'node:assert/strict';
import {colorGroup,estimatedBoxWeightKg,type Listing} from '../src/lib/catalog.ts';
for(const color of ['blue','gold','brown','sand','unknown',''])test(`${color} does not appear as a mixed flower`,()=>{
 assert.notEqual(colorGroup({color,product:{slug:'old-multicolor-slug'}} as Listing),'mixed');
});
for(const color of ['multicolor','mixed'])test(`${color} is explicitly mixed`,()=>{
 assert.equal(colorGroup({color} as Listing),'mixed');
});
test('box and shipment weight keep the existing rounding and formula',()=>{
 assert.equal(estimatedBoxWeightKg(100),10);
 assert.equal(estimatedBoxWeightKg(200),19);
 assert.equal(estimatedBoxWeightKg(250),23);
});
