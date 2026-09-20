# Contributing to SwiftCourier

Thanks for contributing — small, verified PRs beat big unverified ones.

## Workflow (fork → branch → PR)

1. Fork the repo, create a feature branch:
   `git checkout -b feature/amazing-feature`
2. Run the gates before pushing:
   ```bash
   cd backend && python3 -m pytest -q
   cd ../frontend && npm run test:unit
   BASE_URL=http://localhost:8081 npx playwright test --grep @smoke
   # or full gate from repo root:
   ./scripts/run-all-tests.sh
   ```
3. Commit with a clear message, push, open a PR against `main`.
4. CI runs backend → frontend → seeded compose E2E (PRs run `@smoke` only). Green CI + 1 review = merge.

## Rules (enforced in review)

- **No unverified edits:** every behavior change needs a test or a live `curl` / Playwright check pasted in the PR.
- **README stays honest:** if you change install, usage, pricing, or screenshots, update `README.md` + `docs/` media in the same PR (see `docs/DEMO.md`).
- **Backend:** Pydantic validation on new payloads, state-machine transitions go through `ALLOWED_TRANSITIONS` (409 on illegal), log scan events via `log_event`, keep coverage ≥85%.
- **Frontend:** role-first locators (`getByRole`), no new UI deps without bundle-size note, 44px targets, `prefers-reduced-motion` respected.
- **Secrets:** never commit `.env` — only `.env.example`. Fictional 555-01XX phones in seeds/tests.

## Reporting bugs / requesting features

Open an issue with: expected vs actual, repro steps (`curl` or `?track=` link), screenshots/GIF if visual. We respond within a few days.

## License

By contributing you agree your work is MIT-licensed per [`LICENSE`](../LICENSE).
