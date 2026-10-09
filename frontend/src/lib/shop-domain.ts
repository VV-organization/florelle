import type {Segment} from './catalog';
import type {User} from './storefront-types';

type Account = Pick<User,'customerType'> | null;

export function accountSegment(user:Account):Segment|null {
 return user ? (user.customerType==='legal_entity'?'b2b':'b2c') : null;
}

export function canVisitSegment(user:Account,segment:Segment):boolean {
 const bound=accountSegment(user);
 return bound===null||bound===segment;
}

/** Keep shared pages and their filters, but canonicalize account-bound directions. */
export function segmentRedirect(user:Account,path:string,search:string):string|null {
 const bound=accountSegment(user);
 if(!bound)return null;
 const target=path==='/'||path==='/b2b'||path==='/b2c'?'/'+bound:path;
 const params=new URLSearchParams(search);
 const segments=params.getAll('segment');
 const correctQuery=segments.some(value=>value!==bound);
 if(correctQuery)params.set('segment',bound);
 if(target===path&&!correctQuery)return null;
 const query=params.toString();
 return target+(query?'?'+query:'');
}
