import { type Contact } from '../api';

/** What a title makes someone, decided by the server so the register, the
 *  outreach gate and this picker all mean the same thing by "board". */
export type Level = 'working' | 'executive' | 'board' | 'unknown';

/** Board first is the one thing this club must not do, so the order is the
 *  reverse of seniority: the people who answer, then the ones who might. */
export const LEVEL_RANK: Record<Level, number> = { working: 0, executive: 1, unknown: 2, board: 3 };

export const LEVEL_LABEL: Record<Level, string> = {
  working: 'Working level',
  executive: 'Executive',
  board: 'Board seat',
  unknown: 'Unknown role',
};

/** What each band asks a search to look for, in the company's own words. */
export const LEVEL_TITLES: Record<Exclude<Level, 'unknown'>, string> = {
  working: 'Director of, Head of, Manager, Lead',
  executive: 'Chief of Staff, VP, Vice President, Head of',
  board: 'Board member, Trustee, Director',
};

/** The one spelling of a company that the picker's groups, the lanes and the
 *  step counts all agree on. "A24" and "a24 " are the same company; without
 *  this a found person could land in a group beside their own lane. */
export function companyKey(name: string | null | undefined): string {
  return (name || '').trim().toLowerCase();
}

export function levelOf(person: Contact): Level {
  const raw = typeof person.person_level === 'string' ? person.person_level : '';
  return raw === 'working' || raw === 'executive' || raw === 'board' ? raw : 'unknown';
}

/** Anyone this campaign could actually reach. No address is not a choice the
 *  member gets to make, so those rows are shown but never selectable. */
export function isWritable(person: Contact): boolean {
  return Boolean(person.email);
}

/** The default tick: people who work there and can be reached, minus anyone
 *  already written to. A board seat is never ticked by default - reaching one
 *  is a deliberate act here, not a side effect of pressing "select all". */
export function defaultSelection(people: Contact[]): number[] {
  return people
    .filter((p) => isWritable(p) && !p.last_sent_at && levelOf(p) !== 'board')
    .map((p) => p.id);
}
