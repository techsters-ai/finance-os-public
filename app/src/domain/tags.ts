// Tags: global labels on transactions, usable with any category ('groceries', 'trip to bali').
// Stored lowercase and comma-separated so the spreadsheet can split them.

export function cleanTag(raw: string): string {
  return raw.replace(/[,#]/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase().slice(0, 40);
}

export function parseTags(s: string): string[] {
  const out: string[] = [];
  for (const part of s.split(',')) {
    const t = cleanTag(part);
    if (t && !out.includes(t)) out.push(t);
  }
  return out;
}

export function joinTags(list: string[]): string {
  return parseTags(list.join(',')).join(', ');
}

export function hasTag(tags: string, tag: string): boolean {
  return parseTags(tags).includes(tag);
}
