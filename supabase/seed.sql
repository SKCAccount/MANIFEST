-- seed.sql — development and test fixtures.
--
-- Applied by `supabase db reset` after every migration, and by the test
-- harness. Never applied to production: taxonomy values live in migration 0018
-- because the write triggers depend on them; the people below are invented.
--
-- Dates are all relative to now(), so the fixture set stays meaningful however
-- long from now it is loaded, and so horizon assertions are stable.
--
-- Designed to exercise, specifically:
--   * both contact statuses, including a watchlist entry with two logged
--     outbound attempts that must stay uncontacted (Curtis Alderman)
--   * all four development stages, at present and at past dates
--   * a three-link referral chain: Erica -> Amanda -> Devon
--   * two events of different ages whose ranking inverts between the day-90
--     horizon and the present, which is the entire reason horizons exist
--   * a mis-tiered relationship, a reciprocity debt, an unanswered inbound,
--     a job change, a paused record, a do-not-contact record and a tier D

-- ---------------------------------------------------------------------------
-- Organizations
-- ---------------------------------------------------------------------------

set search_path = manifest, public, extensions;

insert into organizations (id, name, organization_type, industry_category, city, state, country, domain) values
('22222222-0000-4000-8000-000000000001', 'Naturally New York',          'Association',                'Professional Association', 'New York',        'NY', 'US', 'naturallyny.org'),
('22222222-0000-4000-8000-000000000002', 'Gendell Partners',            'Professional Services Firm', 'CPG',                      'New York',        'NY', 'US', 'gendellpartners.com'),
('22222222-0000-4000-8000-000000000003', 'Kellerman Foods',             'Operating Company',          'Food and Beverage',        'Brooklyn',        'NY', 'US', 'kellermanfoods.com'),
('22222222-0000-4000-8000-000000000004', 'Harborline Capital',          'Investment Firm',            'Financial Services',       'Jersey City',     'NJ', 'US', 'harborlinecap.com'),
('22222222-0000-4000-8000-000000000005', 'Carlton Fields',              'Professional Services Firm', 'Legal',                    'Tampa',           'FL', 'US', 'carltonfields.com'),
('22222222-0000-4000-8000-000000000006', 'Raghunathan CPA Group',       'Professional Services Firm', 'Accounting',               'New York',        'NY', 'US', 'raghunathancpa.com'),
('22222222-0000-4000-8000-000000000007', 'Verdant Provisions',          'Operating Company',          'CPG',                      'Newark',          'NJ', 'US', 'verdantprovisions.com'),
('22222222-0000-4000-8000-000000000008', 'Whitfield & Co',              'Non-Bank Lender',            'Financial Services',       'Philadelphia',    'PA', 'US', 'whitfieldco.com'),
('22222222-0000-4000-8000-000000000009', 'Tran Logistics',              'Operating Company',          'Logistics',                'Elizabeth',       'NJ', 'US', 'tranlogistics.com'),
('22222222-0000-4000-8000-000000000010', 'Meridian Trade Bank',         'Bank',                       'Financial Services',       'New York',        'NY', 'US', 'meridiantrade.com'),
('22222222-0000-4000-8000-000000000011', 'Diaz Capital Advisors',       'Investment Firm',            'Financial Services',       'Miami',           'FL', 'US', 'diazcapital.com'),
('22222222-0000-4000-8000-000000000012', 'Ng Contract Manufacturing',   'Operating Company',          'Manufacturing',            'Edison',          'NJ', 'US', 'ngcontract.com'),
('22222222-0000-4000-8000-000000000013', 'Ferraro Insurance Group',     'Professional Services Firm', 'Financial Services',       'Staten Island',   'NY', 'US', 'ferraroins.com'),
('22222222-0000-4000-8000-000000000014', 'Solomon Family Office',       'Investment Firm',            'Financial Services',       'Greenwich',       'CT', 'US', 'solomonfo.com'),
('22222222-0000-4000-8000-000000000015', 'Atlas Freight',               'Operating Company',          'Logistics',                'Chicago',         'IL', 'US', 'atlasfreight.com'),
('22222222-0000-4000-8000-000000000016', 'Pike & Associates',           'Professional Services Firm', 'Legal',                    'Boston',          'MA', 'US', 'pikeassoc.com'),
('22222222-0000-4000-8000-000000000017', 'Cadence Supplements',         'Operating Company',          'CPG',                      'Los Angeles',     'CA', 'US', 'cadencesupp.com'),
('22222222-0000-4000-8000-000000000018', 'Reyes Government Solutions',  'Professional Services Firm', 'Government',               'Washington',      'DC', 'US', 'reyesgov.com'),
('22222222-0000-4000-8000-000000000019', 'The Grocer''s Ledger',        'Media',                      'Media',                    'Los Angeles',     'CA', 'US', 'grocersledger.com'),
('22222222-0000-4000-8000-000000000020', 'Alderman Provisions',         'Operating Company',          'CPG',                      'Colorado Springs','CO', 'US', 'aldermanprovisions.com'),
('22222222-0000-4000-8000-000000000021', 'Bassett Naturals',            'Operating Company',          'Beauty',                   'Los Angeles',     'CA', 'US', 'bassettnaturals.com'),
('22222222-0000-4000-8000-000000000022', 'Nordic Trade Finance',        'Non-Bank Lender',            'Financial Services',       'New York',        'NY', 'US', 'nordictradefin.com'),
('22222222-0000-4000-8000-000000000023', 'Lang Brothers Grocery',       'Operating Company',          'Food and Beverage',        'Chicago',         'IL', 'US', 'langbros.com'),
('22222222-0000-4000-8000-000000000024', 'Sea King Capital',            'Investment Firm',            'Financial Services',       'New York',        'NY', 'US', 'seakingcapital.com');

-- ---------------------------------------------------------------------------
-- Sources
-- ---------------------------------------------------------------------------
-- Two conferences of different ages carry the horizon story. Expo East 2025 is
-- 400 days old and slow-developing; Broker Fest 2026 is 100 days old and fast.
-- At the day-90 horizon Broker Fest looks better. At present Expo East does.

insert into sources (id, event_name, event_year, kind, occurred_on, ends_on, city, state,
                     cost_pass_cents, cost_travel_cents, cost_lodging_cents, cost_meals_cents, cost_other_cents, cost_note) values
('33333333-0000-4000-8000-000000000001', 'Expo East',        2025, 'Trade Show', (current_date - 400), (current_date - 397), 'Philadelphia', 'PA',
  295000, 118000, 210000, 42000, 15000, 'Booth share with Naturally NY.'),
('33333333-0000-4000-8000-000000000002', 'Broker Fest',      2026, 'Conference', (current_date - 100), (current_date - 98),  'Chicago',      'IL',
  189000, 96000, 108000, 21000, 6000,  'Early-bird pass.'),
('33333333-0000-4000-8000-000000000003', 'Broker Fest',      2025, 'Conference', (current_date - 465), (current_date - 463), 'Chicago',      'IL',
  175000, 92000, 105000, 18000, 0,     null),
('33333333-0000-4000-8000-000000000004', 'Naturally NY Winter Dinner', 2026, 'Dinner', (current_date - 60), (current_date - 60), 'New York', 'NY',
  48000, 0, 0, 30000, 0, 'Table of eight.');

-- Non-event sources carry no cost and no year, and the form does not render
-- cost fields for them.
insert into sources (id, event_name, kind) values
('33333333-0000-4000-8000-000000000010', 'Referral',   'Referral'),
('33333333-0000-4000-8000-000000000011', 'Inbound',    'Inbound'),
('33333333-0000-4000-8000-000000000012', 'Prior Work', 'Prior Work');

-- ---------------------------------------------------------------------------
-- People, batch 1 — no introduced_by, so referrers exist before referrals
-- ---------------------------------------------------------------------------

insert into people (
  id, first_name, last_name, position, organization_id,
  professional_function, specialties, relationship_to_me,
  city, state, country, contact_status, first_contact_at,
  met_at_source_id, met_on, tier, email_work, phone_mobile, linkedin_url, summary, tags
) values

-- 1. The spec's own example record.
('11111111-0000-4000-8000-000000000001', 'Adrienne', 'DeLisio', 'Executive Director', '22222222-0000-4000-8000-000000000001',
 '{Association Executive}', '{CPG}', '{Community,Deal Source}',
 'New York', 'NY', 'US', 'active', now() - interval '400 days',
 '33333333-0000-4000-8000-000000000001', (current_date - 400), 'A', 'adrienne@naturallyny.org', '(212) 555-0142',
 'https://www.linkedin.com/in/adriennedelisio/', 'Runs the association. Knows every CPG founder in the northeast.', '{}'),

-- 2. The connector. Two introductions to the operator, and the operator owes her.
('11111111-0000-4000-8000-000000000002', 'Erica', 'Gendell', 'Managing Partner', '22222222-0000-4000-8000-000000000002',
 '{Consultant}', '{CPG,DTC}', '{Referral Partner,Community}',
 'New York', 'NY', 'US', 'active', now() - interval '900 days',
 '33333333-0000-4000-8000-000000000012', null, 'B', 'erica@gendellpartners.com', '212-555-0198',
 'linkedin.com/in/ericagendell', 'Former colleague. The single most generous introducer in the network.', '{}'),

-- 5. Structured finance inside a general-practice firm — the case that makes
--    person-level specialty non-negotiable.
('11111111-0000-4000-8000-000000000005', 'Marcus', 'Vance', 'Partner', '22222222-0000-4000-8000-000000000005',
 '{Attorney}', '{Structured Finance,M&A}', '{Retained Service Provider}',
 'Tampa', 'FL', 'US', 'active', now() - interval '400 days',
 '33333333-0000-4000-8000-000000000001', (current_date - 400), 'B', 'mvance@carltonfields.com', '+18135550117',
 'https://linkedin.com/in/marcusvance', 'Does the securitization work. Bills like it.', '{}'),

('11111111-0000-4000-8000-000000000007', 'Nina', 'Okafor', 'VP Operations', '22222222-0000-4000-8000-000000000007',
 '{Operator}', '{CPG,Supplements}', '{Deal Source}',
 'Newark', 'NJ', 'US', 'active', now() - interval '400 days',
 '33333333-0000-4000-8000-000000000001', (current_date - 400), 'C', 'nina@verdantprovisions.com', '9735550164',
 'linkedin.com/in/ninaokafor', null, '{}'),

('11111111-0000-4000-8000-000000000008', 'Grant', 'Whitfield', 'Principal', '22222222-0000-4000-8000-000000000008',
 '{Broker}', '{Factoring and ABL}', '{Deal Source,Referral Partner}',
 'Philadelphia', 'PA', 'US', 'active', now() - interval '400 days',
 '33333333-0000-4000-8000-000000000001', (current_date - 400), 'B', 'grant@whitfieldco.com', '2155550188',
 'linkedin.com/in/grantwhitfield', 'Sourced the Bluepoch receivable.', '{}'),

-- Tier D: archived. Never queued, never scored for cadence.
('11111111-0000-4000-8000-000000000009', 'Hollis', 'Tran', 'Founder', '22222222-0000-4000-8000-000000000009',
 '{3PL}', '{Logistics}', '{Community}',
 'Elizabeth', 'NJ', 'US', 'active', now() - interval '400 days',
 '33333333-0000-4000-8000-000000000001', (current_date - 400), 'D', 'hollis@tranlogistics.com', null,
 'linkedin.com/in/hollistran', null, '{}'),

('11111111-0000-4000-8000-000000000010', 'Sasha', 'Nolan', 'SVP, Trade Finance', '22222222-0000-4000-8000-000000000010',
 '{Commercial Banker}', '{Factoring and ABL}', '{Referral Partner}',
 'New York', 'NY', 'US', 'active', now() - interval '100 days',
 '33333333-0000-4000-8000-000000000002', (current_date - 100), 'B', 'snolan@meridiantrade.com', '2125550133',
 'linkedin.com/in/sashanolan', null, '{}'),

-- Met once at a conference 100 days ago and never followed up. Still
-- recoverable, which is exactly what v_never_followed_up is for.
('11111111-0000-4000-8000-000000000011', 'Ruben', 'Diaz', 'Director', '22222222-0000-4000-8000-000000000011',
 '{Investment Banker}', '{M&A}', '{Prospect}',
 'Miami', 'FL', 'US', 'active', now() - interval '100 days',
 '33333333-0000-4000-8000-000000000002', (current_date - 100), 'C', 'rdiaz@diazcapital.com', '3055550176',
 'linkedin.com/in/rubendiaz', null, '{}'),

('11111111-0000-4000-8000-000000000012', 'Camille', 'Boucher', 'Head of Brand', '22222222-0000-4000-8000-000000000001',
 '{Marketer}', '{CPG,Beauty}', '{Community}',
 'New York', 'NY', 'US', 'active', now() - interval '60 days',
 '33333333-0000-4000-8000-000000000004', (current_date - 60), 'C', 'camille@naturallyny.org', '9175550121',
 'linkedin.com/in/camilleboucher', null, '{}'),

-- do_not_contact: present in the Directory, absent from the queue and exports.
('11111111-0000-4000-8000-000000000013', 'Walter', 'Ng', 'President', '22222222-0000-4000-8000-000000000012',
 '{Contract Manufacturer}', '{Manufacturing,Supplements}', '{Counterparty}',
 'Edison', 'NJ', 'US', 'active', now() - interval '60 days',
 '33333333-0000-4000-8000-000000000004', (current_date - 60), 'C', 'walter@ngcontract.com', '7325550109',
 'linkedin.com/in/walterng', 'Asked not to be contacted outside of live projects.', '{}'),

('11111111-0000-4000-8000-000000000014', 'Dana', 'Ferraro', 'Principal', '22222222-0000-4000-8000-000000000013',
 '{Insurance}', '{CPG}', '{Retained Service Provider}',
 'Staten Island', 'NY', 'US', 'active', now() - interval '700 days',
 '33333333-0000-4000-8000-000000000012', null, 'B', 'dana@ferraroins.com', '7185550154',
 'linkedin.com/in/danaferraro', null, '{}'),

('11111111-0000-4000-8000-000000000015', 'Beatrice', 'Solomon', 'Chief Investment Officer', '22222222-0000-4000-8000-000000000014',
 '{Investor}', '{Structured Finance,Real Estate}', '{Investor In My Business}',
 'Greenwich', 'CT', 'US', 'active', now() - interval '1100 days',
 '33333333-0000-4000-8000-000000000012', null, 'A', 'bsolomon@solomonfo.com', '2035550190',
 'linkedin.com/in/beatricesolomon', 'Anchor LP. Opened the Meridian door unprompted.', '{}'),

('11111111-0000-4000-8000-000000000016', 'Jamal', 'Whitaker', 'COO', '22222222-0000-4000-8000-000000000015',
 '{Executive}', '{Logistics}', '{Client}',
 'Chicago', 'IL', 'US', 'active', now() - interval '465 days',
 '33333333-0000-4000-8000-000000000003', (current_date - 465), 'A', 'jwhitaker@atlasfreight.com', '3125550147',
 'linkedin.com/in/jamalwhitaker', null, '{}'),

('11111111-0000-4000-8000-000000000017', 'Rosalind', 'Pike', 'Founding Partner', '22222222-0000-4000-8000-000000000016',
 '{Attorney}', '{Employment,Litigation}', '{Retained Service Provider}',
 'Boston', 'MA', 'US', 'active', now() - interval '465 days',
 '33333333-0000-4000-8000-000000000003', (current_date - 465), 'C', 'rpike@pikeassoc.com', '6175550172',
 'linkedin.com/in/rosalindpike', null, '{}'),

-- Paused: excluded from the queue until the pause lapses, but still in
-- Geography, which is the point of pausing rather than archiving.
('11111111-0000-4000-8000-000000000018', 'Ellis', 'Nakamura', 'CEO', '22222222-0000-4000-8000-000000000017',
 '{Operator}', '{Supplements,DTC}', '{Former Client}',
 'Los Angeles', 'CA', 'US', 'active', now() - interval '465 days',
 '33333333-0000-4000-8000-000000000003', (current_date - 465), 'C', 'ellis@cadencesupp.com', '3105550163',
 'linkedin.com/in/ellisnakamura', null, '{}'),

-- Tier C carrying a funded deal: the mis-tiered relationship the value score
-- is supposed to surface.
('11111111-0000-4000-8000-000000000019', 'Tobias', 'Reyes', 'Managing Director', '22222222-0000-4000-8000-000000000018',
 '{Consultant}', '{Government Contracting}', '{Deal Source}',
 'Washington', 'DC', 'US', 'active', now() - interval '600 days',
 '33333333-0000-4000-8000-000000000010', null, 'C', 'tobias@reyesgov.com', '2025550185',
 'linkedin.com/in/tobiasreyes', null, '{}'),

-- Writes first, and the last thing she sent went unanswered.
('11111111-0000-4000-8000-000000000020', 'Margaret', 'Chen', 'Senior Editor', '22222222-0000-4000-8000-000000000019',
 '{Press}', '{CPG,Food and Beverage}', '{Press Contact}',
 'Los Angeles', 'CA', 'US', 'active', now() - interval '500 days',
 '33333333-0000-4000-8000-000000000011', null, 'C', 'mchen@grocersledger.com', '3235550128',
 'linkedin.com/in/margaretchen', null, '{}');

-- ---------------------------------------------------------------------------
-- People, batch 2 — referral chain: Erica -> Amanda -> Devon
-- ---------------------------------------------------------------------------
-- Setting introduced_by_person_id is all the operator does. trg_introduced_by
-- writes the matching introductions row, which feeds the referrer's
-- intros_received_count, her reciprocity balance and network centrality.

insert into people (
  id, first_name, last_name, position, organization_id,
  professional_function, specialties, relationship_to_me,
  city, state, country, contact_status, first_contact_at,
  met_at_source_id, met_on, introduced_by_person_id, tier, email_work, phone_mobile, linkedin_url, tags
) values
('11111111-0000-4000-8000-000000000003', 'Amanda', 'Kellerman', 'Founder & CEO', '22222222-0000-4000-8000-000000000003',
 '{Operator}', '{CPG,Food and Beverage}', '{Prospect,Deal Source}',
 'Brooklyn', 'NY', 'US', 'active', now() - interval '300 days',
 '33333333-0000-4000-8000-000000000010', (current_date - 300), '11111111-0000-4000-8000-000000000002',
 'B', 'amanda@kellermanfoods.com', '7185550111', 'linkedin.com/in/amandakellerman', '{}'),

('11111111-0000-4000-8000-000000000006', 'Priya', 'Raghunathan', 'Managing Partner', '22222222-0000-4000-8000-000000000006',
 '{Accountant}', '{CPG,Tax}', '{Retained Service Provider}',
 'New York', 'NY', 'US', 'active', now() - interval '520 days',
 '33333333-0000-4000-8000-000000000010', (current_date - 520), '11111111-0000-4000-8000-000000000002',
 'B', 'priya@raghunathancpa.com', '2125550159', 'linkedin.com/in/priyaraghunathan', '{}');

insert into people (
  id, first_name, last_name, position, organization_id,
  professional_function, specialties, relationship_to_me,
  city, state, country, contact_status, first_contact_at,
  met_at_source_id, met_on, introduced_by_person_id, tier, email_work, phone_mobile, linkedin_url, tags
) values
('11111111-0000-4000-8000-000000000004', 'Devon', 'Ruiz', 'Director of Originations', '22222222-0000-4000-8000-000000000004',
 '{Investor}', '{Structured Finance}', '{Counterparty}',
 'Jersey City', 'NJ', 'US', 'active', now() - interval '180 days',
 '33333333-0000-4000-8000-000000000010', (current_date - 180), '11111111-0000-4000-8000-000000000003',
 'C', 'devon@harborlinecap.com', '2015550137', 'linkedin.com/in/devonruiz', '{}');

-- ---------------------------------------------------------------------------
-- People, batch 3 — the watchlist (uncontacted)
-- ---------------------------------------------------------------------------
-- Every one of these requires a written reason and at least one identifier.
-- None has a Met At, because the operator did not meet them anywhere.

insert into people (
  id, first_name, last_name, position, organization_id,
  professional_function, specialties,
  city, state, country, contact_status,
  watchlist_reason, watchlist_source, watchlist_priority, watchlist_added_on,
  introduced_by_person_id, tier, email_work, phone_mobile, linkedin_url, tags
) values

-- The Colorado Springs case, verbatim from the spec: two outbound attempts
-- logged below, and the record stays uncontacted.
('11111111-0000-4000-8000-000000000021', 'Curtis', 'Alderman', 'Founder', '22222222-0000-4000-8000-000000000020',
 '{Operator}', '{CPG}',
 'Colorado Springs', 'CO', 'US', 'uncontacted',
 'Built a $40M shelf-stable brand without outside capital. Wants to buy the co-packer he uses. Exactly the profile for a sale-leaseback.',
 'Podcast', 'high', (current_date - 210),
 null, 'C', null, null, 'linkedin.com/in/curtisalderman', '{}'),

-- Warm path exists: Ellis Nakamura referred her.
('11111111-0000-4000-8000-000000000022', 'Yolanda', 'Bassett', 'CEO', '22222222-0000-4000-8000-000000000021',
 '{Executive}', '{CPG,Beauty}',
 'Los Angeles', 'CA', 'US', 'uncontacted',
 'Ellis says she is raising a bridge and hates her current lender. Worth a call the next time I am in LA.',
 'Mentioned By', 'high', (current_date - 45),
 '11111111-0000-4000-8000-000000000018', 'C', null, null, 'linkedin.com/in/yolandabassett', '{}'),

('11111111-0000-4000-8000-000000000023', 'Henrik', 'Sorensen', 'Head of US Origination', '22222222-0000-4000-8000-000000000022',
 '{Lender}', '{Structured Finance}',
 'New York', 'NY', 'US', 'uncontacted',
 'Nordic is quietly writing US receivables paper. If that is true he is either a counterparty or a competitor and I should know which.',
 'Press', 'medium', (current_date - 120),
 null, 'C', null, null, 'https://www.linkedin.com/in/henriksorensen/', '{}'),

-- Organization is the only identifier. Deliberately allowed, and flagged as
-- thin by v_data_quality. Reachable via Marcus Vance, same firm.
('11111111-0000-4000-8000-000000000024', 'Simone', 'Achebe', 'Associate', '22222222-0000-4000-8000-000000000005',
 '{Attorney}', '{IP}',
 'Tampa', 'FL', 'US', 'uncontacted',
 'Wrote the brand-licensing piece Marcus forwarded. Same firm as Marcus, so an introduction costs nothing.',
 'Research', 'low', (current_date - 300),
 null, 'C', null, null, null, '{}'),

-- Phone is the only identifier, which the constraint accepts.
('11111111-0000-4000-8000-000000000025', 'Percival', 'Lang', 'Owner', '22222222-0000-4000-8000-000000000023',
 '{Operator}', '{Food and Beverage}',
 'Chicago', 'IL', 'US', 'uncontacted',
 'Third-generation regional grocer with no succession plan. Someone will buy that chain and it should be a client of mine when they do.',
 'Research', 'medium', (current_date - 15),
 null, 'C', null, '(312) 555-0193', null, '{}');

-- ---------------------------------------------------------------------------
-- Touchpoints
-- ---------------------------------------------------------------------------
-- Every active person's earliest qualifying touchpoint matches the
-- first_contact_at set above. Group meetings share a group_key.

-- Expo East 2025, day 0 (400 days ago). One row per person, shared group_key.
insert into touchpoints (person_id, occurred_at, channel, direction, substantive, subject, summary, source, source_id, group_key) values
('11111111-0000-4000-8000-000000000001', now() - interval '400 days', 'meeting', 'mutual', false, 'Expo East floor', 'Met at the Naturally NY booth.', 'bulk_event', '33333333-0000-4000-8000-000000000001', '99999999-0000-4000-8000-000000000001'),
('11111111-0000-4000-8000-000000000005', now() - interval '400 days', 'meeting', 'mutual', false, 'Expo East floor', 'Introduced by a mutual client on the show floor.', 'bulk_event', '33333333-0000-4000-8000-000000000001', '99999999-0000-4000-8000-000000000001'),
('11111111-0000-4000-8000-000000000007', now() - interval '400 days', 'meeting', 'mutual', false, 'Expo East floor', 'Brief conversation about co-packing capacity.', 'bulk_event', '33333333-0000-4000-8000-000000000001', '99999999-0000-4000-8000-000000000001'),
('11111111-0000-4000-8000-000000000008', now() - interval '400 days', 'meeting', 'mutual', false, 'Expo East floor', 'Card swap at the lender happy hour.', 'bulk_event', '33333333-0000-4000-8000-000000000001', '99999999-0000-4000-8000-000000000001'),
('11111111-0000-4000-8000-000000000009', now() - interval '400 days', 'meeting', 'mutual', false, 'Expo East floor', 'Card swap.', 'bulk_event', '33333333-0000-4000-8000-000000000001', '99999999-0000-4000-8000-000000000001');

-- Marcus develops fast: substantive at day 45, so he is Active at the day-90
-- horizon. He is the only Expo East contact who is.
insert into touchpoints (person_id, occurred_at, channel, direction, substantive, subject, summary, source_id) values
('11111111-0000-4000-8000-000000000005', now() - interval '355 days', 'call', 'mutual', true, 'Securitization structure', 'Walked through the true-sale opinion for the Bluepoch facility. He will draft.', '33333333-0000-4000-8000-000000000001'),
('11111111-0000-4000-8000-000000000005', now() - interval '120 days', 'call',  'mutual', true, 'Q3 docs', 'Reviewed the amended security agreement.', null),
('11111111-0000-4000-8000-000000000005', now() - interval '30 days',  'email', 'inbound', true, 'Fee letter', 'Sent the revised fee letter and asked about next year''s facility.', null);

-- Hollis: a second, non-substantive touch. Contact, and stays Contact.
insert into touchpoints (person_id, occurred_at, channel, direction, substantive, subject, summary) values
('11111111-0000-4000-8000-000000000009', now() - interval '380 days', 'email', 'outbound', false, 'Good to meet', 'Sent the follow-up note. No reply.');

-- Nina and Adrienne develop late — after the day-180 horizon. This is what
-- makes Expo East look poor at 180 and strong at present.
insert into touchpoints (person_id, occurred_at, channel, direction, substantive, subject, summary) values
('11111111-0000-4000-8000-000000000007', now() - interval '100 days', 'call', 'mutual', true, 'Verdant receivables', 'She walked me through their AR ageing. Real facility opportunity in Q2.'),
('11111111-0000-4000-8000-000000000001', now() - interval '200 days', 'email', 'outbound', false, 'Winter dinner', 'Asked about the winter dinner roster.'),
('11111111-0000-4000-8000-000000000001', now() - interval '150 days', 'call', 'mutual', true, 'Association calendar', 'Discussed sponsoring the winter dinner and who else should be at the table.'),
('11111111-0000-4000-8000-000000000001', now() - interval '20 days', 'meeting', 'mutual', true, 'Coffee', 'She offered to introduce me to two member CFOs.');

-- Grant sources the Bluepoch deal at day 320, which makes him Producing today
-- and Card at the day-180 horizon.
insert into touchpoints (person_id, occurred_at, channel, direction, substantive, subject, summary) values
('11111111-0000-4000-8000-000000000008', now() - interval '85 days', 'call', 'inbound', true, 'Bluepoch', 'He called with the Bluepoch receivable. Sending the file.'),
('11111111-0000-4000-8000-000000000008', now() - interval '40 days', 'email', 'mutual', true, 'Bluepoch funded', 'Confirmed funding and commission split.');

-- Broker Fest 2026, day 0 (100 days ago).
insert into touchpoints (person_id, occurred_at, channel, direction, substantive, subject, summary, source, source_id, group_key) values
('11111111-0000-4000-8000-000000000010', now() - interval '100 days', 'meeting', 'mutual', false, 'Broker Fest', 'Met at the trade finance panel.', 'bulk_event', '33333333-0000-4000-8000-000000000002', '99999999-0000-4000-8000-000000000002'),
('11111111-0000-4000-8000-000000000011', now() - interval '100 days', 'meeting', 'mutual', false, 'Broker Fest', 'Card swap at the closing reception.', 'bulk_event', '33333333-0000-4000-8000-000000000002', '99999999-0000-4000-8000-000000000002');

-- Sasha is substantive at day 30, so Broker Fest 2026 has one Active contact at
-- the day-90 horizon — for a third less money than Expo East's one.
insert into touchpoints (person_id, occurred_at, channel, direction, substantive, subject, summary, source_id) values
('11111111-0000-4000-8000-000000000010', now() - interval '70 days', 'call', 'mutual', true, 'Meridian appetite', 'Meridian will look at CPG receivables above $2M. Sent two names.', '33333333-0000-4000-8000-000000000002');

-- Broker Fest 2025, day 0 (465 days ago).
insert into touchpoints (person_id, occurred_at, channel, direction, substantive, subject, summary, source, source_id, group_key) values
('11111111-0000-4000-8000-000000000016', now() - interval '465 days', 'meeting', 'mutual', false, 'Broker Fest', 'Met at the shipper roundtable.', 'bulk_event', '33333333-0000-4000-8000-000000000003', '99999999-0000-4000-8000-000000000003'),
('11111111-0000-4000-8000-000000000017', now() - interval '465 days', 'meeting', 'mutual', false, 'Broker Fest', 'Card swap.', 'bulk_event', '33333333-0000-4000-8000-000000000003', '99999999-0000-4000-8000-000000000003'),
('11111111-0000-4000-8000-000000000018', now() - interval '465 days', 'meeting', 'mutual', false, 'Broker Fest', 'Reconnected after the Cadence engagement.', 'bulk_event', '33333333-0000-4000-8000-000000000003', '99999999-0000-4000-8000-000000000003');

insert into touchpoints (person_id, occurred_at, channel, direction, substantive, subject, summary) values
-- Jamal: tier A, last substantive 90 days ago, so overdue by roughly 45.
('11111111-0000-4000-8000-000000000016', now() - interval '300 days', 'meeting', 'mutual', true, 'Atlas onboarding', 'Kicked off the Atlas facility.'),
('11111111-0000-4000-8000-000000000016', now() - interval '90 days',  'call',    'mutual', true, 'Q1 volumes', 'Volumes up 14%. Wants to expand the line.'),
-- Rosalind: tier C, nothing substantive in over a year. Deeply overdue.
('11111111-0000-4000-8000-000000000017', now() - interval '400 days', 'email',   'mutual', true, 'Employment memo', 'Delivered the contractor classification memo.'),
-- Ellis: overdue, but paused, so the queue skips him. Geography still shows him.
('11111111-0000-4000-8000-000000000018', now() - interval '380 days', 'call',    'mutual', true, 'Cadence wind-down', 'Closed out the engagement on good terms.');

-- Naturally NY Winter Dinner 2026, day 0 (60 days ago).
insert into touchpoints (person_id, occurred_at, channel, direction, substantive, subject, summary, source, source_id, group_key) values
('11111111-0000-4000-8000-000000000012', now() - interval '60 days', 'meeting', 'mutual', false, 'Winter dinner', 'Seated together.', 'bulk_event', '33333333-0000-4000-8000-000000000004', '99999999-0000-4000-8000-000000000004'),
('11111111-0000-4000-8000-000000000013', now() - interval '60 days', 'meeting', 'mutual', false, 'Winter dinner', 'Brief conversation about supplement co-packing.', 'bulk_event', '33333333-0000-4000-8000-000000000004', '99999999-0000-4000-8000-000000000004');

insert into touchpoints (person_id, occurred_at, channel, direction, substantive, subject, summary) values
('11111111-0000-4000-8000-000000000013', now() - interval '50 days', 'email', 'outbound', false, 'Follow-up', 'Sent the capability deck.');

-- The referral chain, and the long-standing relationships.
insert into touchpoints (person_id, occurred_at, channel, direction, substantive, subject, summary) values
('11111111-0000-4000-8000-000000000002', now() - interval '900 days', 'meeting', 'mutual',  true,  'Reconnect',        'Coffee after the Sea King launch.'),
('11111111-0000-4000-8000-000000000002', now() - interval '310 days', 'email',   'inbound', true,  'Intro: Amanda',    'She introduced me to Amanda Kellerman unprompted.'),
('11111111-0000-4000-8000-000000000002', now() - interval '95 days',  'call',    'mutual',  true,  'Catch-up',         'Talked through her Q2 client roster. Two possible referrals.'),
('11111111-0000-4000-8000-000000000003', now() - interval '300 days', 'call',    'mutual',  true,  'Kellerman AR',     'First conversation. Their AR is seasonal and lumpy.'),
('11111111-0000-4000-8000-000000000003', now() - interval '110 days', 'meeting', 'mutual',  true,  'Brooklyn visit',   'Toured the facility. She introduced me to Devon Ruiz at Harborline.'),
('11111111-0000-4000-8000-000000000004', now() - interval '180 days', 'call',    'mutual',  true,  'Harborline intro', 'Amanda made the introduction. Harborline buys paper in our size range.'),
('11111111-0000-4000-8000-000000000004', now() - interval '35 days',  'email',   'mutual',  false, 'Checking in',      'Sent the quarterly note.'),
('11111111-0000-4000-8000-000000000006', now() - interval '520 days', 'meeting', 'mutual',  true,  'Onboarding',       'Erica introduced us. Took over the Sea King books.'),
('11111111-0000-4000-8000-000000000006', now() - interval '75 days',  'call',    'mutual',  true,  'Year-end',         'Closed out the year-end filings.'),
('11111111-0000-4000-8000-000000000014', now() - interval '700 days', 'meeting', 'mutual',  true,  'Policy review',    'Bound the E&O policy.'),
('11111111-0000-4000-8000-000000000014', now() - interval '200 days', 'call',    'mutual',  true,  'Renewal',          'Renewed at a 4% increase.'),
('11111111-0000-4000-8000-000000000015', now() - interval '1100 days','meeting', 'mutual',  true,  'First meeting',    'Pitched the fund thesis.'),
('11111111-0000-4000-8000-000000000015', now() - interval '20 days',  'call',    'mutual',  true,  'LP update',        'Walked her through the Bluepoch outcome. She offered a Meridian introduction.'),
('11111111-0000-4000-8000-000000000019', now() - interval '600 days', 'meeting', 'mutual',  true,  'GovCon overview',  'Explained how his agencies pay and where the float sits.'),
('11111111-0000-4000-8000-000000000019', now() - interval '250 days', 'call',    'mutual',  true,  'Referral',         'He sent the Tidewater file.'),
('11111111-0000-4000-8000-000000000020', now() - interval '500 days', 'email',   'inbound', true,  'Sourcing quotes',  'She asked for comment on a factoring story.'),
('11111111-0000-4000-8000-000000000020', now() - interval '200 days', 'email',   'mutual',  true,  'Follow-up piece',  'Gave background for the private-credit piece.'),
-- Last word was hers, and it has not been answered.
('11111111-0000-4000-8000-000000000020', now() - interval '30 days',  'email',   'inbound', false, 'New series',       'Asked whether I would go on record for a new series.');

-- Two outbound attempts against a watchlist entry. Neither promotes him:
-- outbound-only contact changes nothing except that the attempt is on record.
insert into touchpoints (person_id, occurred_at, channel, direction, substantive, subject, summary) values
('11111111-0000-4000-8000-000000000021', now() - interval '180 days', 'linkedin', 'outbound', false, 'Connection request', 'Sent a connection request with a note about the podcast.'),
('11111111-0000-4000-8000-000000000021', now() - interval '60 days',  'linkedin', 'outbound', false, 'Second attempt',     'Followed up after the co-packer news. No response.');

-- ---------------------------------------------------------------------------
-- Deals
-- ---------------------------------------------------------------------------

insert into deals (id, name, counterparty_organization_id, source_person_id, source_organization_id,
                   stage, amount_cents, referred_on, closed_on, commission_terms, commission_earned_cents, commission_paid_cents) values
('44444444-0000-4000-8000-000000000001', 'Bluepoch receivable facility', '22222222-0000-4000-8000-000000000007',
 '11111111-0000-4000-8000-000000000008', '22222222-0000-4000-8000-000000000008',
 'funded', 85000000, (current_date - 80), (current_date - 40), '3% of funded amount', 2550000, 2550000),

('44444444-0000-4000-8000-000000000002', 'Tidewater govcon factoring', null,
 '11111111-0000-4000-8000-000000000019', '22222222-0000-4000-8000-000000000018',
 'funded', 42000000, (current_date - 240), (current_date - 190), '2.5% of funded amount', 1050000, 1050000),

('44444444-0000-4000-8000-000000000003', 'Kellerman seasonal line', '22222222-0000-4000-8000-000000000003',
 '11111111-0000-4000-8000-000000000003', '22222222-0000-4000-8000-000000000003',
 'diligence', 12000000, (current_date - 60), null, '3% of funded amount', null, null),

-- Tobias's second funded deal. Two funded referrals, an introduction and a
-- favor, and he is still sitting at tier C — the mis-tiered relationship
-- v_tier_mismatch exists to surface.
('44444444-0000-4000-8000-000000000004', 'Seaboard Logistics AR line', null,
 '11111111-0000-4000-8000-000000000019', '22222222-0000-4000-8000-000000000018',
 'funded', 60000000, (current_date - 400), (current_date - 350), '2.5% of funded amount', 1500000, 1500000);

-- ---------------------------------------------------------------------------
-- Introductions entered by hand
-- ---------------------------------------------------------------------------
-- The auto rows for Amanda, Priya, Devon and Yolanda already exist, written by
-- trg_introduced_by. These are the ones with no corresponding profile field.

insert into introductions (perspective, introducer_person_id, party_a_person_id, occurred_on, note) values
('received_by_me', '11111111-0000-4000-8000-000000000001', '11111111-0000-4000-8000-000000000013', (current_date - 50),
 'Adrienne walked me over to Walter at the winter dinner.'),
('received_by_me', '11111111-0000-4000-8000-000000000015', '11111111-0000-4000-8000-000000000010', (current_date - 18),
 'Beatrice opened the door at Meridian without being asked.'),
('received_by_me', '11111111-0000-4000-8000-000000000019', '11111111-0000-4000-8000-000000000016', (current_date - 320),
 'Tobias put me in front of Jamal at Atlas.');

insert into introductions (perspective, introducer_person_id, party_a_person_id, party_b_person_id, occurred_on, note) values
('made_by_me', null, '11111111-0000-4000-8000-000000000005', '11111111-0000-4000-8000-000000000003', (current_date - 90),
 'Put Amanda together with Marcus for the licensing question.');

-- ---------------------------------------------------------------------------
-- Favors — direction is from the operator's point of view
-- ---------------------------------------------------------------------------

insert into favors (person_id, direction, kind, occurred_on, description) values
-- Erica has done three things for the operator and received nothing back:
-- net -3, which flags as owed and drives her queue opener.
('11111111-0000-4000-8000-000000000002', 'received', 'intro',       (current_date - 310), 'Introduced Amanda Kellerman.'),
('11111111-0000-4000-8000-000000000002', 'received', 'intro',       (current_date - 520), 'Introduced Priya Raghunathan.'),
('11111111-0000-4000-8000-000000000002', 'received', 'advice',      (current_date - 95),  'Reviewed the Sea King pitch deck line by line.'),
('11111111-0000-4000-8000-000000000015', 'received', 'intro',       (current_date - 18),  'Opened the door at Meridian.'),
('11111111-0000-4000-8000-000000000001', 'received', 'hospitality', (current_date - 20),  'Comped the winter dinner table.'),
('11111111-0000-4000-8000-000000000019', 'received', 'referral',    (current_date - 240), 'Handed over the Tidewater file without asking for anything.'),
('11111111-0000-4000-8000-000000000005', 'gave',     'referral',    (current_date - 140), 'Referred two securitization mandates.'),
('11111111-0000-4000-8000-000000000006', 'gave',     'referral',    (current_date - 220), 'Referred three CPG clients.'),
('11111111-0000-4000-8000-000000000016', 'gave',     'business',    (current_date - 300), 'Signed the Atlas facility.');

-- ---------------------------------------------------------------------------
-- Notes, followups, content
-- ---------------------------------------------------------------------------

insert into notes (person_id, category, body, is_pinned) values
('11111111-0000-4000-8000-000000000002', 'preference', 'Hates cold outreach. Every introduction she makes is deliberate — never ask for a list.', true),
('11111111-0000-4000-8000-000000000005', 'preference', 'Only free Tuesdays. Bills in six-minute increments, so call with an agenda.', true),
('11111111-0000-4000-8000-000000000013', 'warning',    'Asked not to be contacted outside of live projects. Respect it.', true),
('11111111-0000-4000-8000-000000000015', 'personal',   'Sails out of Stamford. Races in June, unreachable that month.', false),
('11111111-0000-4000-8000-000000000020', 'compliance', 'Journalist. Everything is on the record unless agreed otherwise in writing.', true),
-- Notes are permitted on uncontacted records: research is exactly what a
-- watchlist entry accumulates.
('11111111-0000-4000-8000-000000000021', 'professional', 'Interviewed on the Shelf Life podcast, episode 118. Said outright he would never take dilutive capital.', false),
('11111111-0000-4000-8000-000000000024', 'professional', 'Her brand-licensing article is the clearest thing I have read on the topic.', false);

insert into followups (person_id, title, detail, due_on, status, completed_at) values
('11111111-0000-4000-8000-000000000020', 'Answer Margaret on the new series', 'She asked 30 days ago and has not been answered.', (current_date - 12), 'open', null),
('11111111-0000-4000-8000-000000000019', 'Send Tobias the Q2 govcon note', null, (current_date - 3), 'open', null),
-- Followups are permitted on uncontacted records. This is how a trip list gets
-- worked.
('11111111-0000-4000-8000-000000000022', 'Ask Ellis for the Yolanda introduction', 'Before the LA trip.', (current_date + 10), 'open', null),
('11111111-0000-4000-8000-000000000003', 'Circulate Kellerman term sheet', null, (current_date - 40), 'done', now() - interval '38 days');

insert into content_touches (person_id, content_title, content_ref, sent_on) values
('11111111-0000-4000-8000-000000000015', 'Derek On Capital — Where Receivables Break', 'doc-2026-01', (current_date - 45)),
('11111111-0000-4000-8000-000000000016', 'Derek On Capital — Where Receivables Break', 'doc-2026-01', (current_date - 45)),
('11111111-0000-4000-8000-000000000002', 'Derek On Capital — Where Receivables Break', 'doc-2026-01', (current_date - 45)),
('11111111-0000-4000-8000-000000000015', 'Derek On Capital — The Cost Of A Conference', 'doc-2026-02', (current_date - 10)),
('11111111-0000-4000-8000-000000000002', 'Derek On Capital — The Cost Of A Conference', 'doc-2026-02', (current_date - 10));

-- ---------------------------------------------------------------------------
-- A job change, applied last so the triggers fire against a complete graph
-- ---------------------------------------------------------------------------
-- Writes affiliation_history, logs a system touchpoint, and puts Dana on the
-- "changed jobs" list — which is the best available pretext for a warm touch,
-- and worth +1.0 in the queue score.

update people
   set organization_id = '22222222-0000-4000-8000-000000000024',
       position        = 'Head of Risk'
 where id = '11111111-0000-4000-8000-000000000014';

-- Ellis is overdue but deliberately parked until after the LA trip. Pausing
-- rather than archiving keeps him out of the queue while leaving him in
-- Geography, which is the whole reason a pause exists.
update people
   set cadence_paused_until = now() + interval '45 days'
 where id = '11111111-0000-4000-8000-000000000018';
