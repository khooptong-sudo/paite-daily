-- Visitors explorer (plan 011). Everything new is coarse or bucketed; nothing typed by a visitor.
-- osv, bv: system and browser to the major version. brand, model: phone make and model code (a model is
--   shown only when two or more visitors share it). isp: the network's short name (same rule).
-- lang, tz: browser language and time zone (tz: same two-visitor rule). vw: screen width bucket.
-- dpr, net, theme, scheme, pwa: pixel density, connection type, site theme, system theme, installed app.
-- ttfb, load, lcp, inp, cls, scroll: speed and scroll depth, on 'leave' events only (cls is x1000).
-- target: the host of an outbound link ('out'), or a cut error message ('jserror').
ALTER TABLE events ADD COLUMN osv TEXT;
ALTER TABLE events ADD COLUMN bv TEXT;
ALTER TABLE events ADD COLUMN brand TEXT;
ALTER TABLE events ADD COLUMN model TEXT;
ALTER TABLE events ADD COLUMN isp TEXT;
ALTER TABLE events ADD COLUMN lang TEXT;
ALTER TABLE events ADD COLUMN tz TEXT;
ALTER TABLE events ADD COLUMN vw TEXT;
ALTER TABLE events ADD COLUMN dpr TEXT;
ALTER TABLE events ADD COLUMN net TEXT;
ALTER TABLE events ADD COLUMN theme TEXT;
ALTER TABLE events ADD COLUMN scheme TEXT;
ALTER TABLE events ADD COLUMN pwa INTEGER;
ALTER TABLE events ADD COLUMN ttfb INTEGER;
ALTER TABLE events ADD COLUMN "load" INTEGER;
ALTER TABLE events ADD COLUMN lcp INTEGER;
ALTER TABLE events ADD COLUMN inp INTEGER;
ALTER TABLE events ADD COLUMN cls INTEGER;
ALTER TABLE events ADD COLUMN scroll INTEGER;
ALTER TABLE events ADD COLUMN target TEXT;
