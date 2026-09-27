# Architecture

<!-- The structural rules a reviewer should hold every change to. Each line
should be checkable against a diff. Link the ADR that made each decision. -->

- Layers: <e.g. UI → application → domain → infrastructure; which may call which>.
- <Where business rules live, and where they must never appear.>
- <Data access: how queries are written; anything that must always be
  filtered, e.g. by tenant or owner.>
- <Authorization: where it is enforced, and the rule for new endpoints.>
- <Anything that is SENSITIVE here — money, multi-tenancy, personal data —
  and the rule that protects it.>
