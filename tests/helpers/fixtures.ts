/**
 * Stable ids for the seed fixtures, so tests read as statements about people
 * rather than about UUIDs.
 */

export const PERSON = {
  adrienneDeLisio: '11111111-0000-4000-8000-000000000001', // producing, tier A, Expo East
  ericaGendell: '11111111-0000-4000-8000-000000000002', // the connector; operator owes her
  amandaKellerman: '11111111-0000-4000-8000-000000000003', // introduced by Erica
  devonRuiz: '11111111-0000-4000-8000-000000000004', // introduced by Amanda — chain link 3
  marcusVance: '11111111-0000-4000-8000-000000000005', // structured finance at a general firm
  priyaRaghunathan: '11111111-0000-4000-8000-000000000006', // the CPG accountant
  ninaOkafor: '11111111-0000-4000-8000-000000000007', // card at day 180, active now
  grantWhitfield: '11111111-0000-4000-8000-000000000008', // card at day 180, producing now
  hollisTran: '11111111-0000-4000-8000-000000000009', // tier D — never queued
  sashaNolan: '11111111-0000-4000-8000-000000000010', // Broker Fest 2026, active by day 30
  rubenDiaz: '11111111-0000-4000-8000-000000000011', // met once, never followed up
  camilleBoucher: '11111111-0000-4000-8000-000000000012',
  walterNg: '11111111-0000-4000-8000-000000000013', // do_not_contact
  danaFerraro: '11111111-0000-4000-8000-000000000014', // job change
  beatriceSolomon: '11111111-0000-4000-8000-000000000015',
  jamalWhitaker: '11111111-0000-4000-8000-000000000016',
  rosalindPike: '11111111-0000-4000-8000-000000000017',
  ellisNakamura: '11111111-0000-4000-8000-000000000018', // paused; LA
  tobiasReyes: '11111111-0000-4000-8000-000000000019', // mis-tiered: C assigned, A implied
  margaretChen: '11111111-0000-4000-8000-000000000020', // inbound unanswered; LA

  // Watchlist
  curtisAlderman: '11111111-0000-4000-8000-000000000021', // two outbound attempts, stays uncontacted
  yolandaBassett: '11111111-0000-4000-8000-000000000022', // referred by Ellis
  henrikSorensen: '11111111-0000-4000-8000-000000000023',
  simoneAchebe: '11111111-0000-4000-8000-000000000024', // org-only identifier
  percivalLang: '11111111-0000-4000-8000-000000000025', // phone-only identifier
} as const;

export const ORG = {
  naturallyNewYork: '22222222-0000-4000-8000-000000000001',
  carltonFields: '22222222-0000-4000-8000-000000000005',
  seaKingCapital: '22222222-0000-4000-8000-000000000024',
} as const;

export const SOURCE = {
  expoEast2025: '33333333-0000-4000-8000-000000000001', // 400 days old, slow developer
  brokerFest2026: '33333333-0000-4000-8000-000000000002', // 100 days old, fast developer
  brokerFest2025: '33333333-0000-4000-8000-000000000003',
  winterDinner2026: '33333333-0000-4000-8000-000000000004',
  referral: '33333333-0000-4000-8000-000000000010',
  inbound: '33333333-0000-4000-8000-000000000011',
  priorWork: '33333333-0000-4000-8000-000000000012',
} as const;
