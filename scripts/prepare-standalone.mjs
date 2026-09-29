import {cpSync,rmSync} from 'node:fs';
// Rebuilding must not retain retired fonts or public design studies.
for (const [source,destination] of [['public','.next/standalone/public'],['.next/static','.next/standalone/.next/static']]) {
  rmSync(destination,{recursive:true,force:true});
  cpSync(source,destination,{recursive:true});
}
