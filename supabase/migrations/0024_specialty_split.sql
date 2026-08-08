-- 0024_specialty_split.sql
-- Specialties split into industry coverage and product coverage (2026-08-07,
-- from Derek's first real entry session).
--
-- The split lives in the taxonomy, not the schema: people.specialties stays
-- one array, so every view, search and screen is unchanged. Each specialty
-- value is tagged meta.kind = 'industry' | 'product', and product values also
-- carry meta.functions — the professional functions they are relevant to,
-- which is what lets the form lead with insurance products for an insurance
-- contact instead of showing DTC. An untagged value (added later without
-- meta) renders as a product relevant to everyone, so it can never become
-- silently unpickable.
--
-- This is a data migration on purpose, despite "adding a value is an insert,
-- never a migration" (0018): the form's two-field rendering *depends* on
-- these tags, so CI, the local stack and the hosted project must all carry
-- them — the same argument that made 0018 a migration. Operator additions
-- afterward remain plain inserts.
--
-- The function-relevance map below is a first draft for Derek to correct;
-- each correction is one UPDATE of meta, never a schema change.

set search_path = manifest, public, extensions;

-- ---------------------------------------------------------------------------
-- Tag the existing values
-- ---------------------------------------------------------------------------

-- Industry coverage areas. No meta.functions: an industry is relevant to
-- every professional function.
update taxonomies
   set meta = '{"kind":"industry"}'::jsonb
 where domain = 'specialty'
   and value in ('CPG', 'Food and Beverage', 'Healthcare Supply', 'Government Contracting',
                 'Apparel', 'Beauty', 'Supplements', 'DTC', 'Manufacturing', 'Logistics');

-- Product / practice coverage areas.
update taxonomies set meta = '{"kind":"product","functions":["Lender","Commercial Banker","Investment Banker","Broker","Attorney","Investor"]}'::jsonb
 where domain = 'specialty' and value = 'Structured Finance';
update taxonomies set meta = '{"kind":"product","functions":["Investment Banker","Attorney","Consultant","Investor"]}'::jsonb
 where domain = 'specialty' and value = 'M&A';
update taxonomies set meta = '{"kind":"product","functions":["Accountant","Attorney","Fractional CFO","Consultant"]}'::jsonb
 where domain = 'specialty' and value = 'Tax';
update taxonomies set meta = '{"kind":"product","functions":["Accountant"]}'::jsonb
 where domain = 'specialty' and value = 'Audit';
update taxonomies set meta = '{"kind":"product","functions":["Attorney"]}'::jsonb
 where domain = 'specialty' and value in ('Litigation', 'IP');
update taxonomies set meta = '{"kind":"product","functions":["Attorney","Consultant"]}'::jsonb
 where domain = 'specialty' and value = 'Employment';
update taxonomies set meta = '{"kind":"product","functions":["Attorney","Lender","Commercial Banker","Broker","Investor"]}'::jsonb
 where domain = 'specialty' and value = 'Real Estate';

-- ---------------------------------------------------------------------------
-- Split the conflated value
-- ---------------------------------------------------------------------------
-- 'Factoring and ABL' bundled two products Derek names separately. Zero
-- people rows referenced it when this migration was written (verified on the
-- hosted project 2026-08-07), so a delete-and-replace is safe; the fixtures
-- were updated in the same commit.

delete from taxonomies where domain = 'specialty' and value = 'Factoring and ABL';

-- ---------------------------------------------------------------------------
-- The product vocabulary Derek actually uses (his examples, plus close
-- adjacencies), and the insurance product areas
-- ---------------------------------------------------------------------------

insert into taxonomies (domain, value, label, sort_order, meta) values
('specialty', 'Invoice Factoring',           'Invoice Factoring',           200, '{"kind":"product","functions":["Lender","Broker","Commercial Banker","Attorney"]}'),
('specialty', 'ABL',                         'ABL',                         201, '{"kind":"product","functions":["Lender","Broker","Commercial Banker","Attorney"]}'),
('specialty', 'Purchase Order Financing',    'Purchase Order Financing',    202, '{"kind":"product","functions":["Lender","Broker"]}'),
('specialty', 'Working Capital Financing',   'Working Capital Financing',   203, '{"kind":"product","functions":["Lender","Broker","Commercial Banker"]}'),
('specialty', 'Bridge Financing',            'Bridge Financing',            204, '{"kind":"product","functions":["Lender","Broker","Commercial Banker","Investor"]}'),
('specialty', 'Inventory Financing',         'Inventory Financing',         205, '{"kind":"product","functions":["Lender","Broker"]}'),
('specialty', 'MCA',                         'MCA',                         206, '{"kind":"product","functions":["Lender","Broker"]}'),
('specialty', 'VC Equity Raising',           'VC Equity Raising',           207, '{"kind":"product","functions":["Investment Banker","Investor","Consultant"]}'),
('specialty', 'Receivables Insurance',       'Receivables Insurance',       220, '{"kind":"product","functions":["Insurance"]}'),
('specialty', 'GL Insurance',                'GL Insurance',                221, '{"kind":"product","functions":["Insurance"]}'),
('specialty', 'E&O Insurance',               'E&O Insurance',               222, '{"kind":"product","functions":["Insurance"]}'),
('specialty', 'Recall Insurance',            'Recall Insurance',            223, '{"kind":"product","functions":["Insurance"]}'),
('specialty', 'Product Liability Insurance', 'Product Liability Insurance', 224, '{"kind":"product","functions":["Insurance"]}'),
('specialty', 'D&O Insurance',               'D&O Insurance',               225, '{"kind":"product","functions":["Insurance"]}'),
('specialty', 'Cargo Insurance',             'Cargo Insurance',             226, '{"kind":"product","functions":["Insurance"]}')
on conflict do nothing;
