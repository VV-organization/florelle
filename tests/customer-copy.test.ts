import test from 'node:test';
import assert from 'node:assert/strict';
import {readdirSync,readFileSync} from 'node:fs';
const folder=new URL('../src/components/',import.meta.url);
test('customer translations exclude demo labels and developer handoff notes',()=>{
 for(const file of readdirSync(folder).filter(f=>f.endsWith('.tsx'))){
  const source=readFileSync(new URL(file,folder),'utf8');
  for(const match of source.matchAll(/s\.t\('([^']*)','([^']*)'\)/g)){
   assert.doesNotMatch(match[1]+' '+match[2],/демонстрац|\bдемо\b|\bdemo\b|\bpreview\b|макет|после подключения|ожидаем данные владельца|перед запуском/i,file);
  }
 }
});
test('customers cannot simulate payment success or manually choose order states',()=>{
 const source=readFileSync(new URL('commerce-preview.tsx',folder),'utf8');
 assert.doesNotMatch(source,/change\('paid'\)|value=\{order.status\}/);
 assert.doesNotMatch(readFileSync(new URL('registration-preview.tsx',folder),'utf8'),/123456/);
});
