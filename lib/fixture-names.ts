// FIXTURE NAMES — fid → "Team1 v Team2".
//
// The live TxLINE odds stream does not carry participant names, so the EC2
// worker tallied provenance under bare ids (e.g. "#18175397"). These names were
// resolved once from the TxLINE fixtures snapshot for the June 30 2026 World Cup
// session and are applied client-side so the recorded session reads in human
// terms on /desk and /proof. Unknown ids fall back to "#<fid>".

export const FIXTURE_NAMES: Record<string, string> = {
  "18143850": "Vietnam v Myanmar",
  "18172280": "Netherlands v Morocco",
  "18172379": "USA v Bosnia & Herzegovina",
  "18172469": "Brazil v Japan",
  "18175397": "Ivory Coast v Norway",
  "18175918": "Argentina v Cape Verde",
  "18175981": "France v Sweden",
  "18175983": "Germany v Paraguay",
  "18176123": "Australia v Egypt",
  "18179549": "Colombia v Ghana",
  "18179550": "Belgium v Senegal",
  "18179551": "Spain v Austria",
  "18179552": "Switzerland v Algeria",
  "18179759": "Mexico v Ecuador",
  "18179763": "Portugal v Croatia",
  "18179764": "England v Congo DR",
  "18182808": "Australia v Brazil",
  "18182864": "Australia v Brazil",
  "18185036": "Canada v Morocco",
  "18187298": "Brazil v Norway",
  "18188721": "Paraguay v France",
};

// "Team1 v Team2" for a fixture id, or "#<fid>" when unknown.
export function labelForFid(fid: string | number): string {
  const k = String(fid);
  return FIXTURE_NAMES[k] ?? `#${k}`;
}

// Replace a leading "#<fid>" in a match string with the resolved name, leaving
// already-named matches (and any trailing "· market" detail) untouched.
//   "#18175397 · OVERUNDER 2.5"  ->  "Ivory Coast v Norway · OVERUNDER 2.5"
export function relabelMatch(match: string): string {
  return match.replace(/^#(\d+)/, (whole, fid) => FIXTURE_NAMES[fid] ?? whole);
}
