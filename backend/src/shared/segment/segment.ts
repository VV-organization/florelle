import { customerTypeEnum } from '../db/schema/users';

export type Segment = 'b2b' | 'b2c';
export type CustomerType = (typeof customerTypeEnum.enumValues)[number];

export function mapCustomerTypeToSegment(t: CustomerType): Segment {
  return t === 'legal_entity' ? 'b2b' : 'b2c';
}

export function expectedCustomerTypeForSegment(s: Segment): CustomerType {
  return s === 'b2b' ? 'legal_entity' : 'individual';
}
