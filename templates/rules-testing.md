# Testing

<!-- Loaded every session unless you add path-scoping frontmatter, e.g.
---
paths: ["src/**", "tests/**"]
---
Keep it to rules; put explanations in docs/. -->

- Test-first: write the test, run it, see it fail for the right reason (the
  behaviour is missing — not a typo, a bad fixture or a compile error), then
  write the least code that makes it pass, then run the whole suite.
- A new type that doesn't exist yet: write a skeleton that compiles and
  implements none of the rules, so the first failure is behavioural.
- Test layers: <unit tests live in …; integration tests live in … and run
  against …>. A criterion marked [integration] is never proven by a unit
  test with a fake.
- <How to run the suite, and any service it needs (database, containers).>
- <Can two test runs share this machine? If not, say so — overlapping runs
  produce failures that look like regressions and aren't.>
