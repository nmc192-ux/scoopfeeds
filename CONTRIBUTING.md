# Contributing to Scoopfeeds

Thank you for your interest in Scoopfeeds.

## Current execution model

Primary execution is currently solo founder (DrJ) + AI agents (Claude Code) following a structured methodology documented in [docs/execution/execution_method_v1.md](docs/execution/execution_method_v1.md).

External contributions are welcomed but the methodology is currently optimized for the founder-and-agents pattern. We expect to formalize external contribution workflows in Phase D (after the platform's first revenue stream launches).

## How to contribute

### Issues

If you find a bug, want to suggest a feature, or have a question:

1. Check existing [issues](https://github.com/nmc192-ux/scoopfeeds/issues) first.
2. If not raised, file a new issue with:
   - Clear title (verb-first if it's a bug or task)
   - Context: what you observed, what you expected
   - Reproduction steps if it's a bug
   - Reference to relevant Strategic Plan section if it's a feature suggestion

### Pull requests

Pull requests are reviewed against:

- The [Strategic Plan v6](docs/strategy/strategic_plan_v6.md) — does this align with platform direction?
- The [Decisions Log v1](docs/strategy/decisions_log_v1.md) — does this respect existing decisions?
- The [Execution Method v1](docs/execution/execution_method_v1.md) — does this follow our quality discipline?
- Code quality (passes type checks, linter, existing tests)

If a contribution requires changing strategic direction or revisiting a logged decision, the PR should reference the proposed change in its description and may require maintainer discussion before merging.

### Code conventions

- Follow existing patterns in `backend/` and `frontend/`
- New files use `snake_case` for utilities, `PascalCase` for components
- Tests required for new functionality
- Production verification required before marking work complete (see Execution Method Section 6, Definition of Done)

### Editorial / content contributions

Editorial content in Scoopfeeds — including AI-generated briefs, Reality Index outputs, quantitative trackers, dossiers, op-ed analyses, methodology documentation, and social posts — is proprietary and not currently accepting external contributions. This may change in Phase E when the editorial layer is formalized.

## License

By contributing code, you agree that your contributions will be licensed under [Apache License 2.0](LICENSE).

Editorial content remains proprietary per the notice in [README.md](README.md).

## Contact

For questions before contributing: file an issue or contact DrJ via GitHub.
