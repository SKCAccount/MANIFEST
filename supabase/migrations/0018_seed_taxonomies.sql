-- 0018_seed_taxonomies.sql
-- Starting values for every extensible list. These are production data, not
-- fixtures: the write triggers reject any value not present here, so an empty
-- taxonomy table would make the person form unusable.
--
-- Values are stored in readable form ("Association Executive", not
-- "association_executive") because a full CSV export has to be legible on its
-- own. Validation is case-insensitive, so casing drift on entry is harmless.
--
-- The operator extends these from Settings. Adding a value is an insert, never
-- a migration.

set search_path = manifest, public, extensions;

insert into taxonomies (domain, value, label, sort_order, meta) values

-- What they do for a living. Stable; changes only on a career move.
('professional_function', 'Accountant',              'Accountant',              10, '{}'),
('professional_function', 'Attorney',                'Attorney',                20, '{}'),
('professional_function', 'Commercial Banker',       'Commercial Banker',       30, '{}'),
('professional_function', 'Investment Banker',       'Investment Banker',       40, '{}'),
('professional_function', 'Broker',                  'Broker',                  50, '{}'),
('professional_function', 'Lender',                  'Lender',                  60, '{}'),
('professional_function', 'Insurance',               'Insurance',               70, '{}'),
('professional_function', 'Fractional CFO',          'Fractional CFO',          80, '{}'),
('professional_function', 'Consultant',              'Consultant',              90, '{}'),
('professional_function', 'Investor',                'Investor',               100, '{}'),
('professional_function', 'Operator',                'Operator',               110, '{}'),
('professional_function', 'Executive',               'Executive',              120, '{}'),
('professional_function', 'Association Executive',   'Association Executive',  130, '{}'),
('professional_function', '3PL',                     '3PL',                    140, '{}'),
('professional_function', 'Contract Manufacturer',   'Contract Manufacturer',  150, '{}'),
('professional_function', 'Sales Rep',               'Sales Rep',              160, '{}'),
('professional_function', 'Marketer',                'Marketer',               170, '{}'),
('professional_function', 'Recruiter',               'Recruiter',              180, '{}'),
('professional_function', 'Government',              'Government',             190, '{}'),
('professional_function', 'Press',                   'Press',                  200, '{}'),
('professional_function', 'Other',                   'Other',                  999, '{}'),

-- What they actually know. Person-level, deliberately: organization industry
-- says where someone works, specialty says what they do inside it.
('specialty', 'CPG',                      'CPG',                       10, '{}'),
('specialty', 'Food and Beverage',        'Food and Beverage',         20, '{}'),
('specialty', 'Healthcare Supply',        'Healthcare Supply',         30, '{}'),
('specialty', 'Government Contracting',   'Government Contracting',    40, '{}'),
('specialty', 'Apparel',                  'Apparel',                   50, '{}'),
('specialty', 'Beauty',                   'Beauty',                    60, '{}'),
('specialty', 'Supplements',              'Supplements',               70, '{}'),
('specialty', 'DTC',                      'DTC',                       80, '{}'),
('specialty', 'Manufacturing',            'Manufacturing',             90, '{}'),
('specialty', 'Logistics',                'Logistics',                100, '{}'),
('specialty', 'Structured Finance',       'Structured Finance',       110, '{}'),
('specialty', 'Factoring and ABL',        'Factoring and ABL',        120, '{}'),
('specialty', 'M&A',                      'M&A',                      130, '{}'),
('specialty', 'Tax',                      'Tax',                      140, '{}'),
('specialty', 'Audit',                    'Audit',                    150, '{}'),
('specialty', 'Litigation',               'Litigation',               160, '{}'),
('specialty', 'IP',                       'IP',                       170, '{}'),
('specialty', 'Employment',               'Employment',               180, '{}'),
('specialty', 'Real Estate',              'Real Estate',              190, '{}'),

-- What they are to the operator. Multi-select, and changes over time.
-- "Retained Service Provider" means the operator writes this person checks. It
-- is not a synonym for "is an accountant".
('relationship_to_me', 'Deal Source',               'Deal Source',                10, '{}'),
('relationship_to_me', 'Client',                    'Client',                     20, '{}'),
('relationship_to_me', 'Former Client',             'Former Client',              30, '{}'),
('relationship_to_me', 'Prospect',                  'Prospect',                   40, '{}'),
('relationship_to_me', 'Retained Service Provider', 'Retained Service Provider',  50, '{}'),
('relationship_to_me', 'Investor In My Business',   'Investor In My Business',    60, '{}'),
('relationship_to_me', 'Counterparty',              'Counterparty',               70, '{}'),
('relationship_to_me', 'Referral Partner',          'Referral Partner',           80, '{}'),
('relationship_to_me', 'Community',                 'Community',                  90, '{}'),
('relationship_to_me', 'Personal',                  'Personal',                  100, '{}'),
('relationship_to_me', 'Mentor or Advisor',         'Mentor or Advisor',         110, '{}'),
('relationship_to_me', 'Press Contact',             'Press Contact',             120, '{}'),

('organization_type', 'Operating Company',          'Operating Company',          10, '{}'),
('organization_type', 'Professional Services Firm', 'Professional Services Firm', 20, '{}'),
('organization_type', 'Bank',                       'Bank',                       30, '{}'),
('organization_type', 'Non-Bank Lender',            'Non-Bank Lender',            40, '{}'),
('organization_type', 'Investment Firm',            'Investment Firm',            50, '{}'),
('organization_type', 'Association',                'Association',                60, '{}'),
('organization_type', 'Government Agency',          'Government Agency',          70, '{}'),
('organization_type', 'Media',                      'Media',                      80, '{}'),
('organization_type', 'Nonprofit',                  'Nonprofit',                  90, '{}'),
('organization_type', 'Other',                      'Other',                     999, '{}'),

('industry_category', 'CPG',                        'CPG',                        10, '{}'),
('industry_category', 'Food and Beverage',          'Food and Beverage',          20, '{}'),
('industry_category', 'Healthcare',                 'Healthcare',                 30, '{}'),
('industry_category', 'Government',                 'Government',                 40, '{}'),
('industry_category', 'Apparel',                    'Apparel',                    50, '{}'),
('industry_category', 'Beauty',                     'Beauty',                     60, '{}'),
('industry_category', 'Financial Services',         'Financial Services',         70, '{}'),
('industry_category', 'Legal',                      'Legal',                      80, '{}'),
('industry_category', 'Accounting',                 'Accounting',                 90, '{}'),
('industry_category', 'Logistics',                  'Logistics',                 100, '{}'),
('industry_category', 'Manufacturing',              'Manufacturing',             110, '{}'),
('industry_category', 'Media',                      'Media',                     120, '{}'),
('industry_category', 'Professional Association',   'Professional Association',  130, '{}'),
('industry_category', 'Other',                      'Other',                     999, '{}'),

-- meta.family = 'event' is what makes the cost breakdown, the event year and
-- the event date mandatory on save. Adding "Summit" as an event kind here is
-- all it takes for the cost requirement to apply to it.
('source_kind', 'Trade Show',   'Trade Show',   10, '{"family":"event"}'),
('source_kind', 'Conference',   'Conference',   20, '{"family":"event"}'),
('source_kind', 'Expo',         'Expo',         30, '{"family":"event"}'),
('source_kind', 'Dinner',       'Dinner',       40, '{"family":"event"}'),
('source_kind', 'Webinar',      'Webinar',      50, '{"family":"event"}'),
('source_kind', 'Meetup',       'Meetup',       60, '{"family":"event"}'),
('source_kind', 'Pitch Event',  'Pitch Event',  70, '{"family":"event"}'),
('source_kind', 'Referral',     'Referral',    100, '{"family":"origin"}'),
('source_kind', 'Inbound',      'Inbound',     110, '{"family":"origin"}'),
('source_kind', 'LinkedIn',     'LinkedIn',    120, '{"family":"origin"}'),
('source_kind', 'Prior Work',   'Prior Work',  130, '{"family":"origin"}'),
('source_kind', 'Personal',     'Personal',    140, '{"family":"origin"}'),

('watchlist_source', 'Press',              'Press',              10, '{}'),
('watchlist_source', 'Podcast',            'Podcast',            20, '{}'),
('watchlist_source', 'LinkedIn',           'LinkedIn',           30, '{}'),
('watchlist_source', 'Mentioned By',       'Mentioned By',       40, '{}'),
('watchlist_source', 'Conference Roster',  'Conference Roster',  50, '{}'),
('watchlist_source', 'Portfolio Company',  'Portfolio Company',  60, '{}'),
('watchlist_source', 'Research',           'Research',           70, '{}'),
('watchlist_source', 'Other',              'Other',             999, '{}')

on conflict do nothing;
