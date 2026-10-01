import assert from 'node:assert/strict';
import {existsSync,readFileSync,readdirSync,statSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';

const root = 'out';
const prefix = '/florelle';
assert.ok(existsSync(join(root,'index.html')), 'Static export did not produce out/index.html');
assert.ok(!existsSync(join(root,'api')), 'Server API must never be published on Pages');
const catalog = JSON.parse(readFileSync('src/data/catalog.json','utf8'));
const routes = ['', 'b2b','b2c','catalog','cart','delivery','account','terms','privacy','checkout','orders','contacts','auth/register',
  ...new Set(catalog.items.map(item => 'products/' + item.product.slug))];
for (const route of routes) assert.ok(existsSync(join(root,route,'index.html')), `Missing exported route: ${route}`);
assert.ok(existsSync(join(root,'404.html')), 'Missing static 404');
let checked = 0;
function checkURL(value, from) {
  if (!value.startsWith('/') || value.startsWith('//')) return;
  assert.ok(value.startsWith(prefix + '/'), `Unprefixed URL in ${from}: ${value}`);
  const pathname = decodeURIComponent(new URL(value,'https://example.test').pathname.slice(prefix.length));
  const target = join(root,pathname);
  assert.ok(existsSync(target), `Missing asset/route in ${from}: ${value}`);
  if (statSync(target).isDirectory()) assert.ok(existsSync(join(target,'index.html')), `Missing directory index: ${value}`);
  checked++;
}
function walk(dir) {
  for (const entry of readdirSync(dir,{withFileTypes:true})) {
    const file = join(dir,entry.name);
    if (entry.isDirectory()) {walk(file); continue;}
    if (!/\.(html|css)$/.test(file)) continue;
    const text = readFileSync(file,'utf8');
    if (file.endsWith('.html')) {
      // Connection hints identify an origin, not a file or navigation target.
      const resourceHTML = text.replace(/<link\b[^>]*rel="(?:preconnect|dns-prefetch)"[^>]*>/g,'');
      for (const match of resourceHTML.matchAll(/(?:src|href)="([^"]+)"/g)) checkURL(match[1].replaceAll('&amp;','&'),file);
      for (const match of text.matchAll(/srcSet="([^"]+)"/gi)) {
        for (const candidate of match[1].split(',')) checkURL(candidate.trim().split(/\s/)[0],file);
      }
    } else {
      for (const match of text.matchAll(/url\(["']?([^\s"')]+)["']?\)/g)) checkURL(new URL(match[1], 'https://example.test' + prefix + '/' + file.replace(/^out\//,'')).pathname,file);
    }
  }
}
walk(root);
writeFileSync(join(root,'.nojekyll'),'');
console.log(`Verified ${routes.length} exported routes and ${checked} local URLs under ${prefix}/; no API routes.`);
