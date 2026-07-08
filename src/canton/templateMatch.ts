// Same rule the backend uses, duplicated here so the browser bundle doesn't
// pull in server code. Template ids come back as either
// `#<packageName>:Mod:Ent` or `<packageId>:Mod:Ent`; the tail identifies
// the template unambiguously.
export function matchesTemplateIdBrowser(actual: string, expected: string): boolean {
  const tail = (s: string) => s.split(':').slice(-2).join(':');
  return tail(actual) === tail(expected);
}
