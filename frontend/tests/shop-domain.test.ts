import test from 'node:test';
import assert from 'node:assert/strict';
import {accountSegment,segmentRedirect,canVisitSegment} from '../src/lib/shop-domain.ts';

test('guests can visit either direction and the entrance',()=>{
 for(const path of ['/','/b2b','/b2c','/catalog']){
  assert.equal(segmentRedirect(null,path,'segment=b2b'),null);
 }
 assert.equal(accountSegment(null),null);
 assert.equal(canVisitSegment(null,'b2b'),true);
 assert.equal(canVisitSegment(null,'b2c'),true);
});

for(const [customerType,own,other] of [
 ['individual','b2c','b2b'],['legal_entity','b2b','b2c'],
] as const){
 const user={customerType};
 test(`${customerType} can only enter their account's direction`,()=>{
  assert.equal(accountSegment(user),own);
  assert.equal(canVisitSegment(user,own),true);
  assert.equal(canVisitSegment(user,other),false);
  assert.equal(segmentRedirect(user,'/',''),'/'+own);
  assert.equal(segmentRedirect(user,'/'+other,''),'/'+own);
  assert.equal(segmentRedirect(user,'/'+own,''),null);
 });
 test(`${customerType} direct catalog links preserve filters and correct the direction`,()=>{
  assert.equal(segmentRedirect(user,'/catalog',`category=roses&segment=${other}&q=pink`),`/catalog?category=roses&segment=${own}&q=pink`);
  assert.equal(segmentRedirect(user,'/'+other,`utm_source=email&segment=${other}`),`/${own}?utm_source=email&segment=${own}`);
  assert.equal(segmentRedirect(user,'/catalog',`segment=${own}&segment=${other}`),`/catalog?segment=${own}`);
  assert.equal(segmentRedirect(user,'/catalog',`segment=${own}`),null);
  for(const path of ['/catalog','/products/rose','/account','/checkout','/delivery','/orders/123','/payment/123','/privacy']){
   assert.equal(segmentRedirect(user,path,'currency=RUB'),null);
  }
 });
}
