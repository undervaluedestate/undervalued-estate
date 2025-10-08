-- Seed initial source for Nigeria Property Centre
insert into public.sources (name, base_url)
values ('NigeriaPropertyCentre', 'https://nigeriapropertycentre.com/')
on conflict (name) do update set base_url = excluded.base_url;
